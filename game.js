/* Tug of Math — rules, questions, input, computer player, online play and sound.
   Moves the rope by writing to the scene state `S` from scene.js.
   Online: the host runs the rules and sends events; the guest sends its
   answers and plays back what the host reports (see net.js for the link). */
(() => {
  const $ = id => document.getElementById(id);
  const settings = { mode: 'local', cpu: 'medium', op: 'mix', diff: 'easy', time: 90, names: { L: '', R: '' } };
  const NAMES_KEY = 'tug-of-math-names';

  const KEYS = {
    L: { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 },
    R: { KeyJ: 0, KeyK: 1, KeyL: 2, Semicolon: 3, Digit7: 0, Digit8: 1, Digit9: 2, Digit0: 3 },
  };
  const KEY_LABEL = { L: ['A', 'S', 'D', 'F'], R: ['J', 'K', 'L', ';'] };
  const CPU = {
    easy:   { min: 3.0, max: 5.2, acc: 0.74, name: 'Rookie' },
    medium: { min: 1.9, max: 3.3, acc: 0.87, name: 'Athlete' },
    hard:   { min: 1.05, max: 2.0, acc: 0.95, name: 'Champion' },
  };
  const DEFAULT_MSG = 'Faster answers pull harder';
  const NET_HINT = 'Host a game to get a room code, or type a friend’s code and join.';

  /* ---------- state ---------- */
  function makeSide(k) {
    return { k, q: null, qStart: 0, lockUntil: 0, streak: 0, best: 0, correct: 0, wrong: 0, fastest: Infinity, timeSum: 0 };
  }
  const G = {
    state: 'menu', timeLeft: 0, elapsed: 0, shownSec: -1, qid: 0, syncT: 0, oppName: '',
    sides: { L: makeSide('L'), R: makeSide('R') }, timers: new Set(), cpuIds: [],
  };

  function later(fn, ms) {
    const id = setTimeout(() => { G.timers.delete(id); fn(); }, ms);
    G.timers.add(id);
    return id;
  }
  function clearTimers() { G.timers.forEach(clearTimeout); G.timers.clear(); G.cpuIds = []; }

  /* who controls which side */
  const online = () => settings.mode === 'online';
  const isHost = () => online() && Net.role === 'host';
  const isGuest = () => online() && Net.role === 'guest';
  const mySide = () => (isGuest() ? 'R' : 'L');
  const isCpu = k => k === 'R' && settings.mode === 'cpu';
  const isRemote = k => online() && k !== mySide();
  const broadcast = msg => { if (isHost()) Net.send(msg); };
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 14);

  /* ---------- UI refs + answer buttons ---------- */
  const ui = {};
  for (const k of ['L', 'R']) {
    ui[k] = { panel: $('panel' + k), q: $('q' + k), wrap: $('ans' + k), msg: $('msg' + k), pow: $('pow' + k),
      pulls: $('pulls' + k), streak: $('streak' + k), name: $('name' + k), btns: [] };
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ans'; b.id = `ans${k}${i}`;
      b.innerHTML = `<span class="key">${KEY_LABEL[k][i]}</span><span class="val">–</span>`;
      b.addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); answer(k, i, 'tap'); });
      b.addEventListener('click', e => { if (e.detail === 0) answer(k, i, 'key'); });   // keyboard activation
      ui[k].wrap.appendChild(b); ui[k].btns.push(b);
    }
  }
  function pressFx(b) { b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 110); }
  function setMsg(k, text, cls) { const m = ui[k].msg; m.textContent = text; m.className = 'msg' + (cls ? ' ' + cls : ''); }
  function setStats(k, correct, streak) {
    ui[k].pulls.textContent = correct;
    ui[k].streak.textContent = streak >= 2 ? `${streak} in a row` : '';
  }
  function teamName(k) {
    if (k === 'L') return settings.names.L || 'Red Team';
    return isCpu('R') ? 'Computer' : settings.names.R || 'Blue Team';
  }

  /* ---------- questions ---------- */
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const RANGES = {
    add: { easy: [1, 10], medium: [8, 60], hard: [25, 250] },
    sub: { easy: [1, 10], medium: [5, 50], hard: [20, 200] },
    mul: { easy: [[1, 5], [1, 10]], medium: [[2, 10], [2, 12]], hard: [[4, 15], [6, 19]] },
    div: { easy: [[2, 5], [1, 10]], medium: [[2, 10], [2, 12]], hard: [[4, 15], [6, 19]] },
  };
  function buildQuestion() {
    const op = settings.op === 'mix' ? ['add', 'sub', 'mul', 'div'][rnd(0, 3)] : settings.op;
    const d = settings.diff;
    let a, b, ans, text;
    if (op === 'add') { const [lo, hi] = RANGES.add[d]; a = rnd(lo, hi); b = rnd(lo, hi); ans = a + b; text = `${a} + ${b}`; }
    else if (op === 'sub') { const [lo, hi] = RANGES.sub[d]; b = rnd(lo, hi); ans = rnd(lo - 1, hi); a = ans + b; text = `${a} − ${b}`; }
    else if (op === 'mul') { const [ra, rb] = RANGES.mul[d]; a = rnd(...ra); b = rnd(...rb); if (Math.random() < 0.5) [a, b] = [b, a]; ans = a * b; text = `${a} × ${b}`; }
    else { const [ra, rb] = RANGES.div[d]; b = rnd(...ra); ans = rnd(...rb); a = b * ans; text = `${a} ÷ ${b}`; }
    return { id: ++G.qid, text, ans, options: makeOptions(ans, op, a, b) };
  }
  function makeOptions(ans, op, a, b) {
    const c = [ans + 1, ans - 1, ans + 2, ans - 2, ans + 10, ans - 10];
    if (op === 'mul') c.push(ans + a, ans - a, ans + b, ans - b);
    if (op === 'div') c.push(ans + 3, ans * 2, Math.round(ans / 2));
    if (op === 'add' || op === 'sub') c.push(ans + 11, ans - 9, ans + 9);
    shuffle(c);
    const set = new Set([ans]);
    for (const v of c) { if (set.size >= 4) break; if (v >= 0) set.add(v); }
    let guard = 0;
    while (set.size < 4 && guard++ < 60) { const v = ans + rnd(-15, 15); if (v >= 0) set.add(v); }
    return shuffle([...set]);
  }

  /* ---------- sound ---------- */
  const Sfx = (() => {
    let ac = null, muted = false;
    function ensure() {
      try {
        if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { ac = null; }
    }
    function tone(f, dur, type, vol, when, slide) {
      if (!ac || muted) return;
      const t = ac.currentTime + (when || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function whoosh(vol, when) {
      if (!ac || muted) return;
      const t = ac.currentTime + (when || 0), len = 0.28;
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1400, t + len);
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(bp); bp.connect(g); g.connect(ac.destination);
      src.start(t);
    }
    return {
      ensure,
      correct(speed) { tone(620, 0.1, 'triangle', 0.16); tone(930 + speed * 260, 0.18, 'triangle', 0.14, 0.06); whoosh(0.18 + speed * 0.12, 0.02); },
      wrong() { tone(190, 0.32, 'sawtooth', 0.08, 0, 0.55); tone(140, 0.3, 'square', 0.04, 0.03, 0.6); },
      beep(hi) { tone(hi ? 880 : 560, hi ? 0.45 : 0.16, 'square', 0.07); if (hi) tone(1320, 0.35, 'triangle', 0.08, 0.05); },
      win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, 'triangle', 0.14, i * 0.1)); },
      tie() { tone(440, 0.3, 'triangle', 0.12); tone(440, 0.3, 'triangle', 0.12, 0.32); },
      toggle() { muted = !muted; return muted; },
    };
  })();

  /* ---------- presentation: what both screens show and play ---------- */
  function showQuestion(k, q) {
    const u = ui[k];
    u.q.textContent = q.text;
    u.q.classList.remove('fresh'); void u.q.offsetWidth; u.q.classList.add('fresh');
    q.options.forEach((v, i) => {
      const b = u.btns[i];
      b.classList.remove('good', 'bad', 'think', 'press');
      b.querySelector('.val').textContent = v;
      b.setAttribute('aria-label', `${v} (key ${KEY_LABEL[k][i]})`);
    });
    u.panel.classList.remove('locked');
  }
  const speedOf = secs => clamp(1 - (secs - 0.9) / 4.5, 0, 1);
  const speedWord = sp => (sp > 0.8 ? 'Lightning pull!' : sp > 0.45 ? 'Strong pull!' : 'Pull!');
  function pullFx(k, speed, streak) {
    const dir = k === 'L' ? -1 : 1;
    const imp = 0.6 + speed * 0.4;
    if (k === 'L') S.pullL = Math.max(S.pullL, imp); else S.pullR = Math.max(S.pullR, imp);
    S.shake = Math.max(S.shake, speed * 0.25);
    const x = VW / 2 + S.pos * RANGE + dir * 200;
    popText(x, 246, speed > 0.8 ? 'HEAVE!' : speed > 0.45 ? 'PULL!' : 'tug', k === 'L' ? '#ff6a5e' : '#6fb0ff', 22 + speed * 12);
    if (streak >= 3) popText(x, 214, `${streak} in a row`, '#ffd23f', 17);
  }
  // echo = the guest already showed its own result the moment it answered
  function presentHit(k, i, d, echo) {
    const u = ui[k];
    if (!echo) { u.btns[i].classList.add('good'); Sfx.correct(d.speed); }
    setMsg(k, `${speedWord(d.speed)} ${Number(d.secs).toFixed(1)} s`, 'hot');
    u.pow.style.width = Math.round(clamp(d.power / 0.18, 0.15, 1) * 100) + '%';
    pullFx(k, d.speed, d.streak);
    setStats(k, d.correct, d.streak);
  }
  function presentMiss(k, i, d, echo) {
    const u = ui[k];
    if (!echo) { u.btns[i].classList.add('bad'); Sfx.wrong(); }
    u.panel.classList.add('locked');
    if (k === 'L') S.flinchL = 1; else S.flinchR = 1;
    setMsg(k, `Slipped! ${d.text} = ${d.ans}`, 'oops');
    u.pow.style.width = '0%';
    setStats(k, d.correct, 0);
  }

  /* ---------- rules: run on same-PC, vs-computer, and by the online host ---------- */
  function nextQuestion(k) {
    const s = G.sides[k];
    let q, guard = 0;
    do { q = buildQuestion(); } while (s.q && q.text === s.q.text && guard++ < 10);
    s.q = q; s.qStart = performance.now(); s.lockUntil = 0;
    showQuestion(k, q);
    broadcast({ t: 'q', k, q });
    if (isCpu(k)) scheduleCpu();
  }
  function judge(k, i, secs) {
    const s = G.sides[k], now = performance.now();
    const dir = k === 'L' ? -1 : 1;
    if (s.q.options[i] === s.q.ans) {
      s.correct++; s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.fastest = Math.min(s.fastest, secs);
      s.timeSum += secs;
      const speed = speedOf(secs);
      const power = 0.065 + 0.075 * speed + Math.min(s.streak - 1, 5) * 0.008;
      S.target = clamp(S.target + dir * power, -1.25, 1.25);
      const d = { secs, speed, power, streak: s.streak, correct: s.correct, target: S.target };
      s.lockUntil = now + 220;
      presentHit(k, i, d, false);
      broadcast({ t: 'hit', k, i, d });
      later(() => { if (G.state === 'play') nextQuestion(k); }, 220);
    } else {
      s.wrong++; s.streak = 0;
      S.target = clamp(S.target - dir * 0.035, -1.25, 1.25);
      const d = { text: s.q.text, ans: s.q.ans, correct: s.correct, target: S.target };
      s.lockUntil = now + 1000;
      presentMiss(k, i, d, false);
      broadcast({ t: 'miss', k, i, d });
      later(() => { if (G.state === 'play') nextQuestion(k); }, 1000);
    }
  }
  function answer(k, i, source) {
    if (G.state !== 'play') return;
    if (isCpu(k) && source !== 'cpu') return;
    if (isRemote(k)) return;
    const s = G.sides[k], now = performance.now();
    if (!s.q || now < s.lockUntil) return;
    const secs = (now - s.qStart) / 1000;
    if (isGuest()) {
      // show the result right away; the host confirms it and moves the rope
      const ok = s.q.options[i] === s.q.ans;
      s.lockUntil = now + (ok ? 5000 : 1000);
      ui[k].btns[i].classList.add(ok ? 'good' : 'bad');
      if (ok) Sfx.correct(speedOf(secs));
      else { Sfx.wrong(); ui[k].panel.classList.add('locked'); }
      Net.send({ t: 'ans', qid: s.q.id, i, secs });
      return;
    }
    judge(k, i, secs);
  }
  function remoteAnswer(m) {
    const s = G.sides.R, i = m.i | 0;
    if (G.state !== 'play' || !s.q || s.q.id !== m.qid || i < 0 || i > 3) return;
    if (performance.now() < s.lockUntil) return;
    judge('R', i, clamp(Number(m.secs) || 0, 0.25, 120));
  }

  /* ---------- computer player ---------- */
  function scheduleCpu() {
    G.cpuIds.forEach(id => { clearTimeout(id); G.timers.delete(id); });
    const c = CPU[settings.cpu];
    const f = { easy: 1, medium: 1.2, hard: 1.45 }[settings.diff];
    const delay = (c.min + Math.random() * (c.max - c.min)) * f * 1000;
    const s = G.sides.R, btns = ui.R.btns;
    let pick = s.q.options.indexOf(s.q.ans);
    if (Math.random() > c.acc) { const w = [0, 1, 2, 3].filter(i => i !== pick); pick = w[rnd(0, 2)]; }
    const clear = () => btns.forEach(b => b.classList.remove('think'));
    G.cpuIds = [
      later(() => { clear(); btns[rnd(0, 3)].classList.add('think'); }, delay * 0.45),
      later(() => { clear(); btns[pick].classList.add('think'); }, delay * 0.8),
      later(() => { clear(); if (G.state === 'play') { pressFx(btns[pick]); answer('R', pick, 'cpu'); } }, delay),
    ];
  }

  /* ---------- settings + names ---------- */
  const radio = n => document.querySelector(`input[name="${n}"]:checked`).value;
  function menuSettings() { return { op: radio('op'), diff: radio('diff'), time: +radio('time') }; }
  function showSettings(p) {
    for (const [name, v] of [['op', p.op], ['diff', p.diff], ['time', p.time]]) {
      const el = document.getElementById(`${name}-${v}`);
      if (el) el.checked = true;
    }
  }
  function readSettings() {
    settings.mode = radio('mode');
    settings.cpu = radio('cpu');
    Object.assign(settings, menuSettings());
    const me = clean($('nameInL').value);
    if (isHost()) settings.names = { L: me, R: G.oppName };
    else if (isGuest()) settings.names = { L: G.oppName, R: me };
    else settings.names = { L: me, R: settings.mode === 'cpu' ? '' : clean($('nameInR').value) };
    try { localStorage.setItem(NAMES_KEY, JSON.stringify({ L: $('nameInL').value, R: $('nameInR').value })); } catch (e) { /* storage blocked */ }
  }
  function loadNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || 'null');
      if (saved) { $('nameInL').value = saved.L || ''; $('nameInR').value = saved.R || ''; }
    } catch (e) { /* storage blocked or bad data */ }
  }
  function applyRemoteSettings(p) {
    const ok = (v, list) => list.includes(v);
    if (ok(p.op, ['add', 'sub', 'mul', 'div', 'mix'])) settings.op = p.op;
    if (ok(p.diff, ['easy', 'medium', 'hard'])) settings.diff = p.diff;
    if (ok(+p.time, [0, 60, 90])) settings.time = +p.time;
    if (p.names) settings.names = { L: clean(p.names.L), R: clean(p.names.R) };
  }
  function applyNames() {
    ui.L.name.textContent = teamName('L');
    ui.R.name.textContent = teamName('R');
    $('resNameL').textContent = teamName('L');
    $('resNameR').textContent = teamName('R');
    TEAM.L.label = teamName('L').toUpperCase();
    TEAM.R.label = teamName('R').toUpperCase();
    for (const k of ['L', 'R']) {
      ui[k].panel.classList.toggle('cpu', isCpu(k));
      ui[k].panel.classList.toggle('mine', online() && k === mySide());
      ui[k].panel.classList.toggle('remote', isRemote(k));
    }
    ui.L.panel.setAttribute('aria-label', teamName('L') + ' (red side)');
    ui.R.panel.setAttribute('aria-label', teamName('R') + ' (blue side)');
  }

  /* ---------- round flow ---------- */
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
  function renderTimer(force) {
    const t = $('timer');
    const sec = settings.time > 0 ? Math.ceil(G.timeLeft) : Math.floor(G.elapsed);
    if (sec === G.shownSec && !force) return;
    G.shownSec = sec;
    t.textContent = fmt(sec);
    t.classList.toggle('hurry', settings.time > 0 && G.state === 'play' && sec <= 10 && sec > 0);
  }
  function resetRound() {
    clearTimers();
    G.sides = { L: makeSide('L'), R: makeSide('R') };
    G.timeLeft = settings.time; G.elapsed = 0; G.shownSec = -1; G.syncT = 0;
    Object.assign(S, { pos: 0, target: 0, vel: 0, pullL: 0, pullR: 0, flinchL: 0, flinchR: 0, winner: 0, winT: 0, shake: 0 });
    resetLanded();
    parts.length = 0;
    for (const k of ['L', 'R']) {
      const u = ui[k];
      u.q.textContent = '?';
      u.btns.forEach(b => { b.classList.remove('good', 'bad', 'think', 'press'); b.querySelector('.val').textContent = '–'; });
      u.panel.classList.remove('locked', 'idle');
      u.pow.style.width = '0%';
      setMsg(k, isCpu(k) ? `Computer: ${CPU[settings.cpu].name}` : isRemote(k) ? 'Playing on another device' : DEFAULT_MSG);
      setStats(k, 0, 0);
    }
    renderTimer(true);
  }
  function beginRound() {
    Sfx.ensure();
    applyNames();
    resetRound();
    $('menu').hidden = true; $('result').hidden = true;
    refreshMenu();
  }
  function runCountdown(onGo) {
    G.state = 'ready'; S.mode = 'ready';
    refreshMenu();
    const count = $('count');
    count.hidden = false;
    ['3', '2', '1', 'PULL!'].forEach((w, i) => later(() => {
      count.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = w;
      if (i === 3) span.className = 'go-word';
      count.appendChild(span);
      Sfx.beep(i === 3);
      if (i === 3) onGo();
    }, i * 700));
    later(() => { count.hidden = true; }, 2800);
  }
  function startGame() {
    if (isGuest()) return;
    if (online() && !Net.connected) { setNetStatus('Wait for a friend to join before starting.', 'err'); return; }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    readSettings();
    beginRound();
    broadcast({ t: 'start', s: { ...menuSettings(), names: settings.names } });
    runCountdown(beginPlay);
  }
  function beginPlay() {
    G.state = 'play'; S.mode = 'play';
    nextQuestion('L'); nextQuestion('R');
  }
  function guestPlay() {
    if (G.state === 'ready') { G.state = 'play'; S.mode = 'play'; }
  }
  const packSide = s => ({ correct: s.correct, wrong: s.wrong, best: s.best, timeSum: s.timeSum, fastest: s.fastest === Infinity ? null : s.fastest });
  const unpackSide = (k, p) => Object.assign(makeSide(k), p || {}, { fastest: p && typeof p.fastest === 'number' ? p.fastest : Infinity });
  function endGame(w, why) {
    if (G.state !== 'play') return;
    broadcast({ t: 'end', w, why, elapsed: G.elapsed, stats: { L: packSide(G.sides.L), R: packSide(G.sides.R) } });
    presentEnd(w, why);
  }
  function presentEnd(w, why) {
    G.state = 'over'; S.mode = 'over'; S.winner = w; S.winT = 0;
    clearTimers();
    $('count').hidden = true;
    for (const k of ['L', 'R']) { ui[k].panel.classList.add('idle'); ui[k].btns.forEach(b => b.classList.remove('think')); }
    renderTimer(true);
    if (w) {
      S.target = w * 1.12;
      S.shake = 0.8;
      Sfx.win();
      confettiBurst(120);
      later(() => confettiBurst(80), 700);
      const k = w < 0 ? 'L' : 'R';
      setMsg(k, !online() || k === mySide() ? 'You win!' : 'Winner!', 'hot');
      setMsg(k === 'L' ? 'R' : 'L', 'Pulled over the line');
    } else {
      S.target = S.pos;
      Sfx.tie();
    }
    refreshMenu();
    later(() => showResult(w, why), 1900);
  }
  function showResult(w, why) {
    const title = $('resTitle');
    const winner = w < 0 ? teamName('L') : w > 0 ? teamName('R') : '';
    title.className = 'res-title' + (w < 0 ? ' red' : w > 0 ? ' blue' : '');
    title.textContent = w ? `${winner} wins!` : 'Dead heat!';
    const opName = { add: 'Adding', sub: 'Subtracting', mul: 'Times tables', div: 'Dividing', mix: 'Mixed' }[settings.op];
    const lvl = settings.diff[0].toUpperCase() + settings.diff.slice(1);
    const modeName = online() ? (Net.via === 'lan' ? 'LAN game' : 'Online game') : settings.mode === 'cpu' ? 'Vs computer' : 'Same PC';
    $('resEyebrow').textContent = `${modeName} · ${opName} · ${lvl}`;
    $('resSub').textContent = why === 'line'
      ? `Dragged the ribbon over the line in ${fmt(G.elapsed)}.`
      : w ? `Time's up. ${winner} held more of the rope.` : `Time's up with the ribbon dead centre.`;

    const L = G.sides.L, R = G.sides.R;
    const rows = [
      ['Right answers', s => s.correct, 'hi', v => v],
      ['Slips', s => s.wrong, 'lo', v => v],
      ['Best streak', s => s.best, 'hi', v => v],
      ['Fastest answer', s => (s.fastest === Infinity ? null : s.fastest), 'lo', v => v.toFixed(2) + ' s'],
      ['Average answer', s => (s.correct ? s.timeSum / s.correct : null), 'lo', v => v.toFixed(2) + ' s'],
    ];
    const body = $('resBody');
    body.innerHTML = '';
    for (const [label, get, better, show] of rows) {
      const a = get(L), b = get(R);
      const tr = document.createElement('tr');
      const th = document.createElement('td'); th.textContent = label; tr.appendChild(th);
      for (const [v, o] of [[a, b], [b, a]]) {
        const td = document.createElement('td');
        td.textContent = v === null ? '—' : show(v);
        if (v !== null && o !== null && v !== o && (better === 'hi' ? v > o : v < o)) td.className = 'win';
        if (v !== null && o === null) td.className = 'win';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    const again = $('againBtn');
    again.disabled = isGuest();
    again.textContent = isGuest() ? 'Host starts the rematch' : 'Rematch';
    $('setBtn').textContent = isGuest() ? 'Back to menu' : 'Change settings';
    $('result').hidden = false;
    if (!isGuest()) again.focus({ preventScroll: true });
  }
  function openMenu(fromHost) {
    clearTimers();
    G.state = 'menu'; S.mode = 'menu'; S.winner = 0; S.target = 0;
    $('count').hidden = true;
    $('result').hidden = true;
    $('menu').hidden = false;
    previewPanels();
    broadcast({ t: 'menu' });
    refreshMenu();
    if (!fromHost) $('startBtn').focus({ preventScroll: true });
  }
  function previewPanels() {
    for (const k of ['L', 'R']) {
      showQuestion(k, buildQuestion());
      ui[k].panel.classList.add('idle');
    }
  }

  /* ---------- menu attract mode: the teams tug on their own ---------- */
  let attractT = 0.5;
  function attract(dt) {
    attractT -= dt;
    if (attractT > 0) return;
    attractT = 0.7 + Math.random() * 0.9;
    let k = Math.random() < 0.5 ? 'L' : 'R';
    if (S.target > 0.3) k = 'L'; else if (S.target < -0.3) k = 'R';
    S.target += (k === 'L' ? -1 : 1) * 0.12 * (0.6 + Math.random() * 0.6);
    if (k === 'L') S.pullL = 0.85; else S.pullR = 0.85;
  }

  /* ---------- menu state ---------- */
  function setNetStatus(text, cls) {
    const el = $('netStatus');
    el.textContent = text;
    el.className = 'net-status' + (cls ? ' ' + cls : '');
  }
  function refreshMenu() {
    const mode = settings.mode, on = mode === 'online', cpu = mode === 'cpu';
    $('cpuField').hidden = !cpu;
    $('netField').hidden = !on;
    $('nameInR').hidden = cpu || on;
    $('nameGrid').classList.toggle('solo', cpu || on);
    $('nameLabel').textContent = cpu || on ? 'Your name' : 'Names';
    const nameIn = $('nameInL');
    nameIn.placeholder = isGuest() ? 'Blue Team' : 'Red Team';
    nameIn.classList.toggle('red', !isGuest());
    nameIn.classList.toggle('blue', isGuest());

    const inRoom = on && !!Net.role;
    $('netIdle').hidden = inRoom;
    $('netRoom').hidden = !inRoom;
    $('netCode').textContent = Net.code || '-----';
    $('copyBtn').hidden = !isHost();
    $('hostSettings').disabled = isGuest();

    const start = $('startBtn');
    if (on && isGuest()) { start.disabled = true; start.textContent = Net.connected ? 'Waiting for the host…' : 'Joining…'; }
    else if (on) { start.disabled = !Net.connected; start.textContent = Net.connected ? 'Start the tug' : 'Waiting for a friend…'; }
    else { start.disabled = false; start.textContent = 'Start the tug'; }
    $('menuFine').textContent = on
      ? 'Answer with A S D F, J K L ; or by tapping. The host starts each round.'
      : 'Red: A S D F · Blue: J K L ; · or tap. Enter starts.';
    $('menuBtn').disabled = isGuest() && (G.state === 'ready' || G.state === 'play');
  }
  function syncMode() {
    settings.mode = radio('mode');
    if (!online() && Net.role) { Net.leave(); G.oppName = ''; setNetStatus(NET_HINT); }
    applyNames();
    refreshMenu();
  }
  function partnerGone() {
    if (G.state !== 'menu') openMenu(true);
    applyNames();
  }

  /* ---------- online: connection events ---------- */
  Net.on('status', (kind, text) => {
    if (kind === 'connecting') { setNetStatus(text); Net.detect().then(showVia); }
    else if (kind === 'waiting') {
      G.oppName = '';
      setNetStatus(text === 'left'
        ? 'Your friend left. Share the code again or wait for someone to join…'
        : 'Share the room code with your friend. Waiting for them to join…');
      if (text === 'left') partnerGone();
    } else if (kind === 'connected') {
      setNetStatus(isHost() ? 'Friend connected…' : 'Connected! Waiting for the host…', 'ok');
      Net.send({ t: 'hello', name: clean($('nameInL').value) });
    } else if (kind === 'closed' || kind === 'error') {
      G.oppName = '';
      setNetStatus(text, 'err');
      partnerGone();
    }
    refreshMenu();
  });

  Net.on('message', m => {
    if (!online()) return;
    const host = isHost(), guest = isGuest();
    switch (m.t) {
      case 'hello':
        G.oppName = clean(m.name);
        if (host) {
          setNetStatus(`${G.oppName || 'Your friend'} joined. Pick the settings and start.`, 'ok');
          Net.send({ t: 'settings', s: menuSettings() });
        } else if (guest) {
          setNetStatus(`Joined ${G.oppName ? G.oppName + '’s' : 'the'} game. Waiting for the host to start.`, 'ok');
        }
        break;
      case 'settings':
        if (guest && m.s) showSettings(m.s);
        break;
      case 'start':
        if (guest && m.s) {
          showSettings(m.s);
          applyRemoteSettings(m.s);
          beginRound();
          runCountdown(guestPlay);
        }
        break;
      case 'q':
        if (guest && (m.k === 'L' || m.k === 'R') && m.q && Array.isArray(m.q.options) && G.state !== 'menu') {
          const s = G.sides[m.k];
          s.q = m.q; s.qStart = performance.now(); s.lockUntil = 0;
          showQuestion(m.k, m.q);
          guestPlay();
        }
        break;
      case 'hit':
      case 'miss':
        if (guest && (m.k === 'L' || m.k === 'R') && m.d && (G.state === 'play' || G.state === 'ready')) {
          S.target = clamp(Number(m.d.target) || 0, -1.25, 1.25);
          (m.t === 'hit' ? presentHit : presentMiss)(m.k, m.i | 0, m.d, m.k === mySide());
        }
        break;
      case 'sync':
        if (guest && G.state === 'play') {
          S.target = clamp(Number(m.target) || 0, -1.25, 1.25);
          if (Math.abs(m.pos - S.pos) > 0.03) S.pos += (m.pos - S.pos) * 0.5;
          G.timeLeft = Number(m.timeLeft) || 0;
          G.elapsed = Number(m.elapsed) || 0;
        }
        break;
      case 'end':
        if (guest && (G.state === 'play' || G.state === 'ready') && m.stats) {
          G.sides.L = unpackSide('L', m.stats.L);
          G.sides.R = unpackSide('R', m.stats.R);
          G.elapsed = Number(m.elapsed) || 0;
          presentEnd(Math.sign(m.w) || 0, m.why === 'line' ? 'line' : 'time');
        }
        break;
      case 'menu':
        if (guest && G.state !== 'menu') openMenu(true);
        break;
      case 'ans':
        if (host) remoteAnswer(m);
        break;
      case 'full':
        if (guest) { Net.leave(); setNetStatus('That game already has two players.', 'err'); refreshMenu(); }
        break;
    }
  });

  function doJoin() {
    const code = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    $('joinCode').value = code;
    if (code.length !== 5) { setNetStatus('Type the 5-character room code.', 'err'); $('joinCode').focus(); return; }
    Sfx.ensure();
    Net.join(code);
  }
  $('hostBtn').addEventListener('click', () => { Sfx.ensure(); Net.host(); });
  $('joinBtn').addEventListener('click', doJoin);
  $('leaveBtn').addEventListener('click', () => { Net.leave(); G.oppName = ''; setNetStatus(NET_HINT); refreshMenu(); });
  $('copyBtn').addEventListener('click', () => {
    const link = Net.inviteLink();
    const done = () => { $('copyBtn').textContent = 'Copied'; setTimeout(() => { $('copyBtn').textContent = 'Copy invite'; }, 1400); };
    try {
      navigator.clipboard.writeText(link).then(done, () => setNetStatus(`Invite: ${link}`));
    } catch (e) { setNetStatus(`Invite: ${link}`); }
  });
  let nameTimer = 0;
  $('nameInL').addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { if (online() && Net.connected) Net.send({ t: 'hello', name: clean($('nameInL').value) }); }, 400);
  });
  document.querySelectorAll('#hostSettings input').forEach(r => r.addEventListener('change', () => {
    if (isHost() && Net.connected) Net.send({ t: 'settings', s: menuSettings() });
  }));
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', syncMode));

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (e.key === 'Enter' && tag !== 'BUTTON') {
      if (active && active.id === 'joinCode') { e.preventDefault(); doJoin(); return; }
      if (!$('menu').hidden || !$('result').hidden) { e.preventDefault(); startGame(); return; }
    }
    if (e.key === 'Escape' && (G.state === 'play' || G.state === 'ready') && !isGuest()) { openMenu(); return; }
    if (G.state !== 'play' || e.repeat || tag === 'INPUT') return;
    for (const k of ['L', 'R']) {
      if (e.code in KEYS[k]) {
        e.preventDefault();
        const side = online() ? mySide() : k;     // online: every answer key plays your own side
        if (isCpu(side)) return;
        const i = KEYS[k][e.code];
        pressFx(ui[side].btns[i]);
        answer(side, i, 'key');
        return;
      }
    }
  });
  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('setBtn').addEventListener('click', () => openMenu());
  $('menuBtn').addEventListener('click', () => openMenu());
  $('soundBtn').addEventListener('click', () => {
    Sfx.ensure();
    const muted = Sfx.toggle();
    $('soundBtn').textContent = muted ? 'Sound: Off' : 'Sound: On';
    $('soundBtn').setAttribute('aria-pressed', String(!muted));
  });

  /* ---------- main loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    tick(dt);
    renderScene(dt);
    requestAnimationFrame(frame);
  }
  // Hidden tabs get no animation frames. Keep the clock, rope and rules running
  // so an online game never stalls when a player switches tabs.
  setInterval(() => {
    const now = performance.now();
    if (now - last < 200) return;
    let rest = Math.min(2, (now - last) / 1000);
    last = now;
    while (rest > 0) { const dt = Math.min(0.05, rest); tick(dt); rest -= dt; }
  }, 250);
  function tick(dt) {
    if (G.state === 'menu') attract(dt);
    if (G.state === 'play') {
      G.elapsed += dt;
      if (settings.time > 0) G.timeLeft = Math.max(0, G.timeLeft - dt);
      renderTimer();
      if (!isGuest()) {            // the guest waits for the host's verdict
        if (S.pos <= -1) endGame(-1, 'line');
        else if (S.pos >= 1) endGame(1, 'line');
        else if (settings.time > 0 && G.timeLeft <= 0) endGame(Math.abs(S.pos) < 0.02 ? 0 : Math.sign(S.pos), 'time');
      }
      if (isHost() && (G.syncT += dt) >= 0.25) {
        G.syncT = 0;
        Net.send({ t: 'sync', target: S.target, pos: S.pos, timeLeft: G.timeLeft, elapsed: G.elapsed });
      }
    }
    stepScene(dt);
  }

  /* ---------- start up ---------- */
  loadNames();
  const hashJoin = /^#join-([A-Z0-9]{5})$/i.exec(location.hash);
  if (hashJoin) {
    $('mode-online').checked = true;
    $('joinCode').value = hashJoin[1].toUpperCase();
  }
  readSettings();
  setNetStatus(hashJoin ? `Type your name, then press Join to enter game ${hashJoin[1].toUpperCase()}.` : NET_HINT);
  applyNames();
  refreshMenu();
  G.timeLeft = settings.time;
  renderTimer(true);
  previewPanels();
  requestAnimationFrame(frame);

  Net.detect().then(showVia);
  function showVia(via) {
    const lan = Net.lanUrls;
    $('netVia').textContent = via === 'lan'
      ? `LAN mode, no internet needed. Players on this network open ${lan[0] || 'this server’s address'}.`
      : 'Internet mode. Both players open this page on any network; one hosts and the other joins with the code.';
    if (!Net.supported()) {
      $('hostBtn').disabled = true; $('joinBtn').disabled = true;
      $('netVia').textContent = 'Online play needs a browser that supports it, such as Chrome, Edge or Firefox.';
    }
  }
})();
