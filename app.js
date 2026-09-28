/* Tug of Math — screens: landing, dashboard (play, shop, ranks, leaderboard,
   history, profile), Classic setup, matchmaking, room lobby and results.
   The match itself runs in game.js; rooms and quick match in net.js. */
(() => {
  const $ = id => document.getElementById(id);
  const radio = n => (document.querySelector(`input[name="${n}"]:checked`) || {}).value;
  const setRadio = (n, v) => { const el = document.querySelector(`input[name="${n}"][value="${v}"]`); if (el) el.checked = true; };
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 14);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const Sfx = Game.sfx;
  const SETTINGS_KEY = 'tug-of-math-settings';
  const QUICK_WAIT = { 1: 15000, 5: 20000 };
  const RANKED_SETTINGS = { op: 'mix', diff: 'medium', time: 90 };
  const BOT_SKINS = ['classic', 'cap', 'shades', 'cat', 'pirate', 'ninja', 'viking', 'wizard'];
  const MODE_NAME = { classic: 'Classic', ranked: 'Ranked', custom: 'Custom' };

  let me = null;            // the player's profile (DB.profile)
  let ready = null;         // DB.init() in flight
  let Q = null;             // quick match being searched: { mode, size, settings }
  let R = null;             // room: see newRoom()
  let lastOffline = null;   // last offline match config, for Rematch

  /* ---------- small helpers ---------- */
  let toastT = 0;
  function toast(text, bad) {
    const t = $('toast');
    t.textContent = text; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600);
  }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(loadPrefs(), p))); } catch (e) { /* storage blocked */ } }
  const myLook = () => Catalog.lookFor(me ? me.id : 'x');
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function show(screen) {
    const changed = document.body.dataset.screen !== screen;
    for (const id of ['landing', 'dash', 'match']) $(id).hidden = id !== screen;
    document.body.dataset.screen = screen;
    if (changed) window.scrollTo(0, 0);
  }
  function closeOverlays() { for (const id of ['classicSheet', 'searchSheet', 'lobby', 'result']) $(id).hidden = true; }
  function sizeCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }

  /* ============ landing ============ */
  (function buildLanding() {
    const title = $('landTitle');
    let n = 0;
    for (const [word, cls] of [['Tug', 'r'], ['of', 'of'], ['Math', 'b']]) {
      const w = document.createElement('span');
      w.className = 'lw ' + cls;
      for (const ch of word) {
        const s = document.createElement('span');
        s.className = 'll'; s.textContent = ch; s.style.animationDelay = (0.08 * n++) + 's, ' + (1.2 + 0.08 * n) + 's';
        s.setAttribute('aria-hidden', 'true');
        w.appendChild(s);
      }
      title.appendChild(w);
    }
    const sky = $('landSky');
    const syms = ['+', '−', '×', '÷', '=', '7', '3', '9', '12', '½', '√', '%', '5', '8'];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('span');
      s.textContent = syms[i % syms.length];
      s.style.left = (Math.random() * 100) + '%';
      s.style.fontSize = (18 + Math.random() * 38) + 'px';
      s.style.animationDuration = (9 + Math.random() * 12) + 's';
      s.style.animationDelay = (-Math.random() * 20) + 's';
      s.style.opacity = (0.12 + Math.random() * 0.3).toFixed(2);
      sky.appendChild(s);
    }
  })();

  /* ---------- account: sign in, create account, reset password ---------- */
  function authMsg(text, bad) {
    const m = $('authMsg');
    m.textContent = text || '';
    m.className = 'auth-msg' + (bad ? ' bad' : '');
  }
  // which: 'in' | 'up' | 'reset'
  function authTab(which) {
    $('signInForm').hidden = which !== 'in';
    $('signUpForm').hidden = which !== 'up';
    $('resetForm').hidden = which !== 'reset';
    $('auth').querySelector('.auth-tabs').hidden = which === 'reset';
    for (const [id, on] of [['tabIn', which === 'in'], ['tabUp', which === 'up']]) {
      $(id).classList.toggle('on', on);
      $(id).setAttribute('aria-selected', String(on));
    }
    authMsg('');
  }
  // state: 'in' | 'out' | 'recovery' | 'offline'
  function landingState(state) {
    const signedIn = state === 'in';
    $('auth').hidden = !(state === 'out' || state === 'recovery');
    $('landGo').hidden = !signedIn;
    $('landSignOut').hidden = !signedIn;
    $('offlineGo').hidden = state !== 'offline';
    const status = $('landStatus');
    if (signedIn) {
      $('landGo').textContent = `Play as ${me.display_name}`;
      status.textContent = 'Signed in. Your coins and rank are saved.';
    } else if (state === 'out') {
      authTab('in');
      status.textContent = '';
      if (DB.linkError) authMsg(`That link did not work (${DB.linkError}). Ask for a new one.`, true);
    } else if (state === 'recovery') {
      authTab('reset');
      status.textContent = '';
    } else {
      status.textContent = "Can't reach the game server, so accounts are unavailable. You can still play Same PC, vs computer and LAN rooms as a guest.";
    }
  }
  ready = DB.init().then(state => {
    me = DB.profile;
    landingState(state);
    return state;
  });

  function busy(form, on) { form.querySelectorAll('input, button').forEach(el => { el.disabled = on; }); }
  const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  async function submitAuth(form, check, run) {
    const problem = check();
    if (problem) { authMsg(problem[0], true); problem[1].focus(); return; }
    busy(form, true);
    try { await run(); }
    catch (err) { authMsg(err.message, true); }
    finally { busy(form, false); }
  }
  $('tabIn').addEventListener('click', () => { authTab('in'); $('inEmail').focus(); });
  $('tabUp').addEventListener('click', () => { authTab('up'); $('upName').focus(); });
  $('signInForm').addEventListener('submit', e => {
    e.preventDefault();
    const mail = $('inEmail').value.trim(), pass = $('inPass').value;
    submitAuth(e.target,
      () => !validEmail(mail) ? ['Type the email you signed up with.', $('inEmail')] : !pass ? ['Type your password.', $('inPass')] : null,
      async () => {
        authMsg('Signing in…');
        await DB.signIn(mail, pass);
        $('inPass').value = '';
        me = DB.profile;
        enter();
      });
  });
  $('signUpForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = clean($('upName').value), mail = $('upEmail').value.trim(), pass = $('upPass').value;
    submitAuth(e.target,
      () => !name ? ['Pick a player name. Everyone sees it on the leaderboard.', $('upName')]
        : !validEmail(mail) ? ['Type a real email address.', $('upEmail')]
        : pass.length < 6 ? ['Use at least 6 characters for the password.', $('upPass')] : null,
      async () => {
        authMsg('Creating your account…');
        const res = await DB.signUp(name, mail, pass);
        $('upPass').value = '';
        if (res === 'confirm') {
          authTab('in');
          $('inEmail').value = mail;
          authMsg('Account created. Open the link in your email to confirm it, then sign in.');
          return;
        }
        me = DB.profile;
        enter();
      });
  });
  $('forgotBtn').addEventListener('click', () => {
    const mail = $('inEmail').value.trim();
    submitAuth($('signInForm'),
      () => !validEmail(mail) ? ['Type your email above first, then press Forgot password.', $('inEmail')] : null,
      async () => {
        await DB.resetPassword(mail);
        authMsg('If that email has an account, a reset link is on its way. Check the spam folder too.');
      });
  });
  $('resetForm').addEventListener('submit', e => {
    e.preventDefault();
    const pass = $('newPass').value;
    submitAuth(e.target,
      () => pass.length < 6 ? ['Use at least 6 characters.', $('newPass')] : null,
      async () => {
        await DB.updatePassword(pass);
        $('newPass').value = '';
        toast('Password changed.');
        me = DB.profile;
        enter();
      });
  });
  async function signOut() {
    Net.leave();
    R = null; Q = null;
    if (Game.active) Game.stop();
    closeOverlays();
    try { await DB.signOut(); } catch (e) { /* the local session is gone either way */ }
    me = null;
    show('landing');
    landingState('out');
    $('inEmail').focus();
  }
  $('landSignOut').addEventListener('click', signOut);
  $('offlineGo').addEventListener('click', () => enter());

  let entering = false;
  function enter() {
    if (entering || !me) return;
    entering = true;
    Sfx.ensure(); Sfx.click();
    show('dash');
    renderDash();
    showView('home');
    Net.detect();
    entering = false;
    const hashJoin = /^#join-([A-Z0-9]{5})$/i.exec(location.hash);
    if (hashJoin) { history.replaceState(null, '', location.pathname); joinRoom(hashJoin[1].toUpperCase()); }
  }
  $('landGo').addEventListener('click', enter);

  /* ============ dashboard ============ */
  function renderDash() {
    const r = Catalog.rankInfo(me.rank_stars);
    $('meName').textContent = me.display_name;
    $('heroName').textContent = me.display_name;
    $('meRankLabel').textContent = r.label;
    $('heroRankLabel').textContent = r.label;
    $('meBadge').innerHTML = Catalog.badge(me.rank_stars, { ribbon: false, animate: false });
    $('heroBadge').innerHTML = Catalog.badge(me.rank_stars);
    $('rankedArt').innerHTML = Catalog.badge(me.rank_stars, { ribbon: false });
    $('heroStars').innerHTML = Catalog.starsRow(me.rank_stars);
    $('coinCount').textContent = me.coins.toLocaleString();
    const rate = me.games_played ? Math.round(me.wins / me.games_played * 100) : 0;
    $('heroStats').textContent = me.games_played
      ? `${me.games_played} games · ${me.wins} wins (${rate}%) · best streak ${me.best_streak}`
      : 'Play your first game to start earning coins.';
    const note = $('offlineNote');
    note.hidden = DB.online;
    note.textContent = 'Offline mode: coins, ranks and the shop need an internet connection. Same PC, vs computer and LAN rooms still work.';
    $('rankedBtn').disabled = !DB.online;
    $('rankedBtn').title = DB.online ? '' : 'Ranked needs an internet connection';
    drawAvatars();
  }
  function drawAvatars() {
    for (const id of ['meAvatar', 'profileAvatar']) {
      const cv = $(id);
      if (cv.offsetParent === null) continue;
      sizeCanvas(cv);
      renderAvatar(cv, me.skin, myLook(), 0.6, id === 'meAvatar' ? 'stand' : 'cheer', id === 'meAvatar' ? 'bust' : 'full');
    }
  }
  let heroT = 0;
  function animateHero(dt) {
    const cv = $('heroAvatar');
    if ($('dash').hidden || cv.offsetParent === null) return;
    heroT += dt;
    sizeCanvas(cv);
    renderAvatar(cv, me.skin, myLook(), heroT, 'cheer');
  }

  function showView(name) {
    document.querySelectorAll('.dash-nav button').forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    if (name === 'shop') renderShop();
    if (name === 'ranks') renderRanks();
    if (name === 'board') loadBoard();
    if (name === 'history') loadHistory();
    if (name === 'profile') renderProfile();
    drawAvatars();
  }
  document.querySelectorAll('.dash-nav button').forEach(b => b.addEventListener('click', () => { Sfx.click(); showView(b.dataset.view); }));
  $('meChip').addEventListener('click', () => showView('profile'));

  /* ---------- shop ---------- */
  let confirmBuy = null;
  function renderShop() {
    const grid = $('shopGrid');
    grid.innerHTML = '';
    const best = me.best_stars || 0;
    for (const s of Catalog.SKINS) {
      const owned = DB.owns(s.id), wearing = me.skin === s.id;
      const locked = !owned && best < s.minStars;
      const card = document.createElement('article');
      card.className = 'skin-card' + (wearing ? ' wearing' : '') + (locked ? ' locked' : '');
      const cv = document.createElement('canvas');
      cv.className = 'skin-art'; cv.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div');
      body.className = 'skin-body';
      const need = s.minStars ? Catalog.rankInfo(s.minStars) : null;
      body.innerHTML = `<h3>${esc(s.name)}</h3><p>${esc(s.blurb)}</p>` +
        (owned ? '' : `<span class="price"><i class="coin"></i>${s.price.toLocaleString()}</span>`) +
        (need ? `<span class="lock-tag">${best >= s.minStars ? 'Unlocked:' : 'Needs'} ${need.label}</span>` : '');
      const btn = document.createElement('button');
      btn.type = 'button';
      if (wearing) { btn.className = 'pill-btn quiet'; btn.textContent = 'Wearing'; btn.disabled = true; }
      else if (owned) { btn.className = 'pill-btn'; btn.textContent = 'Wear'; btn.onclick = () => wearSkin(s.id); }
      else if (locked) { btn.className = 'pill-btn quiet'; btn.textContent = 'Locked'; btn.disabled = true; }
      else {
        const afford = me.coins >= s.price;
        btn.className = 'pill-btn buy';
        btn.textContent = confirmBuy === s.id ? `Buy for ${s.price}?` : afford ? 'Buy' : 'Need more coins';
        btn.disabled = !afford || !DB.online;
        btn.onclick = () => { if (confirmBuy === s.id) buySkin(s); else { confirmBuy = s.id; renderShop(); } };
      }
      body.appendChild(btn);
      card.append(cv, body);
      grid.appendChild(card);
      sizeCanvas(cv);
      renderAvatar(cv, s.id, myLook(), 0.6, 'stand', 'bust');
    }
  }
  async function buySkin(s) {
    confirmBuy = null;
    try {
      await DB.buySkin(s.id);
      Sfx.coin();
      await DB.equipSkin(s.id);
      toast(`${s.name} is yours, and you're wearing it.`);
    } catch (e) { toast(e.message, true); }
    renderShop(); renderDash();
  }
  async function wearSkin(id) {
    try { await DB.equipSkin(id); Sfx.click(); } catch (e) { toast(e.message, true); }
    renderShop(); renderDash();
  }

  /* ---------- ranks ---------- */
  function renderRanks() {
    const r = Catalog.rankInfo(me.rank_stars);
    const next = r.legend ? null : Catalog.rankInfo(me.rank_stars - r.stars + 10);
    $('rankCard').innerHTML = `
      <div class="rank-big">${Catalog.badge(me.rank_stars)}</div>
      <div class="rank-text">
        <p class="eyebrow">Your rank</p>
        <h2>${r.label}</h2>
        ${Catalog.starsRow(me.rank_stars)}
        <p>${r.legend ? `Legend stars: ${r.stars} of ${Catalog.LEGEND_MAX}. You made it to the top tier.`
          : `${10 - r.stars} more star${10 - r.stars === 1 ? '' : 's'} to reach ${next.label}.`}</p>
        <p class="rank-rec">${me.ranked_played || 0} ranked games · ${me.ranked_wins || 0} wins · best ${Catalog.rankInfo(me.best_stars || 0).label}</p>
      </div>`;
    const lad = $('ladder');
    lad.innerHTML = '';
    for (let t = 0; t < 6; t++) {
      const row = document.createElement('div');
      row.className = 'tier-row';
      const T = Catalog.TIERS[t];
      row.innerHTML = `<h3 style="--tc:${T.b}">${T.name}</h3>`;
      const steps = t < 5 ? [0, 1, 2, 3, 4].map(d => t * 50 + d * 10) : [Catalog.LEGEND_AT];
      const wrap = document.createElement('div');
      wrap.className = 'tier-steps';
      for (const st of steps) {
        const info = Catalog.rankInfo(st);
        const reached = (me.best_stars || 0) >= st;
        const cur = t === r.tier && (r.legend || info.div === r.div);
        const cell = document.createElement('div');
        cell.className = 'step' + (reached ? ' reached' : '') + (cur ? ' current' : '');
        cell.innerHTML = Catalog.badge(st, { animate: cur }) + `<span>${info.legend ? 'Legend' : info.divLabel}</span>`;
        wrap.appendChild(cell);
      }
      row.appendChild(wrap);
      lad.appendChild(row);
    }
  }

  /* ---------- leaderboard ---------- */
  const BOARD_COL = {
    rank: ['Rank', p => `<span class="lb-rank">${Catalog.badge(p.rank_stars, { ribbon: false, animate: false })}${Catalog.rankInfo(p.rank_stars).label}</span>`],
    wins: ['Wins', p => p.wins],
    streak: ['Best streak', p => p.best_streak],
    answers: ['Right answers', p => p.total_correct],
    fastest: ['Fastest', p => (p.fastest_ms / 1000).toFixed(2) + ' s'],
  };
  let boardReq = 0;
  async function loadBoard() {
    const req = ++boardReq, board = radio('board');
    const [label, value] = BOARD_COL[board];
    const note = $('boardNote');
    note.className = 'board-note'; note.textContent = 'Loading…';
    $('boardCol').textContent = label;
    if (!DB.online) { $('boardTable').hidden = true; note.textContent = 'The leaderboard needs an internet connection.'; return; }
    let rows;
    try { rows = await DB.leaderboard(board); }
    catch (e) {
      if (req !== boardReq) return;
      $('boardTable').hidden = true; note.className = 'board-note err'; note.textContent = e.message;
      return;
    }
    if (req !== boardReq) return;
    const body = $('boardBody');
    body.innerHTML = '';
    rows.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (p.id === me.id) tr.className = 'me';
      tr.innerHTML = `<td>${i + 1}</td><td>${esc(p.display_name)}</td><td>${value(p)}</td><td>${p.games_played}</td>`;
      body.appendChild(tr);
    });
    $('boardTable').hidden = !rows.length;
    note.textContent = rows.length ? '' : board === 'rank' ? 'No ranked games yet. Be the first on the board.' : 'No scores yet. Play Classic or Ranked to get on the board.';
  }
  document.querySelectorAll('input[name="board"]').forEach(r => r.addEventListener('change', loadBoard));

  /* ---------- history ---------- */
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }
  async function loadHistory() {
    const list = $('historyList'), note = $('historyNote');
    list.innerHTML = '';
    note.className = 'board-note'; note.textContent = 'Loading…';
    if (!DB.online) { note.textContent = 'Your game history needs an internet connection.'; return; }
    let rows;
    try { rows = await DB.history(); } catch (e) { note.className = 'board-note err'; note.textContent = e.message; return; }
    note.textContent = rows.length ? '' : 'No games yet. Your Classic, Ranked and Custom games show up here.';
    const opName = { add: '+', sub: '−', mul: '×', div: '÷', mix: 'Mix' };
    const modeName = { cpu: 'Vs computer', online: 'Online', classic: 'Classic', ranked: 'Ranked', custom: 'Custom' };
    for (const g of rows) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="h-out ${g.outcome}">${g.outcome}</span>
        <span class="h-main"><b>${modeName[g.mode] || g.mode} ${g.team_size}v${g.team_size}</b>
          <small>${opName[g.op] || g.op} · ${g.diff} · ${g.correct} right, ${g.wrong} slips · ${ago(g.created_at)}</small></span>
        <span class="h-rew">${g.coins ? `<span class="h-coins"><i class="coin"></i>+${g.coins}</span>` : ''}${g.stars_delta ? `<span class="h-star ${g.stars_delta > 0 ? 'up' : 'down'}">${g.stars_delta > 0 ? '+' : ''}${g.stars_delta} ★</span>` : ''}</span>`;
      list.appendChild(li);
    }
  }

  /* ---------- profile ---------- */
  function renderProfile() {
    $('nameIn').value = me.display_name;
    $('nameNote').textContent = DB.online ? '' : 'Offline: your name is saved in this browser only.';
    $('accountMail').textContent = DB.online ? `Signed in as ${DB.email}` : 'Playing offline as a guest.';
    $('signOutBtn').hidden = !DB.online;
    const rate = me.games_played ? Math.round(me.wins / me.games_played * 100) + '%' : '—';
    const stats = [
      ['Games', me.games_played], ['Wins', me.wins], ['Win rate', rate], ['Best streak', me.best_streak],
      ['Right answers', me.total_correct], ['Fastest answer', me.fastest_ms ? (me.fastest_ms / 1000).toFixed(2) + ' s' : '—'],
      ['Ranked games', me.ranked_played || 0], ['Best rank', Catalog.rankInfo(me.best_stars || 0).label],
      ['Coins', me.coins.toLocaleString()], ['Skins owned', Catalog.SKINS.filter(s => DB.owns(s.id)).length + ' / ' + Catalog.SKINS.length],
    ];
    $('statGrid').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  }
  async function saveName() {
    const name = clean($('nameIn').value);
    if (!name) { $('nameNote').textContent = 'Type a name first.'; return; }
    try { await DB.setName(name); $('nameNote').textContent = 'Saved.'; }
    catch (e) { $('nameNote').textContent = e.message; }
    renderDash();
  }
  $('nameSave').addEventListener('click', saveName);
  $('signOutBtn').addEventListener('click', signOut);
  $('nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') saveName(); });

  /* ---------- sound ---------- */
  function syncSound() {
    for (const id of ['dashSound', 'matchSound']) {
      $(id).textContent = Sfx.muted ? 'Sound: Off' : 'Sound: On';
      $(id).setAttribute('aria-pressed', String(!Sfx.muted));
    }
  }
  for (const id of ['dashSound', 'matchSound']) $(id).addEventListener('click', () => { Sfx.ensure(); Sfx.toggle(); syncSound(); });

  /* ============ players ============ */
  function mePlayer(id, side) {
    return { id, name: me.display_name, side, skin: me.skin, look: myLook(), stars: me.rank_stars };
  }
  function makeBots(n, side, level, used) {
    const out = [];
    for (let i = 0; i < n; i++) {
      let name = pick(Catalog.BOT_NAMES), guard = 0;
      while (used.has(name) && guard++ < 20) name = pick(Catalog.BOT_NAMES);
      used.add(name);
      out.push({ id: `bot${side}${i}${Math.random().toString(36).slice(2, 6)}`, name, side, bot: true, level,
        skin: pick(BOT_SKINS), look: Math.floor(Math.random() * Catalog.LOOKS.length) });
    }
    return out;
  }
  function startMatch(cfg) {
    closeOverlays();
    show('match');
    const size = Math.max(...['L', 'R'].map(k => cfg.players.filter(p => p.side === k).length));
    const kindName = cfg.kind === 'local' ? 'Same PC' : cfg.kind === 'cpu' ? 'Vs computer' : MODE_NAME[cfg.mode];
    $('matchMode').textContent = `${kindName} · ${size}v${size}`;
    Game.start(cfg);
  }

  /* ============ Classic ============ */
  function openClassic() {
    const size = +radio('classicSize');
    const p = loadPrefs();
    $('classicTitle').textContent = `Classic ${size}v${size}`;
    $('cp-local').disabled = size !== 1;
    $('cp-local').nextElementSibling.hidden = size !== 1;
    setRadio('cplay', p.cplay && !(size !== 1 && p.cplay === 'local') ? p.cplay : 'online');
    for (const k of ['op', 'diff', 'time', 'cpu']) if (p[k] != null) setRadio(k, p[k]);
    $('p2Name').value = p.p2 || '';
    syncClassic();
    $('classicSheet').hidden = false;
    $('classicGo').focus({ preventScroll: true });
  }
  function syncClassic() {
    const play = radio('cplay'), size = +radio('classicSize');
    $('cpuField').hidden = play !== 'cpu';
    $('p2Field').hidden = play !== 'local';
    $('classicNote').textContent = play === 'online'
      ? `Finds ${size === 1 ? 'another player' : '9 other players'}. If nobody turns up in ${QUICK_WAIT[size] / 1000} seconds, computer players fill in. The host's math settings are used.`
      : play === 'cpu'
        ? (size === 1 ? 'You against one computer player.' : 'You and 4 computer teammates against 5 computer players.') + ' Earns coins.'
        : 'Two players share this screen. Red uses A S D F, Blue uses J K L ;. Not saved to your stats.';
    $('classicGo').textContent = play === 'online' ? 'Find match' : 'Start';
  }
  document.querySelectorAll('input[name="cplay"]').forEach(r => r.addEventListener('change', syncClassic));
  $('classicBtn').addEventListener('click', () => { Sfx.click(); openClassic(); });
  $('classicBack').addEventListener('click', () => { $('classicSheet').hidden = true; });
  const classicSettings = () => ({ op: radio('op'), diff: radio('diff'), time: +radio('time') });
  $('classicGo').addEventListener('click', () => {
    const play = radio('cplay'), size = +radio('classicSize'), settings = classicSettings();
    savePrefs({ cplay: play, op: settings.op, diff: settings.diff, time: settings.time, cpu: radio('cpu'), p2: $('p2Name').value });
    if (play === 'online') { $('classicSheet').hidden = true; quick('classic', size, settings); return; }
    let players;
    if (play === 'local') {
      players = [mePlayer(me.id, 'L'), { id: 'p2', name: clean($('p2Name').value) || 'Blue Team', side: 'R', skin: 'classic', look: (myLook() + 3) % Catalog.LOOKS.length }];
    } else {
      const level = radio('cpu'), used = new Set();
      players = [mePlayer(me.id, 'L'), ...makeBots(size - 1, 'L', level, used), ...makeBots(size, 'R', level, used)];
    }
    lastOffline = { mode: 'classic', kind: play, host: true, me: me.id, settings, players };
    startMatch(lastOffline);
  });

  /* ============ quick match (Classic online + Ranked) ============ */
  function quick(mode, size, settings) {
    if (mode === 'ranked' && !DB.online) { toast('Ranked needs an internet connection.', true); return; }
    if (!DB.configured) { toast('Online play needs Supabase keys in config.js.', true); return; }
    closeOverlays();
    Q = { mode, size, settings: mode === 'ranked' ? RANKED_SETTINGS : settings };
    $('searchMode').textContent = `${MODE_NAME[mode]} · ${size}v${size}`;
    $('searchTitle').textContent = 'Finding players…';
    $('searchCount').textContent = `1 / ${size * 2} players`;
    $('searchNote').textContent = `If nobody turns up in about ${QUICK_WAIT[size] / 1000} seconds, computer players fill the empty spots.`;
    $('searchSheet').hidden = false;
    Net.quickMatch(mode + size, size * 2, QUICK_WAIT[size], { name: me.display_name, stars: me.rank_stars });
  }
  $('rankedBtn').addEventListener('click', () => { Sfx.click(); quick('ranked', +radio('rankedSize')); });
  $('searchCancel').addEventListener('click', () => { Q = null; Net.leave(); $('searchSheet').hidden = true; });

  Net.on('matched', ({ role, code, group }) => {
    if (!Q) { Net.leave(); return; }
    $('searchSheet').hidden = true;
    R = newRoom({ mode: Q.mode, size: Q.size, quick: true, host: role === 'host', code, settings: Q.settings });
    if (R.host) {
      R.expected = group;
      group.forEach((id, i) => {
        const side = i % 2 === 0 ? 'L' : 'R';
        R.players.push(id === Net.myId ? mePlayer(id, side) : { id, name: 'Joining…', side, pending: true });
      });
      R.autoTimer = setTimeout(startRoomMatch, 7000);
      maybeStartQuick();
    } else {
      sayHello();
    }
    openLobby();
  });

  /* ============ rooms (Custom, and quick matches before they start) ============ */
  function newRoom(o) {
    return Object.assign({
      mode: 'custom', size: 1, quick: false, host: false, code: '', players: [], expected: [],
      sizes: { L: o.size || 1, R: o.size || 1 }, fill: 'medium', settings: { op: 'mix', diff: 'easy', time: 90 },
      inMatch: false, autoTimer: 0, helloTimer: 0, rosterTimer: 0,
    }, o);
  }
  async function createRoom() {
    closeOverlays();
    Q = null;
    const p = loadPrefs();
    R = newRoom({ mode: 'custom', host: true, sizes: { L: 1, R: 1 }, fill: p.fill || 'medium',
      settings: { op: p.lop || 'mix', diff: p.ldiff || 'easy', time: p.ltime != null ? p.ltime : 90 } });
    try {
      R.code = await Net.host();
    } catch (e) { R = null; toast(e.message, true); return; }
    R.players.push(mePlayer(Net.myId, 'L'));
    openLobby();
  }
  async function joinRoom(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) { toast('Type the 5-character room code.', true); $('joinCode').focus(); return; }
    closeOverlays();
    Q = null;
    R = newRoom({ mode: 'custom', host: false, code });
    openLobby();
    $('lobbyStatus').textContent = `Joining ${code}…`;
    try { await Net.join(code); } catch (e) { R = null; $('lobby').hidden = true; toast(e.message, true); return; }
    sayHello();
  }
  $('createBtn').addEventListener('click', () => { Sfx.click(); createRoom(); });
  $('joinBtn').addEventListener('click', () => joinRoom($('joinCode').value));
  $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('joinCode').value); });

  // members introduce themselves until the host lists them
  function sayHello() {
    if (!R || R.host) return;
    clearInterval(R.helloTimer);
    const hello = () => Net.send({ t: 'hello', name: me.display_name, skin: me.skin, look: myLook(), stars: me.rank_stars });
    hello();
    let n = 0;
    R.helloTimer = setInterval(() => {
      if (!R || R.players.some(p => p.id === Net.myId) || ++n > 8) { if (R) clearInterval(R.helloTimer); return; }
      hello();
    }, 1500);
  }

  // host: keep the roster in step with who is actually in the room
  Net.on('peers', (ids, hostId) => {
    if (!R) return;
    if (!R.host) { if (hostId && !R.players.length) sayHello(); return; }
    const present = new Set(ids);
    for (const p of R.players.slice()) {
      if (p.id === Net.myId || present.has(p.id)) continue;
      if (p.pending && R.quick) continue;          // invited, still on the way
      R.players = R.players.filter(x => x !== p);
      if (R.inMatch) Game.playerLeft(p.id);
    }
    sendRoster();
    renderLobby();
  });

  function freeSide(prefer) {
    const count = k => R.players.filter(p => p.side === k).length;
    const order = prefer ? [prefer, prefer === 'L' ? 'R' : 'L'] : count('L') <= count('R') ? ['L', 'R'] : ['R', 'L'];
    return order.find(k => count(k) < R.sizes[k]) || null;
  }
  function onHello(m, from) {
    let p = R.players.find(x => x.id === from);
    if (!p) {
      if (R.quick) { Net.send({ t: 'full' }, from); return; }
      const side = freeSide() || (R.sizes.L < 5 ? (R.sizes.L++, 'L') : R.sizes.R < 5 ? (R.sizes.R++, 'R') : null);
      if (!side) { Net.send({ t: 'full' }, from); return; }
      p = { id: from, side };
      R.players.push(p);
    }
    Object.assign(p, {
      name: clean(m.name) || 'Player', pending: false,
      skin: Catalog.SKINS.some(s => s.id === m.skin) ? m.skin : 'classic',
      look: Math.abs(m.look | 0) % Catalog.LOOKS.length,
      stars: Math.max(0, Math.min(1249, m.stars | 0)),
    });
    sendRoster();
    renderLobby();
    maybeStartQuick();
  }
  function maybeStartQuick() {
    if (R && R.host && R.quick && !R.inMatch && R.players.every(p => !p.pending)) {
      clearTimeout(R.autoTimer);
      R.autoTimer = setTimeout(startRoomMatch, 900);     // a beat to see who you got
    }
  }
  function sendRoster() {
    if (!R || !R.host) return;
    clearTimeout(R.rosterTimer);
    R.rosterTimer = setTimeout(() => {
      if (!R) return;
      Net.send({ t: 'roster', mode: R.mode, quick: R.quick, size: R.size, sizes: R.sizes, fill: R.fill, settings: R.settings, inMatch: R.inMatch,
        players: R.players.map(p => ({ id: p.id, name: p.name, side: p.side, skin: p.skin, look: p.look, stars: p.stars, pending: !!p.pending })) });
    }, 60);
  }
  function movePlayer(id) {
    const p = R.players.find(x => x.id === id);
    if (!p) return;
    const to = p.side === 'L' ? 'R' : 'L';
    const count = R.players.filter(x => x.side === to).length;
    if (count >= R.sizes[to]) {
      if (R.sizes[to] < 5) R.sizes[to]++;
      else { toast(`${to === 'L' ? 'Red' : 'Blue'} is full.`, true); return; }
    }
    p.side = to;
    sendRoster();
    renderLobby();
  }

  function startRoomMatch() {
    if (!R || !R.host || R.inMatch) return;
    clearTimeout(R.autoTimer);
    const ranked = R.mode === 'ranked';
    const humans = R.players.filter(p => !p.pending);
    const avgStars = humans.reduce((a, p) => a + (p.stars || 0), 0) / Math.max(1, humans.length);
    const level = R.quick ? (ranked ? Catalog.rankBot(avgStars) : 'medium') : R.fill;
    const used = new Set(humans.map(p => p.name));
    let players = humans.map(p => ({ id: p.id, name: p.name, side: p.side, skin: p.skin, look: p.look, stars: p.stars,
      diff: ranked ? Catalog.rankDiff(p.stars) : undefined }));
    for (const k of ['L', 'R']) {
      const need = R.sizes[k] - players.filter(p => p.side === k).length;
      if (need > 0 && level !== 'none') {
        players = players.concat(makeBots(need, k, level, used).map(b => Object.assign(b, { diff: ranked ? Catalog.rankDiff(avgStars) : undefined })));
      }
    }
    if (!players.some(p => p.side === 'L') || !players.some(p => p.side === 'R')) {
      $('lobbyStatus').textContent = 'Each side needs at least one player. Add computer players or move someone across.';
      return;
    }
    const settings = R.quick ? R.settings : lobbySettings();
    R.settings = settings;
    R.inMatch = true;
    const cfg = { mode: R.mode, kind: 'online', settings, players };
    Net.send({ t: 'start', cfg });
    sendRoster();
    startMatch(Object.assign({}, cfg, { host: true, me: Net.myId }));
  }

  function lobbyMessage(m, from) {
    if (!R) return;
    const fromHost = from === Net.hostId;
    switch (m.t) {
      case 'hello': if (R.host) onHello(m, from); break;
      case 'side': if (R.host && !R.quick && !R.inMatch) movePlayer(from); break;
      case 'roster':
        if (R.host || !fromHost) return;
        Object.assign(R, { mode: m.mode, quick: !!m.quick, size: m.size, sizes: m.sizes || R.sizes, fill: m.fill, settings: m.settings || R.settings, inMatch: !!m.inMatch });
        R.players = Array.isArray(m.players) ? m.players.slice(0, 10) : [];
        renderLobby();
        break;
      case 'start':
        if (R.host || !fromHost || !m.cfg || !Array.isArray(m.cfg.players)) return;
        if (!m.cfg.players.some(p => p.id === Net.myId)) { $('lobbyStatus').textContent = 'A match is on. You will join the next one.'; return; }
        R.inMatch = true;
        startMatch(Object.assign({}, m.cfg, { host: false, me: Net.myId }));
        break;
      case 'lobby':
        if (R.host || !fromHost) return;
        R.inMatch = false;
        if (Game.active) Game.stop();
        show('dash');
        openLobby();
        break;
      case 'full':
        if (!fromHost) return;
        Net.leave(); R = null; closeOverlays();
        toast('That room is full.', true);
        break;
    }
  }
  Net.on('message', (m, from) => {
    if (!m || typeof m.t !== 'string') return;    if (Game.handles(m.t)) Game.onNet(m, from);
    else lobbyMessage(m, from);
  });
  Net.on('status', (kind, info) => {
    if (kind === 'searching') {
      $('searchCount').textContent = `${Math.min(info.found, info.need)} / ${info.need} players`;
      const left = Math.max(0, Math.ceil(((Q ? QUICK_WAIT[Q.size] : 0) - info.waited) / 1000));
      $('searchTitle').textContent = info.found >= info.need ? 'Match found!' : left > 0 ? `Finding players… ${left}` : 'Filling with computer players…';
    } else if (kind === 'connecting') {
      $('searchTitle').textContent = info;
    } else if (kind === 'fell') {
      if (Q) quick(Q.mode, Q.size, Q.settings);
    } else if (kind === 'error' || kind === 'closed') {
      if (Game.active && Game.state === 'over') {
        // the match already finished: keep the results on screen
        const custom = R && !R.quick;
        R = null;
        if (custom) { toast(info || 'The host left the room.', true); $('againBtn').disabled = true; $('homeBtn').textContent = 'Home'; }
        return;
      }
      if (Game.active) Game.stop();
      R = null; Q = null;
      closeOverlays();
      show('dash');
      toast(info || 'Connection lost.', true);
    }
  });

  /* ---------- lobby view ---------- */
  function lobbySettings() {
    return { op: radio('lop'), diff: radio('ldiff'), time: +radio('ltime') };
  }
  function openLobby() {
    closeOverlays();
    $('lobby').hidden = false;
    if (R && R.host && !R.quick) {
      setRadio('fill', R.fill); setRadio('lop', R.settings.op); setRadio('ldiff', R.settings.diff); setRadio('ltime', R.settings.time);
    }
    renderLobby();
  }
  function renderLobby() {
    if (!R || $('lobby').hidden) return;
    const custom = !R.quick;
    $('lobbyEyebrow').textContent = custom ? 'Custom room' : `${MODE_NAME[R.mode]} · ${R.size}v${R.size}`;
    $('lobbyTitle').textContent = custom ? (R.host ? 'Your room' : 'Room') : R.host ? 'Match found!' : 'Match found!';
    $('lobbyCodeRow').hidden = !custom;
    $('lobbyCode').textContent = R.code || Net.code || '-----';
    $('lobbySettings').hidden = !custom;
    $('lobbySettings').disabled = !R.host;
    if (!R.host && custom) {
      setRadio('fill', R.fill); setRadio('lop', R.settings.op); setRadio('ldiff', R.settings.diff); setRadio('ltime', R.settings.time);
    }
    for (const k of ['L', 'R']) {
      const side = R.players.filter(p => p.side === k);
      // team size picker (host of a custom room)
      const seg = $('size' + k);
      seg.innerHTML = '';
      if (custom && R.host) {
        for (let n = 1; n <= 5; n++) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = n;
          b.className = n === R.sizes[k] ? 'on' : '';
          b.disabled = n < side.length || R.inMatch;
          b.setAttribute('aria-label', `${k === 'L' ? 'Red' : 'Blue'} team: ${n} player${n > 1 ? 's' : ''}`);
          b.onclick = () => { R.sizes[k] = n; sendRoster(); renderLobby(); };
          seg.appendChild(b);
        }
      } else {
        seg.textContent = `${R.sizes[k]} player${R.sizes[k] > 1 ? 's' : ''}`;
      }
      const ol = $('slots' + k);
      ol.innerHTML = '';
      for (const p of side) {
        const li = document.createElement('li');
        li.className = 'slot' + (p.id === Net.myId ? ' me' : '') + (p.pending ? ' pending' : '');
        const cv = document.createElement('canvas'); cv.className = 'slot-av'; cv.width = 40; cv.height = 48;
        const name = document.createElement('span'); name.className = 'slot-name';
        name.textContent = p.name || 'Joining…';
        if (p.id === Net.myId) name.insertAdjacentHTML('beforeend', ' <i class="tag you">YOU</i>');
        if (p.id === (R.host ? Net.myId : Net.hostId)) name.insertAdjacentHTML('beforeend', ' <i class="tag">HOST</i>');
        const rk = document.createElement('span'); rk.className = 'slot-rank';
        if (p.stars != null && !p.pending) rk.innerHTML = Catalog.badge(p.stars, { ribbon: false, animate: false });
        li.append(cv, name, rk);
        if (custom && R.host && !R.inMatch) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'swap'; b.textContent = '⇄';
          b.title = `Move ${p.name} to ${k === 'L' ? 'Blue' : 'Red'}`;
          b.setAttribute('aria-label', b.title);
          b.onclick = () => movePlayer(p.id);
          li.appendChild(b);
        }
        ol.appendChild(li);
        if (!p.pending) renderAvatar(cv, p.skin || 'classic', p.look || 0, 0.6, 'stand', 'bust');
      }
      const fillName = R.quick ? 'Computer' : R.fill === 'none' ? '' : `${Game.CPU[R.fill].name} CPU`;
      for (let i = side.length; i < R.sizes[k]; i++) {
        const li = document.createElement('li');
        li.className = 'slot empty';
        li.textContent = fillName ? `${fillName} if empty` : 'Empty';
        ol.appendChild(li);
      }
    }
    const start = $('lobbyStart');
    start.hidden = !(R.host && custom);
    start.disabled = R.inMatch;
    $('lobbySwitch').hidden = !custom || R.inMatch;
    const st = $('lobbyStatus');
    if (R.quick) st.textContent = R.host ? 'Waiting for everyone to connect… computer players fill any gaps.' : 'Waiting for the host to start…';
    else if (R.inMatch) st.textContent = 'A match is on. You will join the next one.';
    else if (R.host) st.textContent = R.players.length > 1 ? 'Move players with ⇄, pick team sizes, then Start.' : 'Share the code. Friends join from Custom → Join.';
    else st.textContent = R.players.some(p => p.id === Net.myId) ? 'Waiting for the host to start…' : 'Joining…';
  }
  $('lobbyStart').addEventListener('click', () => {
    savePrefs({ fill: radio('fill'), lop: radio('lop'), ldiff: radio('ldiff'), ltime: +radio('ltime') });
    startRoomMatch();
  });
  $('lobbySwitch').addEventListener('click', () => { if (!R) return; if (R.host) movePlayer(Net.myId); else Net.send({ t: 'side' }); });
  $('lobbyLeave').addEventListener('click', () => { leaveRoom(); });
  document.querySelectorAll('#lobbySettings input').forEach(r => r.addEventListener('change', () => {
    if (!R || !R.host) return;
    R.fill = radio('fill'); R.settings = lobbySettings();
    sendRoster(); renderLobby();
  }));
  $('copyBtn').addEventListener('click', () => {
    const link = Net.inviteLink(R ? R.code : '');
    const done = () => { $('copyBtn').textContent = 'Copied'; setTimeout(() => { $('copyBtn').textContent = 'Copy invite'; }, 1400); };
    try { navigator.clipboard.writeText(link).then(done, () => toast(`Invite: ${link}`)); } catch (e) { toast(`Invite: ${link}`); }
  });
  function leaveRoom() {
    if (R) { clearTimeout(R.autoTimer); clearInterval(R.helloTimer); }
    Net.leave();
    R = null; Q = null;
    if (Game.active) Game.stop();
    closeOverlays();
    show('dash');
    renderDash();
  }

  /* ============ in-match controls ============ */
  $('quitBtn').addEventListener('click', () => {
    const online = Game.cfg && Game.cfg.kind === 'online';
    if (Game.state === 'play' && !confirm(online ? 'Leave this match? You will not get a result for it.' : 'Leave this match?')) return;
    if (online) leaveRoom();
    else { Game.stop(); closeOverlays(); show('dash'); renderDash(); }
  });

  /* ============ results + rewards ============ */
  Game.on('end', sum => showResult(sum));
  function outcomeFor(sum, side) { return !sum.w ? 'draw' : (sum.w < 0) === (side === 'L') ? 'win' : 'loss'; }
  function showResult(sum) {
    const cfg = sum.cfg;
    const mine = sum.players.find(p => p.local && (cfg.kind !== 'local'));
    const teamName = k => {
      const side = sum.players.filter(p => p.side === k);
      return side.length === 1 ? side[0].name : k === 'L' ? 'Red Team' : 'Blue Team';
    };
    const title = $('resTitle');
    const winner = sum.w < 0 ? teamName('L') : sum.w > 0 ? teamName('R') : '';
    title.className = 'res-title' + (sum.w < 0 ? ' red' : sum.w > 0 ? ' blue' : '');
    title.textContent = mine && cfg.kind !== 'local'
      ? { win: 'Victory!', loss: 'Defeat', draw: 'Dead heat!' }[outcomeFor(sum, mine.side)]
      : sum.w ? `${winner} wins!` : 'Dead heat!';
    const opName = { add: 'Adding', sub: 'Subtracting', mul: 'Times tables', div: 'Dividing', mix: 'Mixed' }[sum.settings.op];
    $('resEyebrow').textContent = `${$('matchMode').textContent} · ${opName}`;
    $('resSub').textContent = sum.why === 'line'
      ? `${winner} dragged the ribbon over the line in ${Math.round(sum.elapsed)} s.`
      : sum.w ? `Time's up. ${winner} held more of the rope.` : `Time's up with the ribbon dead centre.`;
    renderResultTable(sum);

    // buttons
    const again = $('againBtn');
    again.disabled = false;
    if (cfg.kind !== 'online') again.textContent = 'Rematch';
    else if (R && !R.quick) { again.textContent = R.host ? 'Back to room' : 'Waiting for host…'; again.disabled = !R.host; }
    else again.textContent = 'Play again';
    $('homeBtn').textContent = R && !R.quick ? 'Leave room' : 'Home';

    // save + rewards
    const rw = $('rewards');
    rw.hidden = true;
    if (mine && DB.online) {
      rw.hidden = false;
      rw.innerHTML = '<p class="rw-wait">Saving your result…</p>';
      saveResult(sum, mine).then(res => showRewards(res, cfg));
    } else if (mine && !DB.online) {
      rw.hidden = false;
      rw.innerHTML = '<p class="rw-wait">Offline: this result is not saved.</p>';
    }
    // a quick room has done its job once the result is in
    if (R && R.quick) { Net.leave(); R = null; }
    $('result').hidden = false;
    if (!again.disabled) again.focus({ preventScroll: true });
  }
  function renderResultTable(sum) {
    const table = $('resTable');
    const L = sum.players.filter(p => p.side === 'L'), Rr = sum.players.filter(p => p.side === 'R');
    const fast = s => (s.fastest === Infinity || s.fastest == null ? null : s.fastest);
    const avg = s => (s.correct ? s.timeSum / s.correct : null);
    if (L.length === 1 && Rr.length === 1) {
      const a = L[0].stats, b = Rr[0].stats;
      const rows = [
        ['Right answers', s => s.correct, 'hi', v => v],
        ['Slips', s => s.wrong, 'lo', v => v],
        ['Best streak', s => s.best, 'hi', v => v],
        ['Fastest answer', fast, 'lo', v => v.toFixed(2) + ' s'],
        ['Average answer', avg, 'lo', v => v.toFixed(2) + ' s'],
      ];
      let h = `<thead><tr><th></th><th class="kr">${esc(L[0].name)}</th><th class="kb">${esc(Rr[0].name)}</th></tr></thead><tbody>`;
      for (const [label, get, better, fmt] of rows) {
        const x = get(a), y = get(b);
        const cell = (v, o) => {
          const win = v !== null && ((o !== null && v !== o && (better === 'hi' ? v > o : v < o)) || o === null);
          return `<td${win ? ' class="win"' : ''}>${v === null ? '—' : fmt(v)}</td>`;
        };
        h += `<tr><td>${label}</td>${cell(x, y)}${cell(y, x)}</tr>`;
      }
      table.innerHTML = h + '</tbody>';
      table.className = 'stats';
      return;
    }
    const winSide = sum.w < 0 ? 'L' : sum.w > 0 ? 'R' : null;
    const mvp = winSide ? sum.players.filter(p => p.side === winSide).sort((a, b) => b.stats.correct - a.stats.correct)[0] : null;
    let h = '<thead><tr><th>Player</th><th>Right</th><th>Slips</th><th>Streak</th></tr></thead><tbody>';
    for (const [k, side] of [['L', L], ['R', Rr]]) {
      h += `<tr class="team-row ${k === 'L' ? 'red' : 'blue'}"><td colspan="4">${k === 'L' ? 'Red' : 'Blue'} team${winSide === k ? ' · winners' : ''}</td></tr>`;
      for (const p of side.slice().sort((a, b) => b.stats.correct - a.stats.correct)) {
        const tags = (p.local && sum.cfg.kind !== 'local' ? ' <i class="tag you">YOU</i>' : '') + (p.bot ? ' <i class="tag">CPU</i>' : '') + (p === mvp ? ' <i class="tag mvp">MVP</i>' : '');
        h += `<tr${p.local ? ' class="me"' : ''}><td>${esc(p.name)}${tags}</td><td>${p.stats.correct}</td><td>${p.stats.wrong}</td><td>${p.stats.best}</td></tr>`;
      }
    }
    table.innerHTML = h + '</tbody>';
    table.className = 'stats team-table';
  }
  async function saveResult(sum, p) {
    const cfg = sum.cfg, s = p.stats;
    const mode = cfg.kind === 'cpu' ? 'cpu' : cfg.mode;
    const bot = sum.players.find(x => x.bot && x.side !== p.side);
    return DB.saveResult({
      p_mode: mode,
      p_team_size: sum.players.filter(x => x.side === p.side).length,
      p_op: sum.settings.op, p_diff: p.diff || sum.settings.diff, p_round_secs: sum.settings.time,
      p_cpu_level: cfg.kind === 'cpu' && bot ? bot.level : null,
      p_outcome: outcomeFor(sum, p.side),
      p_correct: s.correct, p_wrong: s.wrong, p_best_streak: s.best,
      p_fastest_ms: s.fastest === Infinity || s.fastest == null ? null : Math.max(1, Math.round(s.fastest * 1000)),
      p_elapsed_secs: Math.round(sum.elapsed * 100) / 100,
    });
  }
  function showRewards(res, cfg) {
    const rw = $('rewards');
    if (!res) { rw.innerHTML = '<p class="rw-wait">This round could not be saved.</p>'; return; }
    me = DB.profile;
    let h = '';
    if (res.coins) h += `<div class="rw-coins"><i class="coin big"></i><b id="rwCoins">+0</b><small>coins</small></div>`;
    else if (cfg.mode === 'custom') h += '<p class="rw-wait">Custom games are practice: no coins or stars.</p>';
    if (cfg.mode === 'ranked') {
      const before = Catalog.rankInfo(res.stars_before), after = Catalog.rankInfo(res.stars_after);
      const d = res.stars_after - res.stars_before;
      const promoted = after.tier > before.tier || (after.tier === before.tier && after.div > before.div);
      const demoted = after.tier < before.tier || (after.tier === before.tier && after.div < before.div);
      h += `<div class="rw-rank${promoted ? ' promo' : ''}"><span class="rw-badge">${Catalog.badge(res.stars_after)}</span>
        <div><b>${after.label}</b>${Catalog.starsRow(res.stars_after)}
        <small class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+1 star' : d < 0 ? '−1 star' : 'No star change'}</small></div></div>`;
      if (promoted) h += `<p class="rw-promo">Promoted to ${after.label}!</p>`;
      if (demoted) h += `<p class="rw-demo">Dropped to ${after.label}. Win it back!</p>`;
      if (promoted) { Sfx.rankUp(); confettiBurst(140); }
    }
    rw.innerHTML = h || '<p class="rw-wait">Saved.</p>';
    if (res.coins) {
      Sfx.coin();
      const el = $('rwCoins'), t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 700);
        el.textContent = '+' + Math.round(res.coins * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    renderDash();
  }
  $('againBtn').addEventListener('click', () => {
    const cfg = Game.cfg;
    if (!cfg) return;
    if (cfg.kind !== 'online') { if (lastOffline) startMatch(lastOffline); return; }
    if (R && !R.quick && R.host) {
      Game.stop();
      R.inMatch = false;
      Net.send({ t: 'lobby' });
      sendRoster();
      show('dash');
      openLobby();
      return;
    }
    const mode = cfg.mode, size = Math.max(cfg.players.filter(p => p.side === 'L').length, cfg.players.filter(p => p.side === 'R').length);
    Game.stop();
    show('dash');
    quick(mode, size, cfg.settings);
  });
  $('homeBtn').addEventListener('click', () => {
    if (R && !R.quick) { leaveRoom(); return; }
    Game.stop(); closeOverlays(); show('dash'); renderDash();
  });

  /* ============ keyboard ============ */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (!$('landing').hidden) {
      // forms handle their own keys; Enter on the landing screen plays when signed in
      if (e.key === 'Enter' && !$('landGo').hidden && tag !== 'INPUT' && tag !== 'BUTTON') { e.preventDefault(); enter(); }
      return;
    }
    if (e.key === 'Escape') {
      if (!$('classicSheet').hidden) { $('classicSheet').hidden = true; return; }
      if (!$('searchSheet').hidden) { $('searchCancel').click(); return; }
    }
    if (!$('match').hidden && tag !== 'INPUT' && $('result').hidden) {
      if (Game.onKey(e)) e.preventDefault();
    }
  });

  /* ============ main loop ============ */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    Game.tick(dt);
    if (!$('match').hidden) { stepScene(dt); renderScene(dt); }
    else animateHero(dt);
    requestAnimationFrame(frame);
  }
  // Hidden tabs get no animation frames. Keep the clock, rope and rules running
  // so an online match never stalls when a player switches tabs.
  setInterval(() => {
    const now = performance.now();
    if (now - last < 200) return;
    let rest = Math.min(2, (now - last) / 1000);
    last = now;
    while (rest > 0) { const dt = Math.min(0.05, rest); Game.tick(dt); stepScene(dt); rest -= dt; }
  }, 250);
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => { if (!$('dash').hidden) drawAvatars(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (me && !$('dash').hidden) drawAvatars(); });
  syncSound();
  show('landing');
})();
