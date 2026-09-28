/* Tug of Math — rooms for online play, 2 to 10 players.
   The host runs the match; everyone in the room hears every message.
   Two transports behind one small API:
     'lan'  : WebSocket relay from server.js (same network, no internet needed)
     'supa' : Supabase Realtime channels (internet)
   Rooms use 'lan' when the page was opened from server.js, otherwise 'supa'.
   Quick match always goes through Supabase: everyone waiting for the same
   mode sits in one lobby channel, and the player who has waited longest
   invites the next ones into a fresh room once enough are there (or the
   wait runs out and computer players fill the gaps). */
const Net = (() => {
  const PREFIX = 'tug-of-math-v2';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const SUPA_FAIL = 'Could not reach the online server. Check the internet connection.';
  const myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  let via = 'none';
  let lanUrls = [];
  let room = null;   // { via, code, role: 'host'|'member', ch | ws, peers: [ids], hostId, seenHost, quick, joinTimer }
  let seek = null;   // { queue, need, at, ch, timer }
  let sb = null;
  const handlers = { message() {}, peers() {}, status() {}, matched() {} };
  const status = (kind, info) => handlers.status(kind, info);

  /* ---------- setup ---------- */
  // A clear answer (our server, or a 404 from any other host) is final.
  // A timeout or network error is retried on the next call.
  let detecting = null, detectUnsure = false;
  function detect() {
    if (!detecting || detectUnsure) { detectUnsure = false; detecting = runDetect(); }
    return detecting;
  }
  async function runDetect() {
    let lan = false;
    if (location.protocol === 'http:') {        // server.js only speaks plain http
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
    via = lan ? 'lan' : DB.configured ? 'supa' : 'none';
    return via;
  }
  function randomCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }
  function inviteLink(code) {
    if (via === 'lan') return `${lanUrls[0] || location.origin + '/'}#join-${code}`;
    if (location.protocol === 'http:' || location.protocol === 'https:') return `${location.origin}${location.pathname}#join-${code}`;
    return code;
  }
  async function supa() {
    if (!sb) sb = await DB.client();    // one client for the whole page, shared with db.js
    return sb;
  }
  const byAt = (a, b) => a.at - b.at || (a.id < b.id ? -1 : 1);
  function presenceList(ch) {
    return Object.entries(ch.presenceState()).map(([id, metas]) => {
      const m = (metas && metas[0]) || {};
      return Object.assign({}, m, { id, at: Number(m.at) || 0 });
    });
  }

  /* ---------- rooms ---------- */
  function updatePeers(r, ids, hostId) {
    if (room !== r) return;
    if (r.role === 'member') {
      if (hostId) { r.seenHost = true; clearTimeout(r.joinTimer); }
      else if (r.seenHost) { lost('The host left the room.'); return; }
    }
    r.hostId = hostId;
    r.peers = ids;
    handlers.peers(ids.slice(), hostId);
    if (hostId && r.early && r.early.length) {
      const early = r.early;
      r.early = [];
      for (const p of early) if (room === r) handlers.message(p.d, p.from);
    }
  }
  function lost(text) {
    if (!room) return;
    closeRoom();
    status('closed', text);
  }

  function supaOpen(code, role, quick) {
    return new Promise((resolve, reject) => {
      const at = Date.now();
      const ch = sb.channel(`${PREFIX}:room:${code}`, { config: { broadcast: { self: false }, presence: { key: myId } } });
      const r = { via: 'supa', code, role, ch, peers: [], hostId: role === 'host' ? myId : null, seenHost: false, quick, early: [] };
      room = r;
      ch.on('broadcast', { event: 'm' }, ({ payload: p }) => {
        if (room !== r || !p || p.from === myId || (p.to && p.to !== myId)) return;
        // broadcasts can beat presence: hold them until we know who the host is
        if (!r.hostId) { if (r.early.length < 60) r.early.push(p); return; }
        handlers.message(p.d, p.from);
      });
      ch.on('presence', { event: 'sync' }, () => {
        if (room !== r) return;
        const list = presenceList(ch);
        const host = list.filter(p => p.role === 'host').sort(byAt)[0];
        updatePeers(r, list.map(p => p.id), role === 'host' ? myId : host ? host.id : null);
      });
      let settled = false;
      ch.subscribe(async st => {
        if (room !== r) return;
        if (st === 'SUBSCRIBED') {
          try { await ch.track({ role, at }); } catch (e) { /* presence retries on its own */ }
          if (!settled) { settled = true; resolve(r); }
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          if (!settled) { settled = true; closeRoom(); reject(new Error(SUPA_FAIL)); return; }
          if (st !== 'CLOSED') lost('Lost the connection to the online server.');
        }
      });
    });
  }

  function lanOpen(code, role) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      const r = { via: 'lan', code, role, ws, peers: [], hostId: null, seenHost: false, quick: false };
      room = r;
      let settled = false;
      const done = err => {
        if (settled) return false;
        settled = true;
        if (err) { closeRoom(); reject(err); } else resolve(r);
        return true;
      };
      ws.onopen = () => ws.send(JSON.stringify(role === 'host' ? { sys: 'host', id: myId } : { sys: 'join', code, id: myId }));
      ws.onmessage = e => {
        if (room !== r) return;
        let m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m || typeof m !== 'object') return;
        if (m.sys === 'hosted') { r.code = m.code; done(); }
        else if (m.sys === 'joined') done();
        else if (m.sys === 'peers') updatePeers(r, m.ids || [], m.host || null);
        else if (m.sys === 'closed') lost('The host left the room.');
        else if (m.sys === 'error') { if (!done(new Error(m.text))) lost(m.text); }
        else if (m.d && m.from) handlers.message(m.d, m.from);
      };
      ws.onerror = () => done(new Error('Could not reach the LAN server. Is server.js still running?'));
      ws.onclose = () => { if (room === r) lost('Lost the connection to the LAN server.'); };
    });
  }

  function closeRoom() {
    const r = room;
    room = null;
    if (!r) return;
    clearTimeout(r.joinTimer);
    if (r.ch) { try { r.ch.untrack(); } catch (e) { /* ignore */ } try { sb.removeChannel(r.ch); } catch (e) { /* ignore */ } }
    if (r.ws) { try { r.ws.close(); } catch (e) { /* ignore */ } }
  }
  function roomVia() {
    if (via === 'lan') return 'lan';
    if (via === 'supa') return 'supa';
    throw new Error('Online play needs Supabase keys in config.js or the LAN server.');
  }

  async function host() {
    leave();
    await detect();
    const how = roomVia();
    if (how === 'supa') await supa();
    const r = how === 'lan' ? await lanOpen('', 'host') : await supaOpen(randomCode(), 'host', false);
    return r.code;
  }
  async function join(code) {
    leave();
    await detect();
    const how = roomVia();
    if (how === 'supa') await supa();
    code = String(code || '').toUpperCase();
    const r = how === 'lan' ? await lanOpen(code, 'member') : await supaOpen(code, 'member', false);
    startJoinTimer(r, 8000);
    return code;
  }
  function startJoinTimer(r, ms) {
    clearTimeout(r.joinTimer);
    r.joinTimer = setTimeout(() => {
      if (room !== r || r.seenHost) return;
      const quick = r.quick;
      closeRoom();
      status(quick ? 'fell' : 'error', quick ? 'The match fell through. Searching again…' : 'No room found with that code.');
    }, ms);
  }
  function send(d, to) {
    const r = room;
    if (!r) return;
    if (r.via === 'supa') r.ch.send({ type: 'broadcast', event: 'm', payload: { from: myId, to: to || null, d } });
    else if (r.ws && r.ws.readyState === 1) r.ws.send(JSON.stringify({ to: to || null, d }));
  }

  /* ---------- quick match ---------- */
  async function quickMatch(queue, need, waitMs, info) {
    leave();
    const s = { queue, need, at: Date.now(), ch: null, timer: 0, busy: false };
    seek = s;
    status('searching', { found: 1, need, waited: 0 });
    try { await supa(); } catch (e) { if (seek === s) { seek = null; status('error', e.message); } return; }
    if (seek !== s) return;
    const ch = sb.channel(`${PREFIX}:lobby:${queue}`, { config: { broadcast: { self: false }, presence: { key: myId } } });
    s.ch = ch;
    const tick = async () => {
      if (seek !== s || s.busy) return;
      const list = presenceList(ch).sort(byAt);
      const waited = Date.now() - s.at;
      status('searching', { found: Math.max(1, list.length), need, waited });
      if (!list.length || list[0].id !== myId) return;         // the longest waiter leads
      if (list.length < need && waited < waitMs) return;
      s.busy = true;
      const group = list.slice(0, need).map(p => p.id);
      const code = randomCode();
      try { await ch.send({ type: 'broadcast', event: 'q', payload: { t: 'invite', from: myId, to: group.slice(1), code } }); } catch (e) { /* the room timer recovers */ }
      matched(s, 'host', code, group);
    };
    ch.on('presence', { event: 'sync' }, tick);
    ch.on('broadcast', { event: 'q' }, ({ payload: p }) => {
      if (seek !== s || s.busy || !p || p.t !== 'invite' || !Array.isArray(p.to) || !p.to.includes(myId) || !/^[A-Z0-9]{5}$/.test(p.code || '')) return;
      s.busy = true;
      matched(s, 'member', p.code, null);
    });
    ch.subscribe(async st => {
      if (seek !== s) return;
      if (st === 'SUBSCRIBED') { try { await ch.track(Object.assign({}, info, { at: s.at })); } catch (e) { /* ignore */ } }
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { stopSeek(); status('error', SUPA_FAIL); }
    });
    s.timer = setInterval(tick, 1000);
  }
  async function matched(s, role, code, group) {
    if (seek !== s) return;
    stopSeek();
    status('connecting', 'Match found! Joining…');
    try {
      const r = await supaOpen(code, role, true);
      if (role === 'member') startJoinTimer(r, 10000);
      handlers.matched({ role, code, group });
    } catch (e) {
      status('error', e.message);
    }
  }
  function stopSeek() {
    const s = seek;
    seek = null;
    if (!s) return;
    clearInterval(s.timer);
    if (s.ch) { try { s.ch.untrack(); } catch (e) { /* ignore */ } try { sb.removeChannel(s.ch); } catch (e) { /* ignore */ } }
  }

  function leave() {
    stopSeek();
    closeRoom();
  }
  window.addEventListener('pagehide', leave);

  return {
    get via() { return via; },
    get myId() { return myId; },
    get code() { return room ? room.code : ''; },
    get role() { return room ? room.role : null; },
    get hostId() { return room ? room.hostId : null; },
    get peers() { return room ? room.peers.slice() : []; },
    get inRoom() { return !!room; },
    get searching() { return !!seek; },
    get lanUrls() { return lanUrls.slice(); },
    detect, inviteLink, host, join, quickMatch, leave, send,
    on(type, fn) { handlers[type] = fn; },
  };
})();
