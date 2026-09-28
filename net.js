/* Tug of Math — link between two players on different devices.
   Two transports behind one small API:
     'lan'  : WebSocket relay from server.js (same network, no internet needed)
     'peer' : WebRTC through PeerJS (over the internet with a room code)
   The page picks 'lan' when it was opened from server.js, otherwise 'peer'. */
const Net = (() => {
  const PEER_SRC = [
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  ];
  const ID_PREFIX = 'tug-of-math-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let via = 'peer';
  let lanUrls = [];
  let role = null;          // 'host' | 'guest' | null
  let code = '';
  let connected = false;
  let ws = null, peer = null, conn = null;
  let joinTimer = 0;
  const handlers = { message() {}, status() {} };

  const status = (kind, text) => handlers.status(kind, text || '');

  /* ---------- setup ---------- */
  // A clear answer (our server, or a 404 from any other host) is final.
  // A timeout or network error is retried on the next call, e.g. when Host or Join is pressed.
  let detecting = null, detectUnsure = false;
  function detect() {
    if (!detecting || detectUnsure) { detectUnsure = false; detecting = runDetect(); }
    return detecting;
  }
  async function runDetect() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch('tug-server.json', { cache: 'no-store', signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) {
          const j = await r.json();
          if (j && j.tugServer) { via = 'lan'; lanUrls = Array.isArray(j.urls) ? j.urls : []; }
        }
      } catch (e) { detectUnsure = true; }   // fall back to the internet transport for now
    }
    return via;
  }
  function supported() {
    return via === 'lan' ? 'WebSocket' in window : 'RTCPeerConnection' in window;
  }
  function randomCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  function inviteLink() {
    if (via === 'lan') {
      const base = lanUrls[0] || location.origin + '/';
      return `${base}#join-${code}`;
    }
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return `${location.origin}${location.pathname}#join-${code}`;
    }
    return code;
  }

  function onData(raw) {
    let m = raw;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return; } }
    if (m && typeof m === 'object' && typeof m.t === 'string') handlers.message(m);
  }
  function send(msg) {
    if (!connected) return;
    const s = JSON.stringify(msg);
    if (via === 'lan') { if (ws && ws.readyState === 1) ws.send(s); }
    else if (conn && conn.open) conn.send(s);
  }
  function setConnected() {
    connected = true;
    clearTimeout(joinTimer);
    status('connected');
  }
  function lostPartner() {
    connected = false;
    if (role === 'host') status('waiting', 'left');
    else { const r = role; cleanup(); role = null; if (r) status('closed', 'The host left the game.'); }
  }

  /* ---------- LAN transport ---------- */
  function lanOpen() {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      ws = sock;
      sock.onopen = () => resolve();
      sock.onerror = () => reject(new Error('Could not reach the LAN server. Is server.js still running?'));
      sock.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m || typeof m !== 'object') return;
        if (!m.sys) return onData(m);
        if (m.sys === 'hosted') { code = m.code; status('waiting'); }
        else if (m.sys === 'paired') setConnected();
        else if (m.sys === 'left') lostPartner();
        else if (m.sys === 'error') { const r = role; cleanup(); role = null; if (r) status('error', m.text); }
      };
      sock.onclose = () => {
        if (ws !== sock) return;      // we closed it on purpose
        ws = null; connected = false;
        const r = role; role = null;
        if (r) status('closed', 'Lost the connection to the LAN server.');
      };
    });
  }

  /* ---------- internet transport (PeerJS) ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  async function loadPeer() {
    if (window.Peer) return;
    for (const src of PEER_SRC) {
      try { await loadScript(src); if (window.Peer) return; } catch (e) { /* try the next CDN */ }
    }
    throw new Error('Could not load online play. Check the internet connection.');
  }
  function openPeer(id) {
    return new Promise((resolve, reject) => {
      const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
      const fail = err => { p.destroy(); reject(err); };
      p.once('open', () => {
        p.off('error', fail);
        peer = p;
        p.on('error', peerError);
        p.on('disconnected', () => { if (peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) { /* ignore */ } } });
        resolve();
      });
      p.once('error', fail);
    });
  }
  function peerError(err) {
    if (!role) return;
    if (err && err.type === 'peer-unavailable') { cleanup(); role = null; status('error', 'No game found with that code.'); }
    else if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error')) {
      if (!connected) { cleanup(); role = null; status('error', 'Could not reach the online server. Check the internet connection.'); }
    }
  }
  function bindConn(c) {
    conn = c;
    c.on('open', () => { if (conn === c) setConnected(); });
    c.on('data', onData);
    c.on('close', () => { if (conn !== c) return; conn = null; lostPartner(); });
    c.on('error', () => { /* close follows */ });
  }
  async function peerHost() {
    await loadPeer();
    for (let attempt = 0; ; attempt++) {
      code = randomCode();
      try { await openPeer(ID_PREFIX + code); break; }
      catch (e) { if (!(e && e.type === 'unavailable-id') || attempt >= 3) throw new Error('Could not open a room. Check the internet connection.'); }
    }
    peer.on('connection', c => {
      if (conn && conn.open) {         // room already has two players
        c.on('open', () => { c.send(JSON.stringify({ t: 'full' })); setTimeout(() => c.close(), 400); });
        return;
      }
      bindConn(c);
    });
    status('waiting');
  }
  async function peerJoin() {
    await loadPeer();
    try { await openPeer(null); }
    catch (e) { throw new Error('Could not reach the online server. Check the internet connection.'); }
    const c = peer.connect(ID_PREFIX + code, { reliable: true });
    bindConn(c);
    joinTimer = setTimeout(() => {
      if (!connected && role === 'guest') { cleanup(); role = null; status('error', 'No answer from that code. Check it and try again.'); }
    }, 12000);
  }

  /* ---------- public API ---------- */
  function cleanup() {
    clearTimeout(joinTimer);
    connected = false;
    const c = conn, p = peer, s = ws;
    conn = null; peer = null; ws = null;
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    try { if (s) s.close(); } catch (e) { /* ignore */ }
  }
  async function host() {
    leave();
    role = 'host';
    status('connecting', 'Opening a room…');
    await detect();
    if (role !== 'host') return;
    try {
      if (via === 'lan') { await lanOpen(); ws.send(JSON.stringify({ sys: 'host' })); }
      else await peerHost();
    } catch (e) {
      cleanup(); role = null;
      status('error', e.message);
    }
  }
  async function join(c) {
    leave();
    role = 'guest';
    code = String(c || '').toUpperCase();
    status('connecting', `Joining ${code}…`);
    await detect();
    if (role !== 'guest') return;
    try {
      if (via === 'lan') { await lanOpen(); ws.send(JSON.stringify({ sys: 'join', code })); }
      else await peerJoin();
    } catch (e) {
      cleanup(); role = null;
      status('error', e.message);
    }
  }
  function leave() {
    role = null;
    cleanup();
  }
  window.addEventListener('pagehide', leave);

  return {
    get via() { return via; },
    get role() { return role; },
    get code() { return code; },
    get connected() { return connected; },
    get lanUrls() { return lanUrls.slice(); },
    detect, supported, inviteLink, host, join, leave, send,
    on(type, fn) { handlers[type] = fn; },
  };
})();
