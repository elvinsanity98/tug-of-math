/* Tug of Math — link between two players on different devices.
   Three transports behind one small API:
     'lan'  : WebSocket relay from server.js (same network, no internet needed)
     'supa' : Supabase Realtime channels (internet, room codes + Quick match)
     'peer' : WebRTC through PeerJS (internet, room codes)
   The page picks 'lan' when it was opened from server.js, 'supa' when
   config.js has Supabase keys, otherwise 'peer'. */
const Net = (() => {
  const PEER_SRC = [
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  ];
  const SUPA_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
  const ID_PREFIX = 'tug-of-math-v1-';
  const CHANNEL_PREFIX = 'tug-of-math-v1';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const cfg = window.TUG_CONFIG || {};
  const myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  let via = 'peer';
  let lanUrls = [];
  let role = null;          // 'host' | 'guest' | 'seeker' (Quick match) | null
  let code = '';
  let connected = false;
  let quick = false;        // this game came from Quick match
  let ws = null, peer = null, conn = null;
  let sb = null, room = null, lobby = null, partnerId = null, pending = [];
  let joinTimer = 0, lobbyTimer = 0;
  const handlers = { message() {}, status() {} };

  const status = (kind, text) => handlers.status(kind, text || '');
  const supaConfigured = () => !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  /* ---------- setup ---------- */
  // A clear answer (our server, or a 404 from any other host) is final.
  // A timeout or network error is retried on the next call, e.g. when Host or Join is pressed.
  let detecting = null, detectUnsure = false;
  function detect() {
    if (!detecting || detectUnsure) { detectUnsure = false; detecting = runDetect(); }
    return detecting;
  }
  async function runDetect() {
    let lan = false;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch('tug-server.json', { cache: 'no-store', signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) {
          const j = await r.json();
          if (j && j.tugServer) { lan = true; lanUrls = Array.isArray(j.urls) ? j.urls : []; }
        }
      } catch (e) { detectUnsure = true; }
    }
    via = lan ? 'lan' : supaConfigured() ? 'supa' : 'peer';
    return via;
  }
  function supported() {
    return via === 'peer' ? 'RTCPeerConnection' in window : 'WebSocket' in window;
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
    if (via === 'supa') {
      if (room) room.send({ type: 'broadcast', event: 'm', payload: { from: myId, to: partnerId, d: msg } });
      return;
    }
    const s = JSON.stringify(msg);
    if (via === 'lan') { if (ws && ws.readyState === 1) ws.send(s); }
    else if (conn && conn.open) conn.send(s);
  }
  function setConnected() {
    connected = true;
    clearTimeout(joinTimer);
    status('connected');
    // messages that arrived a moment before we saw the partner join
    const early = pending.filter(p => p.from === partnerId);
    pending = [];
    for (const p of early) onData(p.d);
  }
  function lostPartner() {
    connected = false;
    partnerId = null;
    if (role === 'host') status('waiting', 'left');
    else { const r = role; cleanup(); role = null; if (r) status('closed', 'The host left the game.'); }
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  function startJoinTimer(ms) {
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
      if (connected || !role || role === 'seeker') return;
      if (quick) { quickMatch(); return; }          // the match fell through: search again
      cleanup(); role = null;
      status('error', 'No game found with that code.');
    }, ms);
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

  /* ---------- internet transport: Supabase Realtime ---------- */
  const SUPA_FAIL = 'Could not reach Supabase. Check config.js, the Realtime settings and the internet connection.';
  const byAt = (a, b) => a.at - b.at || (a.id < b.id ? -1 : 1);
  function presenceList(ch) {
    return Object.entries(ch.presenceState()).map(([id, metas]) => {
      const m = (metas && metas[0]) || {};
      return { id, role: m.role, at: Number(m.at) || 0 };
    });
  }
  async function supaClient() {
    if (sb) return sb;
    if (!(window.supabase && window.supabase.createClient)) {
      try { await loadScript(SUPA_SRC); } catch (e) { /* reported below */ }
    }
    if (!(window.supabase && window.supabase.createClient)) throw new Error('Could not load online play. Check the internet connection.');
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return sb;
  }
  function dropChannel(ch) {
    if (!ch || !sb) return;
    try { ch.untrack(); } catch (e) { /* ignore */ }
    try { sb.removeChannel(ch); } catch (e) { /* ignore */ }
  }
  function openRoom(roomCode, asRole) {
    return new Promise((resolve, reject) => {
      const at = Date.now();
      const ch = sb.channel(`${CHANNEL_PREFIX}:room:${roomCode}`, {
        config: { broadcast: { self: false }, presence: { key: myId } },
      });
      room = ch;
      ch.on('broadcast', { event: 'm' }, ({ payload: p }) => {
        if (room !== ch || !p || p.to !== myId) return;
        if (p.from === partnerId && connected) onData(p.d);
        else if (pending.length < 30) pending.push(p);
      });
      ch.on('presence', { event: 'sync' }, () => { if (room === ch) roomPresence(ch); });
      let settled = false;
      ch.subscribe(async st => {
        if (room !== ch) return;
        if (st === 'SUBSCRIBED') {
          try { await ch.track({ role: asRole, at }); } catch (e) { /* presence retries on its own */ }
          if (!settled) { settled = true; resolve(); }
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          if (!settled) { settled = true; reject(new Error(SUPA_FAIL)); return; }
          if (role && st !== 'CLOSED') { const r = role; cleanup(); role = null; if (r) status('closed', 'Lost the connection to the online server.'); }
        }
      });
    });
  }
  function roomPresence(ch) {
    const people = presenceList(ch);
    const host = people.filter(p => p.role === 'host').sort(byAt)[0];
    const guest = people.filter(p => p.role === 'guest').sort(byAt)[0];
    if (role === 'host') {
      if (connected && !people.some(p => p.id === partnerId)) lostPartner();
      if (!connected && guest) { partnerId = guest.id; setConnected(); }
    } else if (role === 'guest') {
      if (connected && (!host || host.id !== partnerId)) { lostPartner(); return; }
      if (connected || !host) return;
      if (guest && guest.id !== myId) {          // someone else joined first
        cleanup(); role = null;
        status('error', 'That game already has two players.');
        return;
      }
      partnerId = host.id;
      setConnected();
    }
  }
  async function supaHost() {
    await supaClient();
    code = randomCode();
    try { await openRoom(code, 'host'); } catch (e) { throw new Error(SUPA_FAIL); }
    status('waiting');
  }
  async function supaJoin() {
    await supaClient();
    try { await openRoom(code, 'guest'); } catch (e) { throw new Error(SUPA_FAIL); }
    startJoinTimer(8000);
  }

  /* Quick match: everyone waiting sits in one lobby channel. In the list sorted by
     arrival, players 1+2, 3+4, ... pair up; the earlier one invites, the later one
     accepts, and both move to a fresh room. */
  async function quickMatch() {
    leave();
    role = 'seeker'; quick = true;
    status('searching', 'Looking for an opponent…');
    await detect();
    if (role !== 'seeker') return;
    if (via !== 'supa') { role = null; quick = false; status('error', 'Quick match needs Supabase keys in config.js.'); return; }
    try { await supaClient(); } catch (e) { role = null; quick = false; status('error', e.message); return; }
    if (role !== 'seeker') return;

    const at = Date.now();
    let invitedTo = null, inviteCode = '';
    const ch = sb.channel(`${CHANNEL_PREFIX}:lobby`, { config: { broadcast: { self: false }, presence: { key: myId } } });
    lobby = ch;
    const pairUp = () => {
      if (lobby !== ch || role !== 'seeker') return;
      const list = presenceList(ch).sort(byAt);
      const others = list.length - 1;
      status('searching', others > 0
        ? `Found ${others} other player${others > 1 ? 's' : ''}. Pairing up…`
        : 'Looking for an opponent… You can also share this page so a friend presses Quick match.');
      const i = list.findIndex(p => p.id === myId);
      if (i >= 0 && i % 2 === 0 && list[i + 1]) {
        const target = list[i + 1].id;
        if (invitedTo !== target) { invitedTo = target; inviteCode = randomCode(); }
        ch.send({ type: 'broadcast', event: 'lobby', payload: { t: 'invite', from: myId, to: target, code: inviteCode } });
      }
    };
    ch.on('presence', { event: 'sync' }, pairUp);
    ch.on('broadcast', { event: 'lobby' }, async ({ payload: p }) => {
      if (lobby !== ch || role !== 'seeker' || !p || p.to !== myId || !/^[A-Z0-9]{5}$/.test(p.code || '')) return;
      if (p.t === 'invite') {
        role = 'matching';
        try { await ch.send({ type: 'broadcast', event: 'lobby', payload: { t: 'accept', from: myId, to: p.from, code: p.code } }); } catch (e) { /* the room timer recovers */ }
        matched('guest', p.code);
      } else if (p.t === 'accept' && p.from === invitedTo && p.code === inviteCode) {
        role = 'matching';
        matched('host', p.code);
      }
    });
    ch.subscribe(async st => {
      if (lobby !== ch) return;
      if (st === 'SUBSCRIBED') { try { await ch.track({ at }); } catch (e) { /* ignore */ } }
      else if ((st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') && role === 'seeker') {
        cleanup(); role = null; quick = false;
        status('error', SUPA_FAIL);
      }
    });
    lobbyTimer = setInterval(pairUp, 2500);    // re-send invites that were missed
  }
  async function matched(asRole, roomCode) {
    clearInterval(lobbyTimer);
    const ch = lobby;
    lobby = null;
    dropChannel(ch);
    role = asRole; code = roomCode;
    status('connecting', 'Opponent found! Connecting…');
    try {
      await openRoom(code, asRole);
      startJoinTimer(10000);                   // either side gives up and searches again
    } catch (e) {
      cleanup(); role = null; quick = false;
      status('error', e.message);
    }
  }

  /* ---------- internet transport: PeerJS ---------- */
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
    startJoinTimer(12000);
  }

  /* ---------- public API ---------- */
  function cleanup() {
    clearTimeout(joinTimer);
    clearInterval(lobbyTimer);
    connected = false;
    partnerId = null;
    pending = [];
    const c = conn, p = peer, s = ws, r = room, l = lobby;
    conn = null; peer = null; ws = null; room = null; lobby = null;
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    try { if (s) s.close(); } catch (e) { /* ignore */ }
    dropChannel(r);
    dropChannel(l);
  }
  async function host() {
    leave();
    role = 'host';
    code = '';
    status('connecting', 'Opening a room…');
    await detect();
    if (role !== 'host') return;
    try {
      if (via === 'lan') { await lanOpen(); ws.send(JSON.stringify({ sys: 'host' })); }
      else if (via === 'supa') await supaHost();
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
      else if (via === 'supa') await supaJoin();
      else await peerJoin();
    } catch (e) {
      cleanup(); role = null;
      status('error', e.message);
    }
  }
  function leave() {
    role = null;
    quick = false;
    cleanup();
  }
  window.addEventListener('pagehide', leave);

  return {
    get via() { return via; },
    get role() { return role; },
    get code() { return code; },
    get connected() { return connected; },
    get quick() { return quick; },
    get lanUrls() { return lanUrls.slice(); },
    detect, supported, inviteLink, host, join, quickMatch, leave, send,
    on(type, fn) { handlers[type] = fn; },
  };
})();
