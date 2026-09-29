/* Tug of Math — scene renderer.
   Draws the field, both teams (1 to 5 people a side, each in their own skin),
   the rope and all particles on one canvas. The game (game.js) touches the
   shared state object `S` and sets the teams with setTeams(). renderAvatar()
   draws one character on any other canvas (dashboard, shop). */

const VW = 960, VH = 520;          // virtual world size, scaled to fit the canvas
const GROUND = 404;                // feet line
const ROPE_Y = 318;                // rope height at rest
const RANGE = 150;                 // ribbon travel from centre to a win line
const FIELD_TOP = 350;
const FRONT_GAP = 80;

const S = {
  t: 0,
  pos: 0, target: 0, vel: 0,       // rope position: -1 = red wins, +1 = blue wins
  cam: 0,
  pullL: 0, pullR: 0,              // pull impulse per team, decays to 0
  flinchL: 0, flinchR: 0,          // wrong-answer stumble
  mode: 'menu',                    // menu | ready | play | over
  winner: 0, winT: 0,
  shake: 0,
};

const TEAM = {
  L: { shirt: '#e5483f', shirtD: '#a92c25', shorts: '#2d3142', band: '#ffd23f', members: [] },
  R: { shirt: '#2f7de1', shirtD: '#1c55a3', shorts: '#26304a', band: '#ffffff', members: [] },
};
const AVATAR_TEAM = { shirt: '#7b5cff', shirtD: '#4b33b8', shorts: '#2d3142', band: '#ffd23f' };

/* people: [{ look: index into Catalog.LOOKS, cos: skin id, label, me }] per side */
function makeMember(o, i) {
  const base = Catalog.LOOKS[(o.look == null ? i : o.look) % Catalog.LOOKS.length];
  return Object.assign({}, base, { skinD: shade(base.skin, -0.18), cos: o.cos || 'classic', label: o.label || '', me: !!o.me });
}
function setTeams(L, R) {
  TEAM.L.members = L.map(makeMember);
  TEAM.R.members = R.map(makeMember);
  resetLanded();
}

const CLOUDS = [
  { x: 60, y: 70, s: 1.1, v: 7 }, { x: 420, y: 46, s: 0.8, v: 5 },
  { x: 700, y: 110, s: 0.9, v: 9 }, { x: 1040, y: 60, s: 1.2, v: 6 },
];
const TREES = [
  { x: -120, s: 1.1 }, { x: 40, s: 0.8 }, { x: 150, s: 1.25 }, { x: 610, s: 0.9 },
  { x: 760, s: 1.3 }, { x: 900, s: 0.85 }, { x: 1060, s: 1.1 },
];
const BUNTING = ['#e5483f', '#ffd23f', '#2f7de1', '#ffffff'];

