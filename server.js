#!/usr/bin/env node
/* Tug of Math LAN server.
   Serves the game and relays online-play messages over WebSocket so up to
   ten devices on the same network can play Custom rooms without internet.
   No dependencies.

   Usage:  node server.js [port]      (default 5173) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// addresses other devices can actually reach: skip virtual adapters and link-local ones
function lanUrls() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtual|vmware|vbox|wsl|hyper-v|docker|loopback/i.test(name)) continue;
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) found.push(a.address);
    }
  }
  const rank = ip => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return found.sort((a, b) => rank(a) - rank(b)).map(ip => `http://${ip}:${PORT}/`);
}

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }

  if (pathname.endsWith('/tug-server.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ tugServer: true, urls: lanUrls() }));
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  const rel = path.relative(ROOT, file);
  // stay inside the game folder and never serve dotfiles (.git, .claude, ...)
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(part => part.startsWith('.'))) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- minimal WebSocket (RFC 6455, text frames only) ---------- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!req.url.startsWith('/ws') || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const client = { socket, buf: Buffer.alloc(0), frag: [], room: null };
  socket.on('data', chunk => { client.buf = Buffer.concat([client.buf, chunk]); readFrames(client); });
  socket.on('close', () => drop(client));
  socket.on('error', () => drop(client));
});

function readFrames(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (b.length < 10) return;
      if (b.readUInt32BE(2) !== 0) { c.socket.destroy(); return; }
      len = b.readUInt32BE(6); off = 10;
    }
    if (!masked || len > 1 << 20) { c.socket.destroy(); return; }   // clients must mask; cap at 1 MB
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4);
    const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    c.buf = b.subarray(off + 4 + len);

    if (op === 0x8) { sendFrame(c, 0x8, Buffer.alloc(0)); c.socket.end(); return; }   // close
    if (op === 0x9) { sendFrame(c, 0xa, data); continue; }                            // ping -> pong
    if (op === 0x1 || op === 0x0) {
      c.frag.push(data);
      if (fin) { const text = Buffer.concat(c.frag).toString('utf8'); c.frag = []; onText(c, text); }
    }
  }
}

function sendFrame(c, op, payload) {
  if (!c || c.socket.destroyed) return;
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  c.socket.write(Buffer.concat([head, payload]));
}
function sendText(c, msg) {
  sendFrame(c, 0x1, Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg), 'utf8'));
}

/* ---------- rooms: one host + up to 9 others, messages relayed between them ---------- */
const MAX_PLAYERS = 10;
const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do { code = Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
const cleanId = v => String(v || '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || crypto.randomUUID().slice(0, 12);

// everyone in the room learns who is there and who hosts
function sendPeers(room) {
  const msg = { sys: 'peers', ids: [...room.clients].map(x => x.id), host: room.host.id };
  for (const x of room.clients) sendText(x, msg);
}

function onText(c, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;

  if (m.sys === 'host') {
    leaveRoom(c);
    c.id = cleanId(m.id);
    const code = newCode();
    const room = { host: c, clients: new Set([c]) };
    rooms.set(code, room);
    c.room = code;
    sendText(c, { sys: 'hosted', code });
    sendPeers(room);
    return;
  }
  if (m.sys === 'join') {
    leaveRoom(c);
    c.id = cleanId(m.id);
    const code = String(m.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendText(c, { sys: 'error', text: 'No game found with that code.' });
    if (room.clients.size >= MAX_PLAYERS) return sendText(c, { sys: 'error', text: 'That room is full.' });
    room.clients.add(c);
    c.room = code;
    sendText(c, { sys: 'joined', code });
    sendPeers(room);
    return;
  }
  const room = c.room && rooms.get(c.room);
  if (!room) return;
  const out = JSON.stringify({ from: c.id, d: m.d });
  for (const x of room.clients) {
    if (x !== c && (!m.to || x.id === m.to)) sendText(x, out);
  }
}

function leaveRoom(c) {
  const code = c.room;
  const room = code && rooms.get(code);
  c.room = null;
  if (!room) return;
  room.clients.delete(c);
  if (room.host === c) {
    for (const x of room.clients) { x.room = null; sendText(x, { sys: 'closed' }); }
    rooms.delete(code);
  } else {
    sendPeers(room);
  }
}
function drop(c) {
  if (c.dropped) return;
  c.dropped = true;
  leaveRoom(c);
}

/* ---------- start ---------- */
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Try another one:  node server.js ${PORT + 1}\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Tug of Math LAN server is running.\n');
  console.log(`  On this PC:   http://localhost:${PORT}/`);
  const urls = lanUrls();
  if (urls.length) {
    console.log('  On other devices on the same Wi-Fi or network:');
    for (const u of urls) console.log(`                ${u}`);
  }
  console.log('\n  In the game pick Custom, create a room on one device and join with the code on the others.');
  console.log('  Press Ctrl+C to stop.\n');
});
