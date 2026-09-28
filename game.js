/* Tug of Math — rules, questions, input, computer player and sound.
   Moves the rope by writing to the scene state `S` from scene.js. */
(() => {
  const $ = id => document.getElementById(id);
  const settings = { mode: '2p', cpu: 'medium', op: 'mix', diff: 'easy', time: 90, names: { L: '', R: '' } };
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

  /* ---------- state ---------- */
  function makeSide(k) {
    return { k, q: null, qStart: 0, lockUntil: 0, streak: 0, best: 0, correct: 0, wrong: 0, fastest: Infinity, timeSum: 0 };
  }
  const G = { state: 'menu', timeLeft: 0, elapsed: 0, shownSec: -1, sides: { L: makeSide('L'), R: makeSide('R') }, timers: new Set(), cpuIds: [] };

  function later(fn, ms) {
    const id = setTimeout(() => { G.timers.delete(id); fn(); }, ms);
    G.timers.add(id);
    return id;
  }
  function clearTimers() { G.timers.forEach(clearTimeout); G.timers.clear(); G.cpuIds = []; }
  const isCpu = k => k === 'R' && settings.mode === 'cpu';

  /* ---------- UI refs + answer buttons ---------- */
  const ui = {};
  for (const k of ['L', 'R']) {
    ui[k] = { panel: $('panel' + k), q: $('q' + k), wrap: $('ans' + k), msg: $('msg' + k), pow: $('pow' + k),
      pulls: $('pulls' + k), streak: $('streak' + k), name: $('name' + k), btns: [] };
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ans'; b.id = `ans${k}${i}`;
      b.innerHTML = `<span class="key">${KEY_LABEL[k][i]}</span><span class="val">–</span>`;
      b.addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); answer(k, i, false); });
      b.addEventListener('click', e => { if (e.detail === 0) answer(k, i, false); });   // keyboard activation
      ui[k].wrap.appendChild(b); ui[k].btns.push(b);
    }
  }
  function pressFx(b) { b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 110); }
  function setMsg(k, text, cls) { const m = ui[k].msg; m.textContent = text; m.className = 'msg' + (cls ? ' ' + cls : ''); }
  function teamName(k) {
    if (k === 'L') return settings.names.L || 'Red Team';
    return isCpu('R') ? 'Computer' : settings.names.R || 'Blue Team';
  }
  function updateStats(k) {
    const s = G.sides[k];
    ui[k].pulls.textContent = s.correct;
    ui[k].streak.textContent = s.streak >= 2 ? `${s.streak} in a row` : '';
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
    return { text, ans, options: makeOptions(ans, op, a, b) };
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
  function nextQuestion(k) {
    const s = G.sides[k];
    let q, guard = 0;
    do { q = buildQuestion(); } while (s.q && q.text === s.q.text && guard++ < 10);
    s.q = q;
    s.qStart = performance.now();
    showQuestion(k, q);
    if (isCpu(k)) scheduleCpu();
  }

  /* ---------- answering ---------- */
  function answer(k, i, byCpu) {
    if (G.state !== 'play') return;
    if (isCpu(k) && !byCpu) return;
    const s = G.sides[k], u = ui[k], now = performance.now();
    if (!s.q || now < s.lockUntil) return;
    const b = u.btns[i];
    if (s.q.options[i] === s.q.ans) {
      const secs = (now - s.qStart) / 1000;
      s.correct++; s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.fastest = Math.min(s.fastest, secs);
      s.timeSum += secs;
      const speed = clamp(1 - (secs - 0.9) / 4.5, 0, 1);
      const power = 0.065 + 0.075 * speed + Math.min(s.streak - 1, 5) * 0.008;
      doPull(k, power, speed, s.streak);
      b.classList.add('good');
      s.lockUntil = now + 220;
      const word = speed > 0.8 ? 'Lightning pull!' : speed > 0.45 ? 'Strong pull!' : 'Pull!';
      setMsg(k, `${word} ${secs.toFixed(1)} s`, 'hot');
      u.pow.style.width = Math.round(clamp(power / 0.18, 0.15, 1) * 100) + '%';
      Sfx.correct(speed);
      later(() => { if (G.state === 'play') nextQuestion(k); }, 220);
    } else {
      s.wrong++; s.streak = 0;
      b.classList.add('bad');
      u.panel.classList.add('locked');
      s.lockUntil = now + 1000;
      S.target = clamp(S.target + (k === 'L' ? 1 : -1) * 0.035, -1.25, 1.25);
      if (k === 'L') S.flinchL = 1; else S.flinchR = 1;
      setMsg(k, `Slipped! ${s.q.text} = ${s.q.ans}`, 'oops');
      u.pow.style.width = '0%';
      Sfx.wrong();
      later(() => { if (G.state === 'play') nextQuestion(k); }, 1000);
    }
    updateStats(k);
  }
  function doPull(k, power, speed, streak) {
    const dir = k === 'L' ? -1 : 1;
    S.target = clamp(S.target + dir * power, -1.25, 1.25);
    const imp = 0.6 + speed * 0.4;
    if (k === 'L') S.pullL = Math.max(S.pullL, imp); else S.pullR = Math.max(S.pullR, imp);
    S.shake = Math.max(S.shake, speed * 0.25);
    const mx = VW / 2 + S.pos * RANGE;
    const x = mx + dir * 200;
    const col = k === 'L' ? '#ff6a5e' : '#6fb0ff';
    popText(x, 246, speed > 0.8 ? 'HEAVE!' : speed > 0.45 ? 'PULL!' : 'tug', col, 22 + speed * 12);
    if (streak >= 3) popText(x, 214, `${streak} in a row`, '#ffd23f', 17);
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
      later(() => { clear(); if (G.state === 'play') { pressFx(btns[pick]); answer('R', pick, true); } }, delay),
    ];
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

  /* ---------- round flow ---------- */
  function readSettings() {
    const val = n => document.querySelector(`input[name="${n}"]:checked`).value;
    settings.mode = val('mode'); settings.cpu = val('cpu'); settings.op = val('op');
    settings.diff = val('diff'); settings.time = +val('time');
    const clean = s => s.replace(/\s+/g, ' ').trim().slice(0, 14);
    settings.names.L = clean($('nameInL').value);
    settings.names.R = clean($('nameInR').value);
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(settings.names)); } catch (e) { /* storage blocked */ }
  }
  function loadNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || 'null');
      if (saved) { $('nameInL').value = saved.L || ''; $('nameInR').value = saved.R || ''; }
    } catch (e) { /* storage blocked or bad data */ }
  }
  function syncModeFields() {
    const cpu = document.querySelector('input[name="mode"]:checked').value === 'cpu';
    $('cpuField').hidden = !cpu;
    $('nameInR').hidden = cpu;
    $('nameGrid').classList.toggle('solo', cpu);
  }
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
  function renderTimer(force) {
    const t = $('timer');
    const sec = settings.time > 0 ? Math.ceil(G.timeLeft) : Math.floor(G.elapsed);
    if (sec === G.shownSec && !force) return;
    G.shownSec = sec;
    t.textContent = fmt(sec);
    t.classList.toggle('hurry', settings.time > 0 && G.state === 'play' && sec <= 10 && sec > 0);
  }
  function applyNames() {
    ui.L.name.textContent = teamName('L');
    ui.R.name.textContent = teamName('R');
    $('resNameL').textContent = teamName('L');
    $('resNameR').textContent = teamName('R');
    TEAM.L.label = teamName('L').toUpperCase();
    TEAM.R.label = teamName('R').toUpperCase();
    ui.R.panel.classList.toggle('cpu', isCpu('R'));
    ui.L.panel.setAttribute('aria-label', teamName('L') + ' (red side)');
    ui.R.panel.setAttribute('aria-label', teamName('R') + ' (blue side)');
  }
  function resetRound() {
    clearTimers();
    G.sides = { L: makeSide('L'), R: makeSide('R') };
    G.timeLeft = settings.time; G.elapsed = 0; G.shownSec = -1;
    Object.assign(S, { pos: 0, target: 0, vel: 0, pullL: 0, pullR: 0, flinchL: 0, flinchR: 0, winner: 0, winT: 0, shake: 0 });
    resetLanded();
    parts.length = 0;
    for (const k of ['L', 'R']) {
      const u = ui[k];
      u.q.textContent = '?';
      u.btns.forEach(b => { b.classList.remove('good', 'bad', 'think', 'press'); b.querySelector('.val').textContent = '–'; });
      u.panel.classList.remove('locked', 'idle');
      u.pow.style.width = '0%';
      setMsg(k, isCpu(k) ? `Computer: ${CPU[settings.cpu].name}` : DEFAULT_MSG);
      updateStats(k);
    }
    renderTimer(true);
  }
  function startGame() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    readSettings();
    Sfx.ensure();
    applyNames();
    resetRound();
    $('menu').hidden = true; $('result').hidden = true;
    G.state = 'ready'; S.mode = 'ready';
    const count = $('count');
    count.hidden = false;
    ['3', '2', '1', 'PULL!'].forEach((w, i) => later(() => {
      count.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = w;
      if (i === 3) span.className = 'go-word';
      count.appendChild(span);
      Sfx.beep(i === 3);
      if (i === 3) beginPlay();
    }, i * 700));
    later(() => { count.hidden = true; }, 2800);
  }
  function beginPlay() {
    G.state = 'play'; S.mode = 'play';
    nextQuestion('L'); nextQuestion('R');
  }
  function endGame(w, why) {
    if (G.state !== 'play') return;
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
      setMsg(k, 'You win!', 'hot');
      setMsg(k === 'L' ? 'R' : 'L', 'Pulled over the line');
    } else {
      S.target = S.pos;
      Sfx.tie();
    }
    later(() => showResult(w, why), 1900);
  }
  function showResult(w, why) {
    const title = $('resTitle');
    const winner = w < 0 ? teamName('L') : w > 0 ? teamName('R') : '';
    title.className = 'res-title' + (w < 0 ? ' red' : w > 0 ? ' blue' : '');
    title.textContent = w ? `${winner} wins!` : 'Dead heat!';
    const opName = { add: 'Adding', sub: 'Subtracting', mul: 'Times tables', div: 'Dividing', mix: 'Mixed' }[settings.op];
    const lvl = settings.diff[0].toUpperCase() + settings.diff.slice(1);
    $('resEyebrow').textContent = `${isCpu('R') ? 'Vs computer' : '2 players'} · ${opName} · ${lvl}`;
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
    $('result').hidden = false;
    $('againBtn').focus({ preventScroll: true });
  }
  function openMenu() {
    clearTimers();
    G.state = 'menu'; S.mode = 'menu'; S.winner = 0; S.target = 0;
    $('count').hidden = true;
    $('result').hidden = true;
    $('menu').hidden = false;
    previewPanels();
    $('startBtn').focus({ preventScroll: true });
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
    const dir = k === 'L' ? -1 : 1;
    S.target += dir * 0.12 * (0.6 + Math.random() * 0.6);
    if (k === 'L') S.pullL = 0.85; else S.pullR = 0.85;
  }

  /* ---------- input ---------- */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.key === 'Enter' && tag !== 'BUTTON') {
      if (!$('menu').hidden) { e.preventDefault(); startGame(); return; }
      if (!$('result').hidden) { e.preventDefault(); startGame(); return; }
    }
    if (e.key === 'Escape' && (G.state === 'play' || G.state === 'ready')) { openMenu(); return; }
    if (G.state !== 'play' || e.repeat) return;
    for (const k of ['L', 'R']) {
      if (e.code in KEYS[k]) {
        e.preventDefault();
        if (isCpu(k)) return;
        const i = KEYS[k][e.code];
        pressFx(ui[k].btns[i]);
        answer(k, i, false);
        return;
      }
    }
  });
  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('setBtn').addEventListener('click', openMenu);
  $('menuBtn').addEventListener('click', openMenu);
  $('soundBtn').addEventListener('click', () => {
    Sfx.ensure();
    const muted = Sfx.toggle();
    $('soundBtn').textContent = muted ? 'Sound: Off' : 'Sound: On';
    $('soundBtn').setAttribute('aria-pressed', String(!muted));
  });
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', syncModeFields));

  /* ---------- main loop ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (G.state === 'menu') attract(dt);
    if (G.state === 'play') {
      G.elapsed += dt;
      if (settings.time > 0) G.timeLeft -= dt;
      renderTimer();
      if (S.pos <= -1) endGame(-1, 'line');
      else if (S.pos >= 1) endGame(1, 'line');
      else if (settings.time > 0 && G.timeLeft <= 0) {
        G.timeLeft = 0;
        endGame(Math.abs(S.pos) < 0.02 ? 0 : Math.sign(S.pos), 'time');
      }
    }
    stepScene(dt);
    renderScene(dt);
    requestAnimationFrame(frame);
  }

  loadNames();
  readSettings();
  syncModeFields();
  applyNames();
  G.timeLeft = settings.time;
  renderTimer(true);
  previewPanels();
  requestAnimationFrame(frame);
})();