const canvas = document.getElementById('scene');
const sceneCtx = canvas.getContext('2d');
let ctx = sceneCtx;
let DPR = 1, CW = 1, CH = 1;

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  CW = Math.max(1, r.width); CH = Math.max(1, r.height);
  canvas.width = Math.round(CW * DPR);
  canvas.height = Math.round(CH * DPR);
}
if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/* ---------- helpers ---------- */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, k) { return a + (b - a) * k; }
function lerpP(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }; }
function easeOut(k) { k = clamp(k, 0, 1); return 1 - (1 - k) * (1 - k) * (1 - k); }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function ik(a, b, l1, l2, bend) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.min(Math.hypot(dx, dy) || 0.001, l1 + l2 - 0.5);
  const base = Math.atan2(dy, dx);
  const c = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const k = base + Math.acos(clamp(c, -1, 1)) * bend;
  return { x: a.x + Math.cos(k) * l1, y: a.y + Math.sin(k) * l1 };
}
function line(a, b, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
function circle(x, y, r, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

/* perspective for flat things lying on the field: 1 at the feet line */
function persp(y) { return 1 + (y - GROUND) * 0.0042; }
function px(x, y) { const c = VW / 2 - S.cam; return c + (x - c) * persp(y); }

/* ---------- particles ---------- */
const parts = [];
function spawn(o) {
  parts.push(Object.assign({ vx: 0, vy: 0, g: 0, age: 0, life: 1, size: 4, color: '#fff', type: 'dot', rot: 0, vr: 0, drag: 0.985, floor: null }, o));
  if (parts.length > 420) parts.shift();
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.age += dt;
    if (q.age >= q.life) { parts.splice(i, 1); continue; }
    q.vy += q.g * dt;
    const d = Math.pow(q.drag, dt * 60);
    q.vx *= d; q.vy *= d;
    q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
    if (q.floor !== null && q.y > q.floor) { q.y = q.floor; q.vy *= -0.25; q.vx *= 0.5; }
  }
}
function drawParts() {
  for (const q of parts) {
    const k = q.age / q.life;
    if (q.type === 'dust') {
      ctx.globalAlpha = (1 - k) * 0.55;
      circle(q.x, q.y, q.size * (1 + k * 1.8), q.color);
    } else if (q.type === 'mud') {
      ctx.globalAlpha = 1 - k * k;
      circle(q.x, q.y, q.size, q.color);
    } else if (q.type === 'sweat') {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#bfe8ff';
      ctx.beginPath(); ctx.ellipse(q.x, q.y, q.size * 0.6, q.size, Math.atan2(q.vy, q.vx) + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
    } else if (q.type === 'confetti') {
      ctx.globalAlpha = k > 0.8 ? (1 - k) * 5 : 1;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.scale(1, Math.cos(q.rot * 2.3));
      ctx.fillStyle = q.color; ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
      ctx.restore();
    } else if (q.type === 'dot') {
      ctx.globalAlpha = 1 - k;
      circle(q.x, q.y, q.size * (1 - k * 0.5), q.color);
    } else if (q.type === 'text') {
      const pop = k < 0.15 ? easeOut(k / 0.15) * 1.15 : 1.15 - Math.min(0.15, (k - 0.15));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.save(); ctx.translate(q.x, q.y); ctx.scale(pop, pop);
      ctx.font = `${q.size}px "Lilita One", "Arial Rounded MT Bold", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = q.size * 0.22; ctx.strokeStyle = q.stroke || '#1f2433';
      ctx.strokeText(q.text, 0, 0);
      ctx.fillStyle = q.color; ctx.fillText(q.text, 0, 0);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}
function popText(x, y, text, color, size) {
  spawn({ type: 'text', x, y, vy: -46, drag: 0.97, life: 1.1, text, color, size: size || 26 });
}
function dustAt(x, y, dir, n) {
  for (let i = 0; i < n; i++) {
    spawn({ type: 'dust', x: x + (Math.random() - 0.5) * 10, y: y - Math.random() * 4,
      vx: dir * (20 + Math.random() * 50), vy: -10 - Math.random() * 26, g: 30,
      life: 0.5 + Math.random() * 0.5, size: 3 + Math.random() * 4, color: '#d9c49a' });
  }
}
function mudSplash(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const v = 120 + Math.random() * 220;
    spawn({ type: 'mud', x: x + (Math.random() - 0.5) * 30, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 620,
      life: 0.9 + Math.random() * 0.5, size: 2.5 + Math.random() * 4, color: Math.random() < 0.5 ? '#6b4220' : '#8a5a2b', floor: GROUND + 14 });
  }
}
function confettiBurst(n) {
  const cols = ['#e5483f', '#2f7de1', '#ffd23f', '#23a257', '#ffffff', '#ff8fb1'];
  for (let i = 0; i < n; i++) {
    spawn({ type: 'confetti', x: -S.cam + Math.random() * VW, y: -20 - Math.random() * 120,
      vx: (Math.random() - 0.5) * 80, vy: 40 + Math.random() * 90, g: 60, drag: 0.99,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, life: 3 + Math.random() * 2,
      size: 7 + Math.random() * 6, color: cols[(Math.random() * cols.length) | 0] });
  }
}

/* ---------- backdrop ---------- */
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, FIELD_TOP);
  g.addColorStop(0, '#5db4ea'); g.addColorStop(0.62, '#b9e3f6'); g.addColorStop(1, '#fbe6bd');
  ctx.fillStyle = g; ctx.fillRect(-20, -20, VW + 40, FIELD_TOP + 30);
  const sx = 812 + S.cam * 0.04, sy = 84;
  const sg = ctx.createRadialGradient(sx, sy, 8, sx, sy, 130);
  sg.addColorStop(0, 'rgba(255,246,210,1)'); sg.addColorStop(0.28, 'rgba(255,232,160,.55)'); sg.addColorStop(1, 'rgba(255,232,160,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 130, 0, Math.PI * 2); ctx.fill();
  circle(sx, sy, 31, '#fff5d2');
  const span = VW + 360;
  for (const c of CLOUDS) {
    const x = ((c.x + S.t * c.v + S.cam * 0.08) % span + span) % span - 180;
    drawCloud(x, c.y, c.s);
  }
}
function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(206,232,247,.95)';
  ctx.beginPath(); ctx.ellipse(x + 4 * s, y + 13 * s, 58 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (const [dx, dy, r] of [[-34, 4, 19], [-10, -9, 26], [20, -3, 22], [42, 6, 15]]) {
    ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(x + 2 * s, y + 8 * s, 54 * s, 11 * s, 0, 0, Math.PI * 2); ctx.fill();
}
function hillY(x, base, a1, f1, p1, a2, f2, p2) { return base - Math.sin(x * f1 + p1) * a1 - Math.sin(x * f2 + p2) * a2; }
function hill(base, a1, f1, p1, a2, f2, p2) {
  ctx.beginPath(); ctx.moveTo(-420, FIELD_TOP + 20);
  for (let x = -420; x <= VW + 420; x += 16) ctx.lineTo(x, hillY(x, base, a1, f1, p1, a2, f2, p2));
  ctx.lineTo(VW + 420, FIELD_TOP + 20); ctx.closePath(); ctx.fill();
}
function drawTree(x, y, s) {
  ctx.fillStyle = '#7a5634'; ctx.fillRect(x - 3 * s, y - 22 * s, 6 * s, 24 * s);
  for (const [dx, dy, r, c] of [[-10, -28, 14, '#4f8f3e'], [10, -30, 13, '#4f8f3e'], [0, -42, 16, '#5ea14b'], [-4, -46, 8, '#72b85a']]) {
    circle(x + dx * s, y + dy * s, r * s, c);
  }
}
function drawHills() {
  ctx.save(); ctx.translate(S.cam * 0.15, 0);
  ctx.fillStyle = '#b3d8a6'; hill(290, 26, 0.006, 0.4, 10, 0.017, 1.2);
  ctx.restore();
  ctx.save(); ctx.translate(S.cam * 0.32, 0);
  ctx.fillStyle = '#90c777'; hill(328, 16, 0.009, 2.1, 7, 0.023, 0.3);
  for (const tr of TREES) drawTree(tr.x, hillY(tr.x, 328, 16, 0.009, 2.1, 7, 0.023, 0.3) + 6, tr.s);
  ctx.restore();
}
function drawBunting() {
  let n = 0;
  for (const [x0, y0, x1, y1] of [[-20, 6, 470, 12], [490, 12, 980, 6]]) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 46;
    ctx.strokeStyle = 'rgba(60,50,40,.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
    for (let t = 0.04; t < 0.98; t += 0.068) {
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(S.t * 2.2 + n) * 0.12);
      ctx.fillStyle = BUNTING[n % 4];
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(0, 17); ctx.closePath(); ctx.fill();
      ctx.restore(); n++;
    }
  }
}

/* ---------- field (world space, camera applied) ---------- */
function quadOnField(x0, x1, y0, y1) {
  ctx.beginPath();
  ctx.moveTo(px(x0, y0), y0); ctx.lineTo(px(x1, y0), y0);
  ctx.lineTo(px(x1, y1), y1); ctx.lineTo(px(x0, y1), y1);
  ctx.closePath(); ctx.fill();
}
function drawField() {
  const g = ctx.createLinearGradient(0, FIELD_TOP, 0, VH);
  g.addColorStop(0, '#89c85e'); g.addColorStop(0.45, '#6db347'); g.addColorStop(1, '#4b8f32');
  ctx.fillStyle = g; ctx.fillRect(-S.cam - 30, FIELD_TOP, VW + 60, VH - FIELD_TOP + 30);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = -12; i < 14; i += 2) quadOnField(480 + i * 70, 480 + (i + 1) * 70, FIELD_TOP, VH + 20);
  // team zones beyond each win line
  ctx.fillStyle = 'rgba(229,72,63,.13)'; quadOnField(-500, 480 - RANGE, FIELD_TOP, VH + 20);
  ctx.fillStyle = 'rgba(47,125,225,.13)'; quadOnField(480 + RANGE, 1460, FIELD_TOP, VH + 20);
  // chalk
  ctx.fillStyle = 'rgba(255,255,255,.45)'; quadOnField(478.5, 481.5, FIELD_TOP + 2, VH + 20);
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  quadOnField(480 - RANGE - 3, 480 - RANGE + 3, FIELD_TOP + 2, VH + 20);
  quadOnField(480 + RANGE - 3, 480 + RANGE + 3, FIELD_TOP + 2, VH + 20);
  const hz = ctx.createLinearGradient(0, FIELD_TOP, 0, FIELD_TOP + 20);
  hz.addColorStop(0, 'rgba(255,240,200,.5)'); hz.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = hz; ctx.fillRect(-S.cam - 30, FIELD_TOP, VW + 60, 20);
  // painted team names on the grass
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.26)';
  for (const [label, x] of [[TEAM.L.label || 'RED', 224], [TEAM.R.label || 'BLUE', 736]]) {
    ctx.font = `${Math.min(34, Math.floor(380 / Math.max(4, label.length)))}px "Lilita One", "Arial Rounded MT Bold", sans-serif`;
    ctx.fillText(label, px(x, 482), 482, 240);
  }
}
function drawPole(x, color, out) {
  const by = FIELD_TOP + 8, bx = px(x, by), top = by - 72;
  ctx.lineCap = 'round';
  line({ x: bx, y: by }, { x: bx, y: top }, '#efe9dc', 3.5);
  const w = Math.sin(S.t * 4 + x) * 3;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(bx, top);
  ctx.quadraticCurveTo(bx + out * 20, top + 3 + w, bx + out * 40, top + 12 + w);
  ctx.quadraticCurveTo(bx + out * 20, top + 17 - w * 0.5, bx, top + 25);
  ctx.closePath(); ctx.fill();
  circle(bx, top - 2, 3.2, '#ffd23f');
}
function drawMud() {
  const cx = 480, cy = GROUND + 10;
  ctx.fillStyle = '#4f3218'; ctx.beginPath(); ctx.ellipse(cx, cy + 2, 86, 19, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(cx - 12, cy - 4, 4, cx, cy, 86);
  g.addColorStop(0, '#9a6a36'); g.addColorStop(1, '#6b4220');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, 80, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.17)';
  ctx.beginPath(); ctx.ellipse(cx - 24, cy - 5, 22, 3, -0.05, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 30, cy + 4, 12, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(40,24,10,.6)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const ph = (S.t * 0.7 + i * 0.37) % 1;
    ctx.globalAlpha = 1 - ph;
    ctx.beginPath(); ctx.arc(cx - 40 + i * 38, cy - 2 + (i % 2) * 6, 1.5 + ph * 3.5, Math.PI, 0); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ---------- rope ---------- */
const RSPAN = { a: 0, b: VW, sag: 4, drop: null };
function ropeAt(x) {
  const d = RSPAN.drop;
  if (d) {
    const t = clamp((x - d.x0) / (d.x1 - d.x0), 0, 1);
    return (1 - t) * (1 - t) * d.y0 + 2 * (1 - t) * t * d.yc + t * t * d.y1;
  }
  const mid = (RSPAN.a + RSPAN.b) / 2, half = Math.max(1, (RSPAN.b - RSPAN.a) / 2);
  const u = clamp((x - mid) / half, -1, 1);
  const wob = Math.min(4, Math.abs(S.vel) * 7) * Math.sin(x * 0.045 - S.t * 34) * (1 - u * u);
  return ROPE_Y + RSPAN.sag * (1 - u * u) + wob;
}
function ropeStroke(build) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round'; ctx.strokeStyle = '#6f4a22'; ctx.lineWidth = 9; build(); ctx.stroke();
  ctx.strokeStyle = '#cda266'; ctx.lineWidth = 6; build(); ctx.stroke();
  ctx.setLineDash([3, 5]); ctx.lineCap = 'butt';
  ctx.strokeStyle = '#9c7038'; ctx.lineWidth = 6; build(); ctx.stroke();
  ctx.setLineDash([]); ctx.lineCap = 'round';
}
function spanPath(x0, x1) {
  return () => {
    ctx.beginPath(); ctx.moveTo(x0, ropeAt(x0));
    for (let x = x0 + 8; x < x1; x += 8) ctx.lineTo(x, ropeAt(x));
    ctx.lineTo(x1, ropeAt(x1));
  };
}
function tailPath(x, dir) {   // dir -1 = left tail, 1 = right tail
  return () => {
    const y = ropeAt(x);
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + dir * 30, y + 4, x + dir * 42, GROUND - 6, x + dir * 70, GROUND - 1);
    ctx.lineTo(x + dir * 100, GROUND);
  };
}
function drawRope(hxL, hxR) {
  const d = RSPAN.drop;
  if (!d) {
    ropeStroke(tailPath(RSPAN.a, -1));
    ropeStroke(tailPath(RSPAN.b, 1));
    ropeStroke(spanPath(RSPAN.a, RSPAN.b));
    return;
  }
  if (S.winner < 0) {             // red won: blue end lies on the grass
    ropeStroke(tailPath(RSPAN.a, -1));
    ropeStroke(() => { ctx.beginPath(); ctx.moveTo(d.x1, ropeAt(d.x1)); ctx.lineTo(hxR[hxR.length - 1] + 110, GROUND); });
  } else {
    ropeStroke(tailPath(RSPAN.b, 1));
    ropeStroke(() => { ctx.beginPath(); ctx.moveTo(d.x0, ropeAt(d.x0)); ctx.lineTo(hxL[hxL.length - 1] - 110, GROUND); });
  }
  ropeStroke(spanPath(d.x0, d.x1));
}
function drawRibbon(mx) {
  const y = ropeAt(mx);
  const sway = clamp(-S.vel * 24, -14, 14) + Math.sin(S.t * 5) * 2.5;
  // guide line to the ground so crossing a chalk line is easy to read
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(mx, y + 40); ctx.lineTo(mx, GROUND + 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(mx, GROUND + 3, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#a57c00'; ctx.fillStyle = '#ffd23f';
  for (const s of [-1, 1]) {
    const ex = mx + s * 8 + sway, ey = y + 38;
    ctx.beginPath(); ctx.moveTo(mx - 2 + s * 2, y);
    ctx.quadraticCurveTo(mx + s * 4 + sway * 0.3, y + 20, ex - 4, ey);
    ctx.lineTo(ex, ey - 5); ctx.lineTo(ex + 4, ey + 1);
    ctx.quadraticCurveTo(mx + s * 9 + sway * 0.4, y + 18, mx + 2 + s * 2, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(mx, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  circle(mx - 2, y - 2, 2, '#fff3b0');
}

/* ---------- people ---------- */
function teamPose(k, i, ropeY) {
  const isL = k === 'L';
  const mine = isL ? S.pullL : S.pullR;
  const theirs = isL ? S.pullR : S.pullL;
  const flinch = isL ? S.flinchL : S.flinchR;
  const ph = i * 1.9 + (isL ? 0 : 0.7);
  const p = { lean: 0.36, bob: 0, liftA: 0, liftB: 0, slide: 0, jump: 0, armsUp: 0, fall: 0, mood: 'grit', ropeY };
  if (S.mode === 'over' && S.winner !== 0) {
    if ((S.winner < 0) === isL) {
      const w = easeOut(S.winT / 0.5);
      p.lean = lerp(0.4, 0.05, w);
      p.jump = Math.abs(Math.sin(S.t * 7 + ph)) * 20 * w;
      p.armsUp = easeOut((S.winT - 0.25 - i * 0.08) / 0.4);
      p.mood = 'win';
    } else {
      const f = easeOut((S.winT - 0.05 - i * 0.12) / 0.5);
      p.lean = lerp(0.2, -0.15, f);
      p.fall = f;
      p.mood = 'lose';
    }
    return p;
  }
  p.lean = 0.34 + 0.34 * mine - 0.16 * theirs - 0.2 * flinch + Math.sin(S.t * 2.1 + ph) * 0.025;
  p.bob = Math.sin(S.t * 3.2 + ph) * 1.2 + mine * 3;
  if (mine > 0.12) {
    const st = S.t * 17 + ph;
    p.liftA = Math.max(0, Math.sin(st)) * 9 * mine;
    p.liftB = Math.max(0, Math.sin(st + Math.PI)) * 9 * mine;
    p.slide = -mine * 6;
  }
  p.slide += theirs * 8 + flinch * 10;
  p.mood = mine > 0.3 ? 'pull' : (theirs > 0.35 || flinch > 0.3) ? 'strain' : 'grit';
  return p;
}
function buildPerson(k, i, hx, m = TEAM[k].members[i], p = teamPose(k, i, ropeAt(hx)), team = TEAM[k]) {
  const dir = k === 'L' ? 1 : -1;
  const h = m.h, by = GROUND - p.jump, lean = p.lean;
  const hip = { x: -30 - lean * 18 + p.slide * 0.45, y: by - 58 * h + lean * 12 + p.bob };
  const T = 48 * h;
  const sh = { x: hip.x - Math.sin(lean) * T, y: hip.y - Math.cos(lean) * T };
  const hr = 12.5 * h;
  const hd = { x: sh.x - Math.sin(lean) * (hr + 4), y: sh.y - Math.cos(lean) * (hr + 4) };
  const fF = { x: -4 + p.slide, y: by - p.liftA };
  const fB = { x: -26 + p.slide * 0.7, y: by - p.liftB };
  const kF = ik(hip, fF, 32 * h, 32 * h, -1), kB = ik(hip, fB, 32 * h, 32 * h, -1);
  let hF = { x: 0, y: p.ropeY }, hB = { x: -13, y: p.ropeY + 1 };
  const up = Math.max(p.armsUp, p.fall);
  if (up > 0) {
    const wav = Math.sin(S.t * 10 + i) * 6 * p.armsUp;
    hF = lerpP(hF, { x: sh.x + 16, y: sh.y - 56 * h + wav }, up);
    hB = lerpP(hB, { x: sh.x - 6, y: sh.y - 58 * h - wav }, up);
  }
  const eF = ik(sh, hF, 36 * h, 34 * h, 1), eB = ik(sh, hB, 36 * h, 34 * h, 1);
  return { k, i, dir, hx, m, p, T: team, h, hip, sh, hd, hr, fF, fB, kF, kB, hF, hB, eF, eB };
}
function applyXf(P) {
  ctx.translate(P.hx, 0);
  ctx.scale(P.dir, 1);
  if (P.p.fall > 0) {
    ctx.translate(-4, GROUND);
    ctx.rotate(P.p.fall * 1.38);
    ctx.translate(4, -GROUND - P.p.fall * 4);
  }
}
// c: { upper, lower, hand, sleeve?, sleeveLen?, cuff?, handR? }
function drawArm(sh, el, hand, c, h) {
  line(sh, el, c.upper, 9 * h);
  line(el, hand, c.lower, 8 * h);
  if (c.sleeve) line(sh, lerpP(sh, el, c.sleeveLen || 0.45), c.sleeve, 12.5 * h);
  if (c.cuff) line(lerpP(el, hand, 0.45), lerpP(el, hand, 0.82), c.cuff, 11 * h);
  circle(hand.x, hand.y, (c.handR || 5.3) * h, c.hand);
}
// c: { thigh, shin, shorts?, shortsLen?, knee?, sock?, boot?, shoe, sole, sandal? }
function drawLeg(hip, knee, foot, c, h, lift) {
  line(hip, knee, c.thigh, 11 * h);
  line(knee, foot, c.shin, 10 * h);
  if (c.shorts) line(hip, lerpP(hip, knee, c.shortsLen || 0.7), c.shorts, 14.5 * h);
  if (c.knee) line(lerpP(hip, knee, 0.86), lerpP(hip, knee, 0.98), c.knee, 15 * h);
  if (c.sock) line(lerpP(knee, foot, 0.62), foot, c.sock, 10 * h);
  if (c.boot) line(lerpP(knee, foot, 0.4), foot, c.boot, 11.5 * h);
  ctx.save(); ctx.translate(foot.x, foot.y); ctx.rotate(-lift * 0.025);
  if (c.sandal) {
    ctx.fillStyle = c.sole; ctx.fillRect(-5 * h, 0, 20 * h, 2.6 * h);
    ctx.strokeStyle = c.shoe; ctx.lineWidth = 1.8 * h;
    ctx.beginPath(); ctx.moveTo(2 * h, 0.5 * h); ctx.lineTo(7 * h, -3 * h); ctx.lineTo(11 * h, 0.5 * h); ctx.stroke();
  } else {
    ctx.fillStyle = c.shoe;
    ctx.beginPath(); ctx.ellipse(5 * h, -3 * h, 11 * h, 5.5 * h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.sole; ctx.fillRect(-5 * h, 0.5 * h, 21 * h, 2.4 * h);
  }
  ctx.restore();
}
// team kit, or a full-body costume (SUITS) when the skin has one; far = the limb behind the body
function armKit(P, far) {
  const { m, T } = P, s = SUITS[m.cos];
  if (s) return darken(s.arm(m), far);
  return far ? { upper: m.skinD, lower: m.skinD, hand: m.skinD, sleeve: T.shirtD }
    : { upper: m.skin, lower: m.skin, hand: m.skin, sleeve: T.shirt };
}
function legKit(P, far) {
  const { m, T } = P, s = SUITS[m.cos];
  if (s) return darken(s.leg(m), far);
  return { thigh: far ? m.skinD : m.skin, shin: far ? m.skinD : m.skin, shorts: far ? shade(T.shorts, -0.3) : T.shorts,
    sock: '#f4f1ea', shoe: '#2a2d3a', sole: '#e9e4d8' };
}
function darken(kit, far) {
  if (!far) return kit;
  const out = {};
  for (const k in kit) out[k] = typeof kit[k] === 'string' && kit[k][0] === '#' ? shade(kit[k], -0.22) : kit[k];
  return out;
}
function drawShadow(P) {
  const x = P.hx + P.dir * (P.hip.x + P.p.fall * 60);
  const s = 1 - P.p.jump / 60;
  ctx.fillStyle = 'rgba(20,50,10,.22)';
  ctx.beginPath(); ctx.ellipse(x, GROUND + 3, 36 * s + P.p.fall * 30, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
}
function drawBody(P) {
  const { m, h, p, T } = P;
  ctx.save(); applyXf(P);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const suit = SUITS[m.cos];
  const tor = suit ? suit.torso(m) : { shirt: T.shirt, back: T.shirtD, hip: T.shorts, neck: m.skinD };
  drawCosBack(P);
  drawArm(P.sh, P.eB, P.hB, armKit(P, true), h);
  drawLeg(P.hip, P.kB, P.fB, legKit(P, true), h, p.liftB);
  line(P.sh, lerpP(P.sh, P.hd, 0.6), tor.neck, 8 * h);
  line(P.hip, P.sh, tor.shirt, 25 * h);
  const cl = Math.cos(p.lean), sl = Math.sin(p.lean);
  const bx = -cl * 7 * h, byy = sl * 7 * h;
  line({ x: P.hip.x + bx, y: P.hip.y + byy }, { x: P.sh.x + bx, y: P.sh.y + byy }, tor.back, 7 * h);
  if (!suit) line(lerpP(P.hip, P.sh, 0.55), lerpP(P.hip, P.sh, 0.56), 'rgba(255,255,255,.9)', 7 * h);
  line(P.hip, lerpP(P.hip, P.sh, 0.2), tor.hip, 26 * h);
  if (suit) {
    // unit vectors: along the torso (hip -> shoulder) and across it toward the front
    const ax = { x: -sl, y: -cl }, fr = { x: cl, y: -sl };
    if (suit.chest) suit.chest(P, ax, fr);
    // team belt with a white trim, so red and blue sides stay easy to tell apart in any costume
    ctx.lineCap = 'butt';
    line(lerpP(P.hip, P.sh, 0.13), lerpP(P.hip, P.sh, 0.26), '#ffffff', 25 * h);
    line(lerpP(P.hip, P.sh, 0.15), lerpP(P.hip, P.sh, 0.24), T.shirt, 25 * h);
    ctx.lineCap = 'round';
  }
  drawLeg(P.hip, P.kF, P.fF, legKit(P, false), h, p.liftA);
  drawHead(P);
  ctx.restore();
}
function drawNearArm(P) {
  ctx.save(); applyXf(P);
  ctx.lineCap = 'round';
  drawArm(P.sh, P.eF, P.hF, armKit(P, false), P.h);
  ctx.restore();
}

const BAND_SKINS = new Set(['classic', 'shades', 'cat', 'halo', 'legend']);
function drawHead(P) {
  const { m, h, p, hr, T } = P;
  const ink = '#1f2433';
  ctx.save(); ctx.translate(P.hd.x, P.hd.y); ctx.rotate(-p.lean * 0.35);
  const suit = SUITS[m.cos];
  if (suit && suit.mask) {                       // full helmet or mask: no hair, no face
    suit.mask(P, 5.2 * h, -1.2 * h);
    ctx.restore();
    return;
  }
  const hat = m.cos === 'robot' || m.cos === 'straw';
  if (m.style === 'afro' && !hat) circle(-1.5 * h, -2 * h, hr * 1.28, m.hair);
  if (m.style === 'pony' && !hat) {
    circle(-hr * 1.02, 0, hr * 0.4, m.hair);
    ctx.fillStyle = m.hair;
    ctx.beginPath(); ctx.ellipse(-hr * 1.45, 6 * h + Math.sin(S.t * 8 + P.i) * 1.5, hr * 0.3, hr * 0.58, 0.5, 0, Math.PI * 2); ctx.fill();
  }
  circle(0, 0, hr, m.skin);
  if (m.cos === 'straw') strawHair(P);
  else if (m.style !== 'bald' && m.cos !== 'robot') {
    ctx.fillStyle = m.hair;
    ctx.beginPath(); ctx.arc(0, 0, hr + 0.6, Math.PI * 0.92, Math.PI * 1.9);
    ctx.quadraticCurveTo(hr * 0.2, -hr * 0.5, -hr * 0.3, -hr * 0.3);
    ctx.closePath(); ctx.fill();
  }
  if (BAND_SKINS.has(m.cos)) drawBand(P, T.band);
  circle(-2 * h, 2 * h, 3 * h, m.skinD);
  circle(hr - 0.5, 1.5 * h, 2.6 * h, m.skin);
  // face
  const ex = 5.2 * h, ey = -1.2 * h;
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.6 * h;
  if (p.mood === 'pull') {
    circle(ex, ey, 1.7 * h, ink);
    ctx.beginPath(); ctx.moveTo(ex - 3.5 * h, ey - 5 * h); ctx.lineTo(ex + 3 * h, ey - 2.6 * h); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.rect(3.2 * h, 4.3 * h, 6.6 * h, 3.4 * h); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 0.9 * h; ctx.beginPath(); ctx.moveTo(3.2 * h, 6 * h); ctx.lineTo(9.8 * h, 6 * h); ctx.stroke();
  } else if (p.mood === 'strain') {
    ctx.beginPath(); ctx.moveTo(ex - 2 * h, ey - 2.2 * h); ctx.lineTo(ex + 1.6 * h, ey); ctx.lineTo(ex - 2 * h, ey + 2.2 * h); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(7 * h, 6 * h, 2 * h, 2.7 * h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,90,90,.35)'; ctx.beginPath(); ctx.arc(3.5 * h, 4 * h, 3 * h, 0, Math.PI * 2); ctx.fill();
  } else if (p.mood === 'win') {
    ctx.beginPath(); ctx.arc(ex, ey + 1 * h, 2.2 * h, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(5.5 * h, 3.6 * h, 4.2 * h, 0, Math.PI); ctx.closePath(); ctx.fill();
    circle(5.5 * h, 6.2 * h, 1.7 * h, '#e8606a');
  } else if (p.mood === 'lose') {
    ctx.beginPath();
    ctx.moveTo(ex - 2 * h, ey - 2 * h); ctx.lineTo(ex + 2 * h, ey + 2 * h);
    ctx.moveTo(ex + 2 * h, ey - 2 * h); ctx.lineTo(ex - 2 * h, ey + 2 * h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3 * h, 6 * h);
    ctx.quadraticCurveTo(4.8 * h, 4.2 * h, 6.4 * h, 6 * h); ctx.quadraticCurveTo(8 * h, 7.8 * h, 9.6 * h, 6 * h); ctx.stroke();
  } else {
    circle(ex, ey, 1.7 * h, ink);
    ctx.beginPath(); ctx.moveTo(ex - 3 * h, ey - 4.2 * h); ctx.lineTo(ex + 2.6 * h, ey - 3.4 * h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4 * h, 6 * h); ctx.lineTo(9.2 * h, 5.4 * h); ctx.stroke();
  }
  drawHeadgear(P, ex, ey);
  ctx.restore();
}

// headband in team colour, with tails that flap
function drawBand(P, color) {
  const { h, hr } = P;
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, hr + 0.8, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = color; ctx.fillRect(-hr - 2, -hr * 0.56, hr * 2 + 4, hr * 0.34);
  ctx.restore();
  const fl = Math.sin(S.t * 12 + P.i * 2) * 2.5;
  ctx.strokeStyle = color; ctx.lineWidth = 2.6 * h; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-hr + 1, -hr * 0.4); ctx.quadraticCurveTo(-hr - 6, -hr * 0.45 + fl, -hr - 12, -hr * 0.12 + fl * 1.4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-hr + 1, -hr * 0.35); ctx.quadraticCurveTo(-hr - 5, -hr * 0.1 - fl, -hr - 9, hr * 0.25 - fl); ctx.stroke();
}

/* ---------- skins: headgear drawn in head space (facing +x), extras drawn behind the body ---------- */
function drawHeadgear(P, ex, ey) {
  const { m, h, hr, T } = P;
  const ink = '#1f2433';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (m.cos) {
    case 'cap': {
      ctx.fillStyle = T.shirt;
      ctx.beginPath(); ctx.arc(0, -hr * 0.3, hr + 0.6, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.shirtD;
      ctx.beginPath(); ctx.ellipse(hr * 0.78, -hr * 0.36, hr * 0.72, hr * 0.17, 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = T.shirtD; ctx.lineWidth = 1.3 * h;
      ctx.beginPath(); ctx.moveTo(0, -hr * 1.28); ctx.quadraticCurveTo(hr * 0.35, -hr * 0.9, hr * 0.3, -hr * 0.42); ctx.stroke();
      circle(0, -hr * 1.3, 1.9 * h, T.shirtD);
      ctx.fillStyle = '#fff'; ctx.font = `700 ${7 * h}px Fredoka, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×', -hr * 0.3, -hr * 0.8);
      break;
    }
    case 'shades': {
      ctx.strokeStyle = '#15161c'; ctx.lineWidth = 1.4 * h;
      ctx.beginPath(); ctx.moveTo(ex - 3.5 * h, ey - 0.8 * h); ctx.lineTo(-hr * 0.85, ey - 1.8 * h); ctx.stroke();
      ctx.fillStyle = '#15161c';
      ctx.beginPath(); ctx.ellipse(ex + 0.6 * h, ey, 4.4 * h, 3 * h, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1 * h;
      ctx.beginPath(); ctx.moveTo(ex - 1.2 * h, ey - 1.4 * h); ctx.lineTo(ex + 1.6 * h, ey - 1.4 * h); ctx.stroke();
      break;
    }
    case 'cat': {
      for (const [a, s] of [[-2.05, 1], [-1.2, 0.92]]) {
        const bx1 = Math.cos(a - 0.3) * hr, by1 = Math.sin(a - 0.3) * hr;
        const bx2 = Math.cos(a + 0.3) * hr, by2 = Math.sin(a + 0.3) * hr;
        const tx = Math.cos(a) * (hr + 9 * h * s), ty = Math.sin(a) * (hr + 9 * h * s);
        ctx.fillStyle = m.hair; ctx.beginPath(); ctx.moveTo(bx1, by1); ctx.lineTo(tx, ty); ctx.lineTo(bx2, by2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff9fb6';
        ctx.beginPath(); ctx.moveTo(lerp(bx1, tx, 0.25), lerp(by1, ty, 0.25)); ctx.lineTo(lerp(tx, (bx1 + bx2) / 2, 0.22), lerp(ty, (by1 + by2) / 2, 0.22));
        ctx.lineTo(lerp(bx2, tx, 0.25), lerp(by2, ty, 0.25)); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = ink; ctx.lineWidth = 0.8 * h;
      for (const dy of [-0.6, 0.8]) { ctx.beginPath(); ctx.moveTo(hr * 0.55, 3.5 * h); ctx.lineTo(hr * 1.2, (3.5 + dy * 2) * h); ctx.stroke(); }
      break;
    }
    case 'pirate': {
      circle(ex, ey, 2.8 * h, '#15161c');
      ctx.strokeStyle = '#15161c'; ctx.lineWidth = 1.2 * h;
      ctx.beginPath(); ctx.moveTo(ex - 1.5 * h, ey - 2.4 * h); ctx.lineTo(-hr * 0.7, -hr * 0.62); ctx.stroke();
      ctx.fillStyle = '#1d1b22';
      ctx.beginPath(); ctx.arc(0, -hr * 0.42, hr * 0.92, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-hr - 7 * h, -hr * 0.2);
      ctx.quadraticCurveTo(0, -hr * 0.75, hr + 7 * h, -hr * 0.2);
      ctx.quadraticCurveTo(0, -hr * 0.2, -hr - 7 * h, -hr * 0.2); ctx.fill();
      ctx.strokeStyle = '#e8c35a'; ctx.lineWidth = 1.2 * h;
      ctx.beginPath(); ctx.moveTo(-hr - 6 * h, -hr * 0.24); ctx.quadraticCurveTo(0, -hr * 0.7, hr + 6 * h, -hr * 0.24); ctx.stroke();
      circle(0, -hr * 0.92, 2.4 * h, '#f4f1ea');
      circle(-0.8 * h, -hr * 0.95, 0.6 * h, '#1d1b22'); circle(0.8 * h, -hr * 0.95, 0.6 * h, '#1d1b22');
      break;
    }
    case 'ninja': {
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, hr + 0.8, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#23242c'; ctx.fillRect(-hr - 2, -hr - 2, hr * 2 + 4, hr * 2 + 4);
      ctx.fillStyle = m.skin; ctx.fillRect(hr * 0.05, ey - 3.2 * h, hr, 5.6 * h);
      ctx.restore();
      circle(ex, ey, 1.7 * h, ink);
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5 * h;
      ctx.beginPath(); ctx.moveTo(ex - 3 * h, ey - 3.8 * h); ctx.lineTo(ex + 2.8 * h, ey - 2.4 * h); ctx.stroke();
      drawBand(P, T.shirt);
      break;
    }
    case 'viking': {
      ctx.fillStyle = '#f3ead2'; ctx.strokeStyle = '#b9a67a'; ctx.lineWidth = 1 * h;
      for (const s of [1, -1]) {
        ctx.beginPath(); ctx.moveTo(s * hr * 0.55, -hr * 0.7);
        ctx.quadraticCurveTo(s * hr * 1.45, -hr * 0.9, s * hr * 1.2, -hr * 1.75);
        ctx.quadraticCurveTo(s * hr * 1.05, -hr * 1.1, s * hr * 0.25, -hr * 0.95); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = '#aeb8c2';
      ctx.beginPath(); ctx.arc(0, -hr * 0.28, hr + 1, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(hr * 0.2, -hr * 0.95, hr * 0.35, hr * 0.12, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-hr - 1, -hr * 0.42, hr * 2 + 2, hr * 0.22);
      for (let x = -hr * 0.7; x <= hr * 0.8; x += hr * 0.5) circle(x, -hr * 0.31, 0.9 * h, '#e8c35a');
      break;
    }
    case 'wizard': {
      const sway = Math.sin(S.t * 2.4 + P.i) * 3 * h;
      ctx.fillStyle = '#5b3fc4';
      ctx.beginPath(); ctx.moveTo(-hr * 0.85, -hr * 0.55);
      ctx.quadraticCurveTo(-hr * 0.1, -hr * 1.7, -hr * 0.9 + sway, -hr * 2.9);
      ctx.quadraticCurveTo(hr * 0.35, -hr * 1.6, hr * 0.85, -hr * 0.55); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -hr * 0.55, hr + 6 * h, 2.8 * h, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-hr * 0.8, -hr * 0.85, hr * 1.6, 2.4 * h);
      for (const [x, y, r] of [[-0.1, -1.35, 1.7], [-0.45, -1.9, 1.3], [0.3, -1.1, 1.1]]) drawStar(x * hr, y * hr, r * h, '#ffe680');
      circle(-hr * 0.9 + sway, -hr * 2.9, 1.8 * h, '#ffd23f');
      break;
    }
    case 'astro': {
      ctx.fillStyle = 'rgba(160,215,255,.28)'; ctx.strokeStyle = '#f4f7fb'; ctx.lineWidth = 3 * h;
      ctx.beginPath(); ctx.arc(1 * h, -0.5 * h, hr * 1.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.6 * h;
      ctx.beginPath(); ctx.arc(1 * h, -0.5 * h, hr * 1.18, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke();
      ctx.fillStyle = '#f4f7fb'; ctx.fillRect(-hr * 0.9, hr * 1.05, hr * 1.9, 3.5 * h);
      ctx.fillStyle = T.shirt; ctx.fillRect(-hr * 0.35, hr * 1.1, hr * 0.7, 2.4 * h);
      break;
    }
    case 'robot': {
      ctx.fillStyle = '#b7c1cc';
      roundRect(-hr - 1, -hr - 1, hr * 2 + 2, hr * 2 + 2, 4 * h); ctx.fill();
      ctx.fillStyle = '#9aa6b3'; roundRect(-hr - 1, hr * 0.35, hr * 2 + 2, hr * 0.65 + 1, 3 * h); ctx.fill();
      ctx.fillStyle = '#1d2a36'; roundRect(hr * 0.05, ey - 3.6 * h, hr + 0.5, 6.2 * h, 2 * h); ctx.fill();
      const blink = (S.t * 0.7 + P.i * 0.3) % 3 < 0.08;
      ctx.fillStyle = '#5ff4ff'; ctx.shadowColor = '#5ff4ff'; ctx.shadowBlur = 6 * h;
      if (blink) ctx.fillRect(ex - 2 * h, ey - 0.4 * h, 4 * h, 0.8 * h); else circle(ex, ey, 2 * h, '#5ff4ff');
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#6b7784'; ctx.lineWidth = 1 * h;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(3 * h + i * 2.6 * h, 5.5 * h); ctx.lineTo(3 * h + i * 2.6 * h, 8.5 * h); ctx.stroke(); }
      circle(-3 * h, 1 * h, 2.6 * h, '#8a96a3'); circle(-3 * h, 1 * h, 1.1 * h, T.shirt);
      line({ x: 0, y: -hr - 1 }, { x: 0, y: -hr - 7 * h }, '#6b7784', 1.4 * h);
      circle(0, -hr - 8 * h, 2.2 * h, Math.sin(S.t * 6 + P.i) > 0 ? T.shirt : '#ff5d5d');
      break;
    }
    case 'crown': {
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1 * h;
      ctx.beginPath(); ctx.moveTo(-hr * 0.75, -hr * 0.62);
      for (const [x, y] of [[-hr * 0.85, -hr * 1.45], [-hr * 0.4, -hr * 1.0], [0, -hr * 1.6], [hr * 0.4, -hr * 1.0], [hr * 0.85, -hr * 1.45], [hr * 0.75, -hr * 0.62]]) ctx.lineTo(x, y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      circle(0, -hr * 0.82, 1.8 * h, '#e5483f'); circle(-hr * 0.45, -hr * 0.78, 1.3 * h, '#2f7de1'); circle(hr * 0.45, -hr * 0.78, 1.3 * h, '#23a257');
      for (const x of [-hr * 0.85, 0, hr * 0.85]) circle(x, x ? -hr * 1.45 : -hr * 1.6, 1.3 * h, '#fff3b0');
      break;
    }
    case 'halo': {
      const bob = Math.sin(S.t * 3 + P.i) * 1.5 * h;
      ctx.shadowColor = '#bfe8ff'; ctx.shadowBlur = 10 * h;
      ctx.strokeStyle = '#fff4b8'; ctx.lineWidth = 2.6 * h;
      ctx.beginPath(); ctx.ellipse(-1 * h, -hr - 7 * h + bob, hr * 0.8, 2.6 * h, -0.1, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }
    case 'straw': {
      // stitched scar under the eye
      ctx.strokeStyle = '#8a3f22'; ctx.lineWidth = 0.9 * h;
      ctx.beginPath(); ctx.arc(ex - 0.6 * h, ey + 2.6 * h, 2.2 * h, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      for (const t of [0.35, 0.65]) {
        const a = Math.PI * (0.15 + 0.7 * t), x = ex - 0.6 * h + Math.cos(a) * 2.2 * h, y = ey + 2.6 * h + Math.sin(a) * 2.2 * h;
        ctx.beginPath(); ctx.moveTo(x - 0.2 * h, y - 0.9 * h); ctx.lineTo(x + 0.2 * h, y + 0.9 * h); ctx.stroke();
      }
      // straw hat with a red band, tilted back a little
      ctx.save(); ctx.rotate(-0.12 + Math.sin(S.t * 2 + P.i) * 0.02);
      ctx.fillStyle = '#e9c46a'; ctx.strokeStyle = '#a67c2e'; ctx.lineWidth = 1 * h;
      ctx.beginPath(); ctx.ellipse(0.5 * h, -hr * 0.62, hr + 9 * h, 3.3 * h, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-hr * 0.82, -hr * 0.66);
      ctx.bezierCurveTo(-hr * 0.88, -hr * 1.78, hr * 0.88, -hr * 1.78, hr * 0.82, -hr * 0.66);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c1272d'; ctx.fillRect(-hr * 0.84, -hr * 0.98, hr * 1.68, 2.8 * h);
      ctx.strokeStyle = 'rgba(166,124,46,.55)'; ctx.lineWidth = 0.6 * h;
      for (const x of [-1.25, -0.95, 0.95, 1.25]) { ctx.beginPath(); ctx.moveTo(x * hr, -hr * 0.66); ctx.lineTo(x * hr * 1.12, -hr * 0.5); ctx.stroke(); }
      ctx.restore();
      break;
    }
    case 'legend': {
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 0.8 * h;
      for (let a = Math.PI * 0.95; a <= Math.PI * 1.96; a += 0.17) {
        const x = Math.cos(a) * (hr + 1.5), y = Math.sin(a) * (hr + 1.5);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2 + 0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, 1.6 * h, 3.6 * h, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      circle(0, -hr - 2.5 * h, 2.2 * h, '#ff7a2f');
      break;
    }
  }
}
function drawCosBack(P) {
  const { m, h } = P;
  if (m.cos === 'doom') {
    // green cape from the shoulders, trailing behind and flapping with the pull
    const wave = Math.sin(S.t * 4 + P.i) * 4 * h - P.p.lean * 10 * h;
    const s = P.sh, bottomY = Math.min(GROUND - 4, P.hip.y + 40 * h);
    ctx.fillStyle = '#1f6a2a'; ctx.strokeStyle = '#144a1c'; ctx.lineWidth = 1.2 * h;
    ctx.beginPath(); ctx.moveTo(s.x + 6 * h, s.y - 3 * h);
    ctx.quadraticCurveTo(s.x - 16 * h + wave * 0.5, P.hip.y - 6 * h, s.x - 28 * h + wave, bottomY);
    ctx.lineTo(s.x - 14 * h + wave * 0.8, bottomY - 4 * h);
    ctx.lineTo(s.x - 4 * h + wave * 0.5, bottomY + 1 * h);
    ctx.quadraticCurveTo(P.hip.x - 2 * h, P.hip.y, s.x - 5 * h, s.y + 4 * h);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (m.cos === 'halo') {
    const flap = Math.sin(S.t * 5 + P.i) * 0.18;
    const o = { x: P.sh.x - 4 * h, y: P.sh.y + 8 * h };
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-0.5 - flap);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#a9d8ff'; ctx.lineWidth = 1.4 * h;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-18 * h, -34 * h, -44 * h, -30 * h);
    ctx.quadraticCurveTo(-36 * h, -20 * h, -40 * h, -14 * h);
    ctx.quadraticCurveTo(-30 * h, -10 * h, -32 * h, -2 * h);
    ctx.quadraticCurveTo(-18 * h, -2 * h, 0, 0); ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (m.cos === 'legend') {
    const cx = lerp(P.hip.x, P.sh.x, 0.5), cy = lerp(P.hip.y, P.sh.y, 0.5);
    const g = ctx.createRadialGradient(cx, cy, 6 * h, cx, cy, 62 * h);
    g.addColorStop(0, 'rgba(255,210,63,.55)'); g.addColorStop(0.6, 'rgba(255,122,47,.25)'); g.addColorStop(1, 'rgba(255,122,47,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 62 * h, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.42, f = 1 + Math.sin(S.t * 9 + i * 1.7) * 0.18;
      const bx = cx + Math.cos(a) * 26 * h, by = cy + Math.sin(a) * 30 * h;
      const tx = cx + Math.cos(a) * 54 * h * f, ty = cy + Math.sin(a) * 60 * h * f;
      ctx.fillStyle = i % 2 ? 'rgba(255,179,58,.75)' : 'rgba(255,122,47,.7)';
      ctx.beginPath(); ctx.moveTo(bx - 7 * h, by); ctx.quadraticCurveTo(bx, by - 6 * h, tx, ty); ctx.quadraticCurveTo(bx + 2 * h, by - 4 * h, bx + 7 * h, by); ctx.closePath(); ctx.fill();
    }
  }
}
/* ---------- full-body costumes ----------
   torso(m) -> { shirt, back, hip, neck }; arm(m) / leg(m) -> kits for drawArm / drawLeg;
   chest(P, along, front) draws on the torso; mask(P, ex, ey) replaces the whole head. */
const IRON = { red: '#c81d25', redD: '#8e1117', gold: '#f2b416', goldD: '#9a6a00' };
const DOOM = { green: '#2f8a3a', greenD: '#1f5e27', steel: '#a9b1ba', steelD: '#6f7780', gold: '#e8b923' };
const WEB = { red: '#d6262b', redD: '#8f1418', blue: '#2d5bc4' };
const STRAW = { vest: '#d6312b', shorts: '#3a63b0' };
const torsoAt = (P, t, fr, off) => { const c = lerpP(P.hip, P.sh, t); return { x: c.x + fr.x * off, y: c.y + fr.y * off }; };

const SUITS = {
  iron: {
    torso: () => ({ shirt: IRON.red, back: IRON.redD, hip: IRON.red, neck: IRON.redD }),
    arm: () => ({ upper: IRON.gold, lower: IRON.red, hand: IRON.red, sleeve: IRON.red, sleeveLen: 0.4, handR: 5.7 }),
    leg: () => ({ thigh: IRON.gold, shin: IRON.red, shorts: IRON.red, shortsLen: 0.35, knee: IRON.redD, shoe: IRON.redD, sole: '#5a0b10' }),
    chest(P, ax, fr) {
      const { h } = P;
      line(torsoAt(P,0.3, fr, 2 * h), torsoAt(P,0.48, fr, 2 * h), IRON.gold, 13 * h);             // gold abdomen plate
      const c = torsoAt(P,0.72, fr, 3 * h);
      circle(c.x, c.y, 5 * h, '#5a6470');
      ctx.shadowColor = '#9ff3ff'; ctx.shadowBlur = (7 + Math.sin(S.t * 6) * 2) * h;       // glowing chest core
      circle(c.x, c.y, 3.6 * h, '#e9fdff');
      ctx.shadowBlur = 0;
      circle(c.x, c.y, 1.6 * h, '#9ff3ff');
    },
    mask(P, ex, ey) {
      const { h, hr, p } = P;
      circle(0, 0, hr + 1.2 * h, '#b3161d');
      ctx.fillStyle = IRON.gold; ctx.strokeStyle = IRON.goldD; ctx.lineWidth = 0.9 * h;
      ctx.beginPath(); ctx.moveTo(hr * 0.1, -hr * 0.62); ctx.lineTo(hr * 0.9, -hr * 0.66);
      ctx.quadraticCurveTo(hr * 1.28, -hr * 0.1, hr * 1.1, hr * 0.5);
      ctx.lineTo(hr * 0.62, hr * 1.02); ctx.lineTo(hr * 0.12, hr * 0.96);
      ctx.quadraticCurveTo(-hr * 0.12, hr * 0.2, hr * 0.1, -hr * 0.62);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b3161d';
      ctx.beginPath(); ctx.moveTo(hr * 0.3, -hr * 0.64); ctx.lineTo(hr * 0.6, -hr * 0.28); ctx.lineTo(hr * 0.92, -hr * 0.66); ctx.closePath(); ctx.fill();
      const off = p.mood === 'lose';
      ctx.fillStyle = off ? '#8a939c' : '#fdfdf2';
      ctx.shadowColor = '#9ff3ff'; ctx.shadowBlur = off ? 0 : (p.mood === 'pull' ? 10 : 5) * h;
      ctx.beginPath(); ctx.moveTo(ex - 3.4 * h, ey - 0.4 * h); ctx.lineTo(ex + 4.6 * h, ey - 1.8 * h);
      ctx.lineTo(ex + 4.2 * h, ey + 0.6 * h); ctx.lineTo(ex - 2.8 * h, ey + 1.1 * h); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = IRON.goldD; ctx.lineWidth = 0.9 * h;
      ctx.beginPath(); ctx.moveTo(hr * 0.3, hr * 0.64); ctx.lineTo(hr * 0.95, hr * 0.54); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.ellipse(-hr * 0.25, -hr * 0.62, hr * 0.38, hr * 0.14, -0.4, 0, Math.PI * 2); ctx.fill();
    },
  },
  doom: {
    torso: () => ({ shirt: DOOM.green, back: DOOM.greenD, hip: DOOM.green, neck: DOOM.steelD }),
    arm: () => ({ upper: DOOM.steel, lower: '#b8c0c9', hand: '#8b949e', cuff: '#8b949e', handR: 6.6 }),
    leg: () => ({ thigh: DOOM.steel, shin: '#b3bbc4', shorts: DOOM.green, shortsLen: 0.6, boot: '#8b949e', shoe: '#6b737c', sole: '#4b525a' }),
    chest(P, ax, fr) {
      const { h } = P;
      line(torsoAt(P,0.92, fr, -8 * h), torsoAt(P,0.92, fr, 8 * h), DOOM.gold, 4 * h);             // gold collar
      for (const o of [-8, 8]) { const c = torsoAt(P,0.9, fr, o * h); circle(c.x, c.y, 2.6 * h, DOOM.gold); }
      const b = torsoAt(P,0.195, fr, 4 * h);
      ctx.fillStyle = DOOM.gold; ctx.fillRect(b.x - 2.4 * h, b.y - 2.4 * h, 4.8 * h, 4.8 * h);  // belt buckle
    },
    mask(P, ex, ey) {
      const { h, hr, p } = P;
      circle(-1.2 * h, -0.5 * h, hr + 3.2 * h, DOOM.green);                               // hood
      ctx.fillStyle = DOOM.greenD;
      ctx.beginPath(); ctx.arc(-1.2 * h, -0.5 * h, hr + 3.2 * h, Math.PI * 0.55, Math.PI * 1.25); ctx.lineTo(-1.2 * h, -0.5 * h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = DOOM.steel; ctx.strokeStyle = '#5d656e'; ctx.lineWidth = 1 * h;       // iron mask
      ctx.beginPath(); ctx.moveTo(-hr * 0.1, -hr * 0.75); ctx.lineTo(hr * 0.85, -hr * 0.72);
      ctx.quadraticCurveTo(hr * 1.2, -hr * 0.1, hr * 1.05, hr * 0.55);
      ctx.lineTo(hr * 0.55, hr * 1.0); ctx.lineTo(-hr * 0.05, hr * 0.95);
      ctx.quadraticCurveTo(-hr * 0.3, hr * 0.1, -hr * 0.1, -hr * 0.75);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8b939c'; ctx.fillRect(hr * 0.05, ey - 4.4 * h, hr * 0.85, 2 * h);
      ctx.fillStyle = '#2a2e35'; ctx.beginPath(); ctx.ellipse(ex + 0.4 * h, ey, 3.4 * h, 2.2 * h, -0.1, 0, Math.PI * 2); ctx.fill();
      if (p.mood === 'lose') {
        ctx.strokeStyle = '#c07a2c'; ctx.lineWidth = 1 * h;
        ctx.beginPath(); ctx.moveTo(ex - 0.8 * h, ey - 1.2 * h); ctx.lineTo(ex + 1.6 * h, ey + 1.2 * h);
        ctx.moveTo(ex + 1.6 * h, ey - 1.2 * h); ctx.lineTo(ex - 0.8 * h, ey + 1.2 * h); ctx.stroke();
      } else { circle(ex + 1 * h, ey, 1.4 * h, '#c07a2c'); circle(ex + 1.3 * h, ey, 0.7 * h, '#1f2433'); }
      ctx.strokeStyle = '#3c434b'; ctx.lineWidth = 1.5 * h;                                 // angry brow
      ctx.beginPath(); ctx.moveTo(ex - 3.6 * h, ey - (p.mood === 'win' ? 3.4 : 4.4) * h); ctx.lineTo(ex + 3.4 * h, ey - 2.4 * h); ctx.stroke();
      ctx.strokeStyle = '#5d656e'; ctx.lineWidth = 0.9 * h;
      ctx.beginPath(); ctx.moveTo(hr * 0.82, ey + 1.6 * h); ctx.lineTo(hr * 0.96, hr * 0.36); ctx.stroke();
      for (let i = 0; i < 3; i++) { const x = hr * 0.36 + i * 2.2 * h; ctx.beginPath(); ctx.moveTo(x, hr * 0.56); ctx.lineTo(x, hr * 0.8); ctx.stroke(); }
      for (const [x, y] of [[hr * 0.05, -hr * 0.55], [hr * 0.05, hr * 0.7], [hr * 0.9, hr * 0.74]]) circle(x, y, 0.8 * h, DOOM.steelD);
      ctx.strokeStyle = DOOM.greenD; ctx.lineWidth = 2.2 * h;                                // hood rim over the mask
      ctx.beginPath(); ctx.arc(-1.2 * h, -0.5 * h, hr + 2.2 * h, Math.PI * 1.45, Math.PI * 1.95); ctx.stroke();
    },
  },
  web: {
    torso: () => ({ shirt: WEB.red, back: WEB.blue, hip: WEB.blue, neck: WEB.redD }),
    arm: () => ({ upper: WEB.blue, lower: WEB.red, hand: WEB.red, sleeve: WEB.red, sleeveLen: 0.35 }),
    leg: () => ({ thigh: WEB.blue, shin: WEB.red, shorts: WEB.blue, shortsLen: 0.5, shoe: '#b81f24', sole: WEB.redD }),
    chest(P, ax, fr) {
      const { h } = P;
      ctx.strokeStyle = 'rgba(90,10,14,.55)'; ctx.lineWidth = 0.7 * h;                     // web lines
      for (const t of [0.35, 0.55, 0.75]) { const a = torsoAt(P,t, fr, -11 * h), b = torsoAt(P,t, fr, 11 * h); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      { const a = torsoAt(P,0.25, fr, 0), b = torsoAt(P,0.95, fr, 0); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      const c = torsoAt(P,0.66, fr, 3 * h);                                                     // spider emblem
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8 * h;
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const a = (-0.9 + i * 0.6) * s;
        ctx.beginPath(); ctx.moveTo(c.x, c.y);
        ctx.quadraticCurveTo(c.x + Math.sin(a) * 2.4 * h, c.y - Math.cos(a) * 1.2 * h, c.x + Math.sin(a) * 4 * h, c.y + (i - 1.5) * 1.6 * h);
        ctx.stroke();
      }
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 1.3 * h, 2.4 * h, Math.atan2(ax.y, ax.x) + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
    },
    mask(P, ex, ey) {
      const { h, hr, p } = P;
      circle(0, 0, hr + 0.4 * h, WEB.red);
      const cx = hr * 0.35, cy = -hr * 0.05;
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, hr + 0.4 * h, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = 'rgba(70,6,10,.55)'; ctx.lineWidth = 0.7 * h;
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * hr * 2.4, cy + Math.sin(a) * hr * 2.4); ctx.stroke(); }
      for (const r of [0.5, 0.95, 1.4]) {
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
          const a = i * Math.PI / 5, x = cx + Math.cos(a) * hr * r, y = cy + Math.sin(a) * hr * r;
          if (!i) ctx.moveTo(x, y);
          else ctx.quadraticCurveTo(cx + Math.cos(a - Math.PI / 10) * hr * r * 0.84, cy + Math.sin(a - Math.PI / 10) * hr * r * 0.84, x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath(); ctx.ellipse(-hr * 0.3, -hr * 0.6, hr * 0.35, hr * 0.13, -0.5, 0, Math.PI * 2); ctx.fill();
      // big white eyes that squint while pulling
      const sq = p.mood === 'pull' ? 0.5 : p.mood === 'strain' || p.mood === 'lose' ? 0.7 : 1;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.7 * h;
      ctx.save(); ctx.translate(ex + 0.2 * h, ey + 0.4 * h); ctx.rotate(-0.4);
      ctx.beginPath(); ctx.ellipse(0, 0, 4.6 * h, 3.3 * h * sq, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(hr * 0.98, ey + 0.4 * h); ctx.rotate(0.35);
      ctx.beginPath(); ctx.ellipse(0, 0, 1.8 * h, 2.9 * h * sq, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
  },
  straw: {
    torso: m => ({ shirt: STRAW.vest, back: shade(STRAW.vest, -0.25), hip: STRAW.shorts, neck: m.skinD }),
    arm: m => ({ upper: m.skin, lower: m.skin, hand: m.skin, sleeve: STRAW.vest, sleeveLen: 0.18 }),
    leg: m => ({ thigh: STRAW.shorts, shin: m.skin, shorts: STRAW.shorts, shortsLen: 1, knee: '#f1ede2', shoe: '#6b4423', sole: '#8a5a2b', sandal: true }),
    chest(P, ax, fr) {
      const { h, m } = P;
      line(torsoAt(P,0.3, fr, 6 * h), torsoAt(P,0.9, fr, 6 * h), m.skin, 9 * h);                  // open vest
      for (const t of [0.45, 0.6, 0.75]) { const c = torsoAt(P,t, fr, 1.4 * h); circle(c.x, c.y, 1 * h, '#e8c35a'); }
    },
  },
};
function strawHair(P) {
  const { h, hr } = P;
  ctx.fillStyle = '#15100d';
  ctx.beginPath(); ctx.arc(0, 0, hr + 0.8, Math.PI * 0.8, Math.PI * 1.95);
  // spiky fringe across the forehead, messy tufts at the back
  ctx.lineTo(hr * 0.7, -hr * 0.2); ctx.lineTo(hr * 0.45, -hr * 0.45); ctx.lineTo(hr * 0.25, -hr * 0.12);
  ctx.lineTo(hr * 0.02, -hr * 0.42); ctx.lineTo(-hr * 0.25, -hr * 0.05); ctx.lineTo(-hr * 0.5, -hr * 0.3);
  ctx.lineTo(-hr * 0.7, hr * 0.25); ctx.lineTo(-hr * 1.25, hr * 0.35); ctx.lineTo(-hr * 0.95, hr * 0.05);
  ctx.lineTo(-hr * 1.35, -hr * 0.1);
  ctx.closePath(); ctx.fill();
}

function drawStar(x, y, r, color) {
  ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// name tags over heads, staggered so neighbours do not overlap
function drawLabels(people) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const P of people) {
    const lab = P.m.label;
    if (!lab || P.p.fall > 0.3) continue;
    const x = P.hx + P.dir * P.hd.x, y = P.hd.y - P.hr - (P.m.cos === 'wizard' ? 34 : 20) - (P.i % 2) * 14;
    const text = lab.length > 9 ? lab.slice(0, 8) + '…' : lab;
    ctx.font = '600 14px Fredoka, "Segoe UI", sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,24,36,.85)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = P.m.me ? '#ffd23f' : '#ffffff'; ctx.fillText(text, x, y);
  }
}

/* ---------- per-frame effects tied to bodies ---------- */
const landed = {};
function bodyEffects(P, dt) {
  const footX = P.hx + P.dir * P.fF.x;
  const inMud = footX > 400 && footX < 560;
  const dragged = P.dir > 0 ? S.vel > 0.12 : S.vel < -0.12;
  if (S.mode !== 'over' && dragged && Math.random() < Math.min(1, Math.abs(S.vel) * 1.4) * dt * 26) {
    if (inMud) mudSplash(footX, GROUND + 6, 2);
    else dustAt(footX, GROUND, P.dir, 1);
  }
  const mine = P.dir > 0 ? S.pullL : S.pullR;
  if (S.mode !== 'over' && mine > 0.3 && Math.random() < mine * dt * 9) {
    dustAt(P.hx + P.dir * P.fB.x, GROUND, -P.dir, 2);
  }
  if ((P.p.mood === 'strain' || P.p.mood === 'pull') && Math.random() < dt * 1.6) {
    const hx = P.hx + P.dir * P.hd.x, hy = P.hd.y - 6;
    spawn({ type: 'sweat', x: hx, y: hy, vx: -P.dir * (40 + Math.random() * 40), vy: -70 - Math.random() * 40, g: 420, life: 0.6, size: 2.4 });
  }
  if (P.m.cos === 'legend' && S.mode !== 'over' && Math.random() < dt * 6) {
    const x = P.hx + P.dir * lerp(P.hip.x, P.sh.x, 0.5);
    spawn({ type: 'dot', x: x + (Math.random() - 0.5) * 40, y: P.hip.y - 10, vx: (Math.random() - 0.5) * 20, vy: -60 - Math.random() * 50,
      life: 0.7, size: 2, color: Math.random() < 0.5 ? '#ffd23f' : '#ff7a2f' });
  }
  const key = P.k + P.i;
  if (P.p.fall > 0.92 && !landed[key]) {
    landed[key] = true;
    const x = P.hx + P.dir * 60;
    if (x > 400 && x < 560) mudSplash(x, GROUND + 6, 16); else dustAt(x, GROUND, P.dir, 10);
    S.shake = Math.max(S.shake, 0.5);
  }
}
function resetLanded() { for (const k in landed) delete landed[k]; }

/* ---------- physics + render ---------- */
function stepScene(dt) {
  S.t += dt;
  const acc = (S.target - S.pos) * 42 - S.vel * 10;
  S.vel += acc * dt;
  S.pos += S.vel * dt;
  const d1 = Math.exp(-dt * 2.4), d2 = Math.exp(-dt * 3.2);
  S.pullL *= d1; S.pullR *= d1;
  S.flinchL *= d2; S.flinchR *= d2;
  S.shake *= Math.exp(-dt * 7);
  S.cam += (-S.pos * RANGE * 0.45 - S.cam) * (1 - Math.exp(-dt * 3));
  if (S.mode === 'over') S.winT += dt;
  updateParts(dt);
}

function renderScene(dt) {
  const sc = CW / VW;
  ctx.setTransform(DPR * sc, 0, 0, DPR * sc, 0, 0);
  // the arena keeps 960:520, but cover any rounding gap at the bottom
  ctx.fillStyle = '#4b8f32'; ctx.fillRect(0, 0, VW, CH / sc + 2);
  if (S.shake > 0.02) ctx.translate((Math.random() - 0.5) * S.shake * 10, (Math.random() - 0.5) * S.shake * 7);

  drawSky();
  drawHills();
  drawBunting();

  ctx.save();
  ctx.translate(S.cam, 0);
  drawField();
  drawPole(480 - RANGE, TEAM.L.shirt, -1);
  drawPole(480 + RANGE, TEAM.R.shirt, 1);
  drawMud();

  const mx = VW / 2 + S.pos * RANGE;
  const nL = Math.max(1, TEAM.L.members.length), nR = Math.max(1, TEAM.R.members.length);
  const n = Math.max(nL, nR), SP = n <= 3 ? 86 : n === 4 ? 76 : 68;
  const hxL = Array.from({ length: nL }, (_, i) => mx - FRONT_GAP - i * SP);
  const hxR = Array.from({ length: nR }, (_, i) => mx + FRONT_GAP + i * SP);
  RSPAN.a = hxL[nL - 1] - 13; RSPAN.b = hxR[nR - 1] + 13;
  RSPAN.sag = S.mode === 'menu' ? 8 : 4;
  RSPAN.drop = null;
  if (S.mode === 'over' && S.winner) {
    const k = easeOut(S.winT / 0.6);
    RSPAN.drop = S.winner < 0
      ? { x0: RSPAN.a, y0: ROPE_Y, yc: ROPE_Y + 8, x1: hxR[0] - 10, y1: lerp(ROPE_Y, GROUND - 2, k) }
      : { x0: hxL[0] + 10, y0: lerp(ROPE_Y, GROUND - 2, k), yc: ROPE_Y + 8, x1: RSPAN.b, y1: ROPE_Y };
  }

  const people = [];
  for (let i = n - 1; i >= 0; i--) {
    if (TEAM.L.members[i]) people.push(buildPerson('L', i, hxL[i]));
    if (TEAM.R.members[i]) people.push(buildPerson('R', i, hxR[i]));
  }
  for (const P of people) drawShadow(P);
  for (const P of people) drawBody(P);
  drawRope(hxL, hxR);
  drawRibbon(mx);
  for (const P of people) drawNearArm(P);
  for (const P of people) bodyEffects(P, dt);
  drawLabels(people);

  drawParts();
  ctx.restore();

  const vg = ctx.createRadialGradient(VW / 2, VH * 0.55, VH * 0.45, VW / 2, VH * 0.55, VW * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,30,20,.22)');
  ctx.fillStyle = vg; ctx.fillRect(-20, -20, VW + 40, VH + 40);
}

/* ---------- one character on another canvas (dashboard hero, shop cards) ---------- */
// pose: cheer | stand; frame: full (whole body) | bust (head and shoulders, for shop cards)
function renderAvatar(cv, cos, look, t, pose, frame) {
  const c2 = cv.getContext('2d');
  if (!c2) return;
  const saveT = S.t;
  ctx = c2; S.t = t || 0;
  try {
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (frame === 'bust') { const sc = Math.min(H / 86, W / 84); ctx.setTransform(sc, 0, 0, sc, W / 2 + 36 * sc, H * 0.5 - (GROUND - 122) * sc); }
    else { const sc = H / 196; ctx.setTransform(sc, 0, 0, sc, W / 2 + 22 * sc, H - 8 * sc - GROUND * sc); }
    const cheer = pose !== 'stand';
    const p = { lean: cheer ? 0.04 : 0.12, bob: Math.sin(S.t * 3) * 1.4, liftA: 0, liftB: 0, slide: 0,
      jump: cheer ? Math.abs(Math.sin(S.t * 3.2)) * 5 : 0, armsUp: cheer ? 1 : 0, fall: 0, mood: 'win', ropeY: ROPE_Y };
    const P = buildPerson('L', 0, 0, makeMember({ look, cos }, 0), p, AVATAR_TEAM);
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(P.hip.x, GROUND + 3, 34, 6, 0, 0, Math.PI * 2); ctx.fill();
    drawBody(P);
    drawNearArm(P);
  } finally {
    ctx = sceneCtx; S.t = saveT;
  }
}

setTeams([{ look: 0 }, { look: 1 }, { look: 2 }], [{ look: 3 }, { look: 4 }, { look: 5 }]);
