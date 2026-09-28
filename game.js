/* Tug of Math — the match: 1 to 5 players a side, questions, computer players,
   pulls on the rope, the clock and online sync. Screens and menus live in app.js.
   Offline (Same PC, vs computer) this device runs everything. Online, the host
   runs the rope, the clock and the computer players; each device judges its own
   player's answers and tells the room about every pull. In Custom rooms a
   referee can supply the questions (multiple choice, true/false or typed
   answers), slip in new ones mid-match and end the match with a whistle.
   Ranked matches never bring in computer players. */
const Game = (() => {
  const $ = id => document.getElementById(id);
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
  const NET_EVENTS = new Set(['pull', 'sync', 'end', 'left', 'addq', 'refend']);
  const handlers = { end() {} };
  let M = null;       // the match being played
  let qid = 0;

  const later = (fn, ms) => {
    const m = M;
    const id = setTimeout(() => { if (M === m) { m.timers.delete(id); fn(); } }, ms);
    m.timers.add(id);
    return id;
  };
  function clearTimers() { if (M) { M.timers.forEach(clearTimeout); M.timers.clear(); } }

  /* ---------- questions ---------- */
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const RANGES = {
    add: { easy: [1, 10], medium: [8, 60], hard: [25, 250] },
    sub: { easy: [1, 10], medium: [5, 50], hard: [20, 200] },
    mul: { easy: [[1, 5], [1, 10]], medium: [[2, 10], [2, 12]], hard: [[4, 15], [6, 19]] },
    div: { easy: [[2, 5], [1, 10]], medium: [[2, 10], [2, 12]], hard: [[4, 15], [6, 19]] },
  };
  function buildQuestion(opSetting, d) {
    const op = opSetting === 'mix' ? ['add', 'sub', 'mul', 'div'][rnd(0, 3)] : opSetting;
    let a, b, ans, text;
    if (op === 'add') { const [lo, hi] = RANGES.add[d]; a = rnd(lo, hi); b = rnd(lo, hi); ans = a + b; text = `${a} + ${b}`; }
    else if (op === 'sub') { const [lo, hi] = RANGES.sub[d]; b = rnd(lo, hi); ans = rnd(lo - 1, hi); a = ans + b; text = `${a} − ${b}`; }
    else if (op === 'mul') { const [ra, rb] = RANGES.mul[d]; a = rnd(...ra); b = rnd(...rb); if (Math.random() < 0.5) [a, b] = [b, a]; ans = a * b; text = `${a} × ${b}`; }
    else { const [ra, rb] = RANGES.div[d]; b = rnd(...ra); ans = rnd(...rb); a = b * ans; text = `${a} ÷ ${b}`; }
    return { id: ++qid, text, ans, options: makeOptions(ans, op, a, b) };
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

  /* ---------- referee questions (Custom rooms) ----------
     { text, type: 'mc' | 'tf' | 'type', options: 2-4 choices (mc only), answer } */
  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  function cleanQuestion(q) {
    if (!q || typeof q !== 'object') return null;
    const text = clip(q.text, 140), type = ['mc', 'tf', 'type'].includes(q.type) ? q.type : null;
    if (!text || !type) return null;
    if (type === 'tf') return { text, type, answer: /^f/i.test(String(q.answer)) ? 'False' : 'True' };
    if (type === 'type') { const answer = clip(q.answer, 40); return answer ? { text, type, answer } : null; }
    const options = [...new Set((Array.isArray(q.options) ? q.options : []).map(o => clip(o, 40)).filter(Boolean))].slice(0, 4);
    const answer = clip(q.answer, 40);
    return options.length >= 2 && options.includes(answer) ? { text, type, options, answer } : null;
  }
  // typed answers: ignore case and spacing; "12", "12.0" and "1,2" style numbers compare as numbers
  const norm = v => {
    const t = String(v).trim().toLowerCase().replace(/\s+/g, ' ');
    const n = Number(t.replace(/,/g, ''));
    return t !== '' && Number.isFinite(n) ? String(n) : t;
  };
  function refQuestion(q) {
    const options = q.type === 'mc' ? shuffle(q.options.slice()) : q.type === 'tf' ? ['True', 'False'] : [];
    return { id: ++qid, text: q.text, ans: q.answer, options, type: q.type };
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
      coin() { tone(988, 0.08, 'square', 0.06); tone(1319, 0.22, 'square', 0.06, 0.08); },
      rankUp() { [523, 784, 1047, 1568].forEach((f, i) => tone(f, 0.4, 'triangle', 0.13, i * 0.13)); },
      click() { tone(700, 0.05, 'triangle', 0.05); },
      toggle() { muted = !muted; return muted; },
      get muted() { return muted; },
    };
  })();

  /* ---------- panels ---------- */
  const ui = {};
  for (const k of ['L', 'R']) {
    ui[k] = { panel: $('panel' + k), play: $('play' + k), q: $('q' + k), wrap: $('ans' + k), msg: $('msg' + k), pow: $('pow' + k),
      pulls: $('pulls' + k), streak: $('streak' + k), name: $('name' + k), roster: $('roster' + k),
      typed: $('typed' + k), typeIn: $('typeIn' + k), btns: [] };
    ui[k].typed.addEventListener('submit', e => {
      e.preventDefault();
      const p = M && M.focus[k];
      if (p && p.local && !p.bot) answerTyped(p, ui[k].typeIn.value);
    });
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ans'; b.id = `ans${k}${i}`;
      b.innerHTML = `<span class="key">${KEY_LABEL[k][i]}</span><span class="val">–</span>`;
      b.addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); tapAnswer(k, i); });
      b.addEventListener('click', e => { if (e.detail === 0) tapAnswer(k, i); });   // keyboard activation
      ui[k].wrap.appendChild(b); ui[k].btns.push(b);
    }
  }
  function tapAnswer(k, i) {
    const p = M && M.focus[k];
    if (p && p.local && !p.bot) answer(p, i);
  }
  function pressFx(b) { b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 110); }
  function setMsg(k, text, cls) { const m = ui[k].msg; m.textContent = text; m.className = 'msg' + (cls ? ' ' + cls : ''); }
  const sidePlayers = k => M.players.filter(p => p.side === k);
  function teamLabel(k) {
    const side = sidePlayers(k);
    return side.length === 1 ? side[0].name : k === 'L' ? 'Red Team' : 'Blue Team';
  }
  function showQuestion(k, q) {
    const u = ui[k];
    u.q.textContent = q.text;
    u.q.classList.toggle('long', q.text.length > 14);
    u.q.classList.remove('fresh'); void u.q.offsetWidth; u.q.classList.add('fresh');
    const typed = q.type === 'type';
    u.wrap.hidden = typed;
    u.typed.hidden = !typed;
    if (typed) {
      u.typeIn.value = ''; u.typeIn.disabled = false;
      const p = M.focus[k];
      if (p && p.local && !p.bot) u.typeIn.focus({ preventScroll: true });
    }
    u.btns.forEach((b, i) => {
      const v = q.options[i];
      b.hidden = v === undefined;
      b.classList.remove('good', 'bad', 'think', 'press');
      b.classList.toggle('long', v !== undefined && String(v).length > 6);
      b.querySelector('.val').textContent = v === undefined ? '' : v;
      b.setAttribute('aria-label', `${v} (key ${KEY_LABEL[k][i]})`);
    });
    u.panel.classList.remove('locked');
  }
  function renderRoster(k) {
    const list = ui[k].roster, side = sidePlayers(k);
    list.hidden = side.length < 2 && !!M.focus[k];
    list.innerHTML = '';
    for (const p of side.slice().sort((a, b) => b.s.correct - a.s.correct)) {
      const li = document.createElement('li');
      if (p.local) li.className = 'me';
      const n = document.createElement('span'); n.className = 'r-name'; n.textContent = p.name;
      if (p.local && M.online) n.insertAdjacentHTML('beforeend', ' <i class="tag you">YOU</i>');
      if (p.bot) n.insertAdjacentHTML('beforeend', ` <i class="tag">${p.left ? 'LEFT · CPU' : 'CPU'}</i>`);
      else if (p.left) n.insertAdjacentHTML('beforeend', ' <i class="tag">LEFT</i>');
      const c = document.createElement('b'); c.textContent = p.s.correct;
      li.append(n, c);
      list.appendChild(li);
    }
    const total = side.reduce((a, p) => a + p.s.correct, 0);
    ui[k].pulls.textContent = total;
    const f = M.focus[k];
    ui[k].streak.textContent = f && f.s.streak >= 2 ? `${f.s.streak} in a row` : '';
  }
  function setupPanels() {
    for (const k of ['L', 'R']) {
      const side = sidePlayers(k);
      const mine = side.find(p => p.local);
      const focus = mine || (!M.online && side.length === 1 ? side[0] : null);
      M.focus[k] = focus;
      const u = ui[k];
      u.play.hidden = !focus;
      u.name.textContent = teamLabel(k);
      u.panel.classList.toggle('mine', !!(focus && focus.local && (M.online || M.cfg.kind === 'cpu')));
      u.panel.classList.toggle('cpu', !!(focus && focus.bot));
      u.panel.classList.toggle('solo', !focus);
      u.panel.classList.remove('locked', 'idle');
      u.q.textContent = '?';
      u.btns.forEach(b => { b.hidden = false; b.classList.remove('good', 'bad', 'think', 'press', 'long'); b.querySelector('.val').textContent = '–'; b.disabled = !!(focus && focus.bot); });
      u.wrap.hidden = false; u.typed.hidden = true; u.q.classList.remove('long');
      u.pow.style.width = '0%';
      setMsg(k, focus && focus.bot ? `Computer: ${CPU[focus.level].name}` : DEFAULT_MSG);
      u.panel.setAttribute('aria-label', `${teamLabel(k)} (${k === 'L' ? 'red' : 'blue'} side)`);
      renderRoster(k);
    }
    const hint = $('keysHint');
    const same = M.cfg.kind === 'local';
    hint.innerHTML = M.isRef
      ? '<span>You are the referee: add a question any time, or blow the whistle to end the match.</span>'
      : same
      ? '<span><b class="kr">Red</b> <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd> or <kbd>1</kbd>–<kbd>4</kbd></span><span><b class="kb">Blue</b> <kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd> or <kbd>7</kbd>–<kbd>0</kbd></span><span>or tap the answers</span>'
      : '<span>Answer with <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd>, <kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd> or tap</span>';
  }
  function sceneTeams() {
    const labels = M.players.length > 2 || M.online;
    const order = k => sidePlayers(k).slice().sort((a, b) => (b.local - a.local) || (a.bot - b.bot));
    const map = p => ({ look: p.look, cos: p.skin, label: labels ? p.name : '', me: p.local && (M.online || M.players.length > 2) });
    setTeams(order('L').map(map), order('R').map(map));
    TEAM.L.label = teamLabel('L').toUpperCase();
    TEAM.R.label = teamLabel('R').toUpperCase();
  }

  /* ---------- effects ---------- */
  const speedOf = secs => clamp(1 - (secs - 0.9) / 4.5, 0, 1);
  const speedWord = sp => (sp > 0.8 ? 'Lightning pull!' : sp > 0.45 ? 'Strong pull!' : 'Pull!');
  function pullFx(k, speed, streak, big) {
    const dir = k === 'L' ? -1 : 1;
    const imp = 0.6 + speed * 0.4;
    if (k === 'L') S.pullL = Math.max(S.pullL, imp); else S.pullR = Math.max(S.pullR, imp);
    S.shake = Math.max(S.shake, speed * (big ? 0.25 : 0.12));
    const x = VW / 2 + S.pos * RANGE + dir * (170 + Math.random() * 60);
    if (big) popText(x, 246, speed > 0.8 ? 'HEAVE!' : speed > 0.45 ? 'PULL!' : 'tug', k === 'L' ? '#ff6a5e' : '#6fb0ff', 22 + speed * 12);
    else popText(x, 230 + Math.random() * 30, '+1', k === 'L' ? '#ff8a80' : '#8cc2ff', 17);
    if (streak >= 3 && big) popText(x, 214, `${streak} in a row`, '#ffd23f', 17);
  }

  /* ---------- stats ---------- */
  const makeStats = () => ({ q: null, qStart: 0, lockUntil: 0, streak: 0, best: 0, correct: 0, wrong: 0, fastest: Infinity, timeSum: 0 });
  const pack = s => ({ c: s.correct, w: s.wrong, b: s.best, s: s.streak, f: s.fastest === Infinity ? null : s.fastest, t: s.timeSum });
  function unpack(s, st) {
    if (!st) return;
    const n = v => Math.max(0, Math.min(10000, Number(v) || 0));
    s.correct = n(st.c) | 0; s.wrong = n(st.w) | 0; s.best = n(st.b) | 0; s.streak = n(st.s) | 0;
    s.fastest = typeof st.f === 'number' && st.f > 0 ? st.f : Infinity; s.timeSum = n(st.t);
  }

  /* ---------- rules ---------- */
  function nextQuestion(p) {
    const s = p.s;
    let q, guard = 0;
    if (!p.queue.length && M.qset && M.qset.length) {
      p.queue = shuffle(M.qset.slice());
      if (p.queue.length > 1 && s.q && p.queue[0].text === s.q.text) p.queue.push(p.queue.shift());
    }
    if (p.queue.length) q = refQuestion(p.queue.shift());
    else do { q = buildQuestion(M.settings.op, p.diff || M.settings.diff); } while (s.q && q.text === s.q.text && guard++ < 10);
    s.q = q; s.qStart = performance.now(); s.lockUntil = 0;
    if (M.focus[p.side] === p) showQuestion(p.side, q);
    if (p.bot) scheduleBot(p);
  }
  function answer(p, i) {
    if (!M || M.state !== 'play') return;
    const s = p.s, now = performance.now();
    if (!s.q || now < s.lockUntil || s.q.type === 'type' || i >= s.q.options.length) return;
    resolve(p, i, s.q.options[i] === s.q.ans, (now - s.qStart) / 1000);
  }
  function answerTyped(p, value) {
    if (!M || M.state !== 'play') return;
    const s = p.s, now = performance.now();
    if (!s.q || now < s.lockUntil || s.q.type !== 'type' || !String(value).trim()) return;
    // typing takes longer than tapping, so it gets a head start on speed
    resolve(p, -1, norm(value) === norm(s.q.ans), Math.max(0.3, (now - s.qStart) / 1000 - 1.5));
  }
  // one answer by a local player or a computer player: update stats, move the rope, tell the room
  function resolve(p, i, ok, secs) {
    const s = p.s, n = sidePlayers(p.side).length;
    let ev;
    if (ok) {
      s.correct++; s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.fastest = Math.min(s.fastest, secs);
      s.timeSum += secs;
      const speed = speedOf(secs);
      const power = (0.065 + 0.075 * speed + Math.min(s.streak - 1, 5) * 0.008) / n;
      ev = { t: 'pull', pid: p.id, ok: true, i, secs: Math.round(secs * 100) / 100, speed, power, st: pack(s) };
      s.lockUntil = performance.now() + 220;
      later(() => { if (M.state === 'play') nextQuestion(p); }, 220);
    } else {
      s.wrong++; s.streak = 0;
      ev = { t: 'pull', pid: p.id, ok: false, i, power: 0.035 / n, text: s.q.text, ans: s.q.ans, custom: !!s.q.type, st: pack(s) };
      s.lockUntil = performance.now() + 1000;
      later(() => { if (M.state === 'play') nextQuestion(p); }, 1000);
    }
    applyPull(ev, true);
    if (M.online) Net.send(ev);
  }
  // own = this device made the move; the host (or offline device) owns the rope
  function applyPull(ev, own) {
    const p = M.byId.get(ev.pid);
    if (!p) return;
    if (!own) unpack(p.s, ev.st);
    const k = p.side, dir = k === 'L' ? -1 : 1, n = sidePlayers(k).length;
    const power = clamp(Number(ev.power) || 0, 0, 0.21 / n);
    if (M.host || own) S.target = clamp(S.target + (ev.ok ? dir : -dir) * power, -1.25, 1.25);
    const focus = M.focus[k] === p;
    const loud = p.local || (focus && !M.online);
    if (ev.ok) {
      const speed = clamp(Number(ev.speed) || 0, 0, 1);
      pullFx(k, speed, p.s.streak, focus || n === 1);
      if (focus) {
        const u = ui[k];
        if (ev.i >= 0 && ev.i < 4) u.btns[ev.i].classList.add('good');
        setMsg(k, `${speedWord(speed)} ${Number(ev.secs).toFixed(1)} s`, 'hot');
        u.pow.style.width = Math.round(clamp(power * n / 0.18, 0.15, 1) * 100) + '%';
      }
      if (loud) Sfx.correct(speed);
    } else {
      if (k === 'L') S.flinchL = Math.max(S.flinchL, 1 / n); else S.flinchR = Math.max(S.flinchR, 1 / n);
      if (focus) {
        const u = ui[k];
        if (ev.i >= 0 && ev.i < 4) u.btns[ev.i].classList.add('bad');
        u.panel.classList.add('locked');
        u.typeIn.disabled = true;
        setMsg(k, ev.custom ? `Not quite! Answer: ${ev.ans}` : `Slipped! ${ev.text} = ${ev.ans}`, 'oops');
        u.pow.style.width = '0%';
      }
      if (loud) Sfx.wrong();
    }
    renderRoster(k);
  }

  /* ---------- computer players (run by the host) ---------- */
  function scheduleBot(p) {
    const c = CPU[p.level] || CPU.medium;
    const q = p.s.q, n = q.options.length;
    const f = q.type ? 1.5 : { easy: 1, medium: 1.2, hard: 1.45 }[p.diff || M.settings.diff] || 1;
    const delay = (c.min + Math.random() * (c.max - c.min)) * f * 1000;
    const right = Math.random() <= c.acc;
    let pick = n ? q.options.indexOf(q.ans) : -1;
    if (!right && n) { const w = [...Array(n).keys()].filter(i => i !== pick); pick = w[rnd(0, w.length - 1)]; }
    if (M.focus[p.side] === p && n) {
      const btns = ui[p.side].btns;
      const clear = () => btns.forEach(b => b.classList.remove('think'));
      later(() => { clear(); btns[rnd(0, n - 1)].classList.add('think'); }, delay * 0.45);
      later(() => { clear(); btns[pick].classList.add('think'); }, delay * 0.8);
      later(() => { clear(); pressFx(btns[pick]); }, delay - 10);
    }
    later(() => { if (M.state === 'play' && p.s.q === q) resolve(p, pick, right, delay / 1000); }, delay);
  }

  /* ---------- referee ---------- */
  // a new question comes up next for every player; in a referee question set it also joins the rotation
  function addQuestion(raw) {
    const q = cleanQuestion(raw);
    if (!M || !q || M.state === 'over') return null;
    if (M.qset) M.qset.push(q);
    for (const p of M.players) if (p.local || (M.host && p.bot)) p.queue.unshift(q);
    return q;
  }
  function refAdd(raw) {
    if (!M || !M.isRef) return false;
    const q = addQuestion(raw);
    if (!q) return false;
    Net.send({ t: 'addq', q });
    return true;
  }
  function refWhistle() {
    if (!M || !M.isRef || M.state !== 'play') return;
    if (M.host) refEnd(); else Net.send({ t: 'refend' });
  }
  function refEnd() { if (M && M.state === 'play') endMatch(Math.abs(S.pos) < 0.02 ? 0 : Math.sign(S.pos), 'ref'); }

  /* ---------- clock ---------- */
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
  function renderTimer(force) {
    const t = $('timer'), time = M.settings.time;
    const sec = time > 0 ? Math.ceil(M.timeLeft) : Math.floor(M.elapsed);
    if (sec === M.shownSec && !force) return;
    M.shownSec = sec;
    t.textContent = fmt(sec);
    t.classList.toggle('hurry', time > 0 && M.state === 'play' && sec <= 10 && sec > 0);
  }
  function runCountdown(onGo) {
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

  /* ---------- match flow ---------- */
  /* cfg: { mode: classic|ranked|custom, kind: local|cpu|online, host, me, settings: {op, diff, time},
            players: [{ id, name, side, bot, level, skin, look, diff }] } */
  function start(cfg) {
    stop();
    const online = cfg.kind === 'online';
    const players = cfg.players.map(p => Object.assign({}, p, {
      s: makeStats(), queue: [],
      local: !p.bot && (online ? p.id === cfg.me : true),
    }));
    const qset = Array.isArray(cfg.questions) ? cfg.questions.map(cleanQuestion).filter(Boolean) : [];
    M = {
      cfg, online, host: !!cfg.host, me: cfg.me, settings: cfg.settings, players,
      byId: new Map(players.map(p => [p.id, p])), focus: { L: null, R: null },
      qset: qset.length ? qset : null, referee: cfg.referee || null, isRef: !!cfg.referee && cfg.referee === cfg.me,
      state: 'ready', timeLeft: cfg.settings.time, elapsed: 0, shownSec: -1, syncT: 0, timers: new Set(),
    };
    Object.assign(S, { pos: 0, target: 0, vel: 0, pullL: 0, pullR: 0, flinchL: 0, flinchR: 0, winner: 0, winT: 0, shake: 0, mode: 'ready' });
    parts.length = 0;
    sceneTeams();
    setupPanels();
    renderTimer(true);
    Sfx.ensure();
    runCountdown(() => {
      M.state = 'play'; S.mode = 'play';
      for (const p of M.players) if (p.local || (M.host && p.bot)) nextQuestion(p);
    });
  }
  function stop() {
    clearTimers();
    M = null;
    S.mode = 'menu'; S.winner = 0; S.target = 0;
    $('count').hidden = true;
  }
  function endMatch(w, why) {
    if (M.state !== 'play') return;
    const stats = {};
    for (const p of M.players) stats[p.id] = pack(p.s);
    if (M.online) Net.send({ t: 'end', w, why, elapsed: M.elapsed, stats });
    presentEnd(w, why);
  }
  function presentEnd(w, why) {
    M.state = 'over'; S.mode = 'over'; S.winner = w; S.winT = 0;
    clearTimers();
    $('count').hidden = true;
    for (const k of ['L', 'R']) { ui[k].panel.classList.add('idle'); ui[k].btns.forEach(b => b.classList.remove('think')); renderRoster(k); }
    renderTimer(true);
    if (w) {
      S.target = w * 1.12;
      S.shake = 0.8;
      Sfx.win();
      confettiBurst(120);
      later(() => confettiBurst(80), 700);
      const k = w < 0 ? 'L' : 'R';
      if (M.focus[k]) setMsg(k, M.focus[k].local ? 'You win!' : 'Winner!', 'hot');
      if (M.focus[k === 'L' ? 'R' : 'L']) setMsg(k === 'L' ? 'R' : 'L', 'Pulled over the line');
    } else {
      S.target = S.pos;
      Sfx.tie();
    }
    const sum = snapshot(w, why);
    later(() => handlers.end(sum), 1900);
  }
  function snapshot(w, why) {
    if (!M) return null;
    return {
      w, why, elapsed: M.elapsed, cfg: M.cfg, settings: M.settings, isRef: M.isRef,
      players: M.players.map(p => ({ id: p.id, name: p.name, side: p.side, bot: !!p.bot, left: !!p.left, local: p.local, diff: p.diff,
        level: p.level, stats: { correct: p.s.correct, wrong: p.s.wrong, best: p.s.best, fastest: p.s.fastest, timeSum: p.s.timeSum } })),
    };
  }

  // called every frame by app.js
  function tick(dt) {
    if (!M || M.state !== 'play') return;
    M.elapsed += dt;
    if (M.settings.time > 0) M.timeLeft = Math.max(0, M.timeLeft - dt);
    renderTimer();
    if (M.host) {
      if (S.pos <= -1) endMatch(-1, 'line');
      else if (S.pos >= 1) endMatch(1, 'line');
      else if (M.settings.time > 0 && M.timeLeft <= 0) endMatch(Math.abs(S.pos) < 0.02 ? 0 : Math.sign(S.pos), 'time');
      if (M && M.online && M.state === 'play' && (M.syncT += dt) >= 0.25) {
        M.syncT = 0;
        Net.send({ t: 'sync', target: S.target, pos: S.pos, timeLeft: M.timeLeft, elapsed: M.elapsed });
      }
    }
  }

  /* ---------- online messages during a match ---------- */
  function onNet(m, from) {
    if (!M || !M.online) return;
    const hostId = Net.hostId;
    switch (m.t) {
      case 'pull': {
        if (M.state !== 'play') return;
        const p = M.byId.get(m.pid);
        if (!p || p.local) return;
        if (p.bot ? from !== hostId : from !== p.id) return;     // only you move your player; the host moves computers
        applyPull(m, false);
        break;
      }
      case 'sync':
        if (M.host || from !== hostId || M.state !== 'play') return;
        S.target = clamp(Number(m.target) || 0, -1.25, 1.25);
        if (Math.abs(m.pos - S.pos) > 0.03) S.pos += (m.pos - S.pos) * 0.5;
        M.timeLeft = Number(m.timeLeft) || 0;
        M.elapsed = Number(m.elapsed) || 0;
        break;
      case 'end':
        if (M.host || from !== hostId || M.state === 'over') return;
        for (const p of M.players) unpack(p.s, m.stats && m.stats[p.id]);
        M.elapsed = Number(m.elapsed) || 0;
        presentEnd(Math.sign(m.w) || 0, ['line', 'time', 'ref'].includes(m.why) ? m.why : 'time');
        break;
      case 'left': {
        if (from !== hostId) return;
        const p = M.byId.get(m.pid);
        if (p && !p.local) { p.bot = !!m.bot; p.left = true; renderRoster(p.side); }
        break;
      }
      case 'addq':
        if (M.referee && from === M.referee) addQuestion(m.q);
        break;
      case 'refend':
        if (M.host && M.referee && from === M.referee) refEnd();
        break;
    }
  }
  // host: a player dropped out mid-match. A computer takes over their slot,
  // except in Ranked, where their team plays on a player short.
  function playerLeft(id) {
    if (!M || !M.host) return;
    const p = M.byId.get(id);
    if (!p || p.bot || p.local || p.left) return;
    p.left = true;
    if (M.cfg.mode !== 'ranked') {
      p.bot = true; p.level = p.level || 'medium';
      if (M.state === 'play') nextQuestion(p);
    }
    Net.send({ t: 'left', pid: id, bot: !!p.bot });
    renderRoster(p.side);
  }

  /* ---------- keyboard during a match ---------- */
  function onKey(e) {
    if (!M || M.state !== 'play' || e.repeat) return false;
    for (const k of ['L', 'R']) {
      if (!(e.code in KEYS[k])) continue;
      const i = KEYS[k][e.code];
      // Same PC: each key set plays its own side; otherwise every key plays your player
      const p = M.cfg.kind === 'local' ? M.focus[k] : M.players.find(x => x.local);
      if (!p || !p.local || p.bot) return true;
      pressFx(ui[p.side].btns[i]);
      answer(p, i);
      return true;
    }
    return false;
  }

  return {
    start, stop, tick, onNet, onKey, playerLeft, snapshot, refAdd, refWhistle, cleanQuestion,
    get isRef() { return !!(M && M.isRef); },
    handles: t => NET_EVENTS.has(t),
    on(type, fn) { handlers[type] = fn; },
    get active() { return !!M; },
    get state() { return M ? M.state : null; },
    get cfg() { return M ? M.cfg : null; },
    CPU, sfx: Sfx,
  };
})();
