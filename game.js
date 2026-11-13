(() => {
'use strict';

const BASE_W = 360, MIN_H = 600, ROAD_HALF = 150, K = 1 / 220;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const Ads = window.Ads || { init() {}, maybeInterstitial(cb) { cb(); }, showRewarded(ok) { ok(); } };

// ---------- 画布自适应 ----------
let scale = 1, dpr = 1, VW = 360, VH = 640, CX = 180, HORIZON = 175, PY = 505;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const vw = window.innerWidth, vh = window.innerHeight;
  scale = Math.min(vw / BASE_W, vh / MIN_H);
  VW = vw / scale; VH = vh / scale; CX = VW / 2;
  HORIZON = Math.round(Math.max(150, Math.min(230, VH * 0.27)));
  PY = Math.max(HORIZON + 260, VH - 130);
  canvas.width = Math.floor(vw * dpr);
  canvas.height = Math.floor(vh * dpr);
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
}
window.addEventListener('resize', resize);
resize();

// ---------- 工具 ----------
const proj = z => 1 / (1 + z * K);
const sy = t => HORIZON + (PY - HORIZON) * t;
const sx = (x, t) => CX + x * ROAD_HALF * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const TAU = Math.PI * 2;

function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

// ---------- 音效与震动 ----------
let actx = null, muted = store.get('muted', false);
function initAudio() {
  if (actx) return;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } catch (e) {}
}
function tone(f, d, type, vol, slide) {
  if (!actx || muted) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + d + 0.02);
  } catch (e) {}
}
const sfx = {
  good() { tone(520, .09, 'triangle', .18); setTimeout(() => tone(780, .12, 'triangle', .18), 70); },
  bad() { tone(220, .2, 'sawtooth', .14, -120); },
  hit() { tone(140, .15, 'square', .12, -60); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .18, 'triangle', .2), i * 110)); },
  lose() { tone(300, .5, 'sawtooth', .16, -220); },
  click() { tone(600, .05, 'square', .08); }
};
const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

// ---------- 游戏状态 ----------
let state = 'menu';            // menu | play | ending | win | over
let level = store.get('level', 1);
let bestLevel = store.get('best', 1);
let count = 10, startCount = 10, px = 0, targetX = 0;
let speed = 0, speedBase = 240, dist = 0, time = 0, shake = 0, flash = 0;
let rows = [], bossRow = null, totalZ = 1;
let particles = [], floaters = [];
let endTimer = 0, outcome = null, endEntity = null, winCount = 0;
let revived = false, levelsSinceAd = 0;
let buttons = [], dragging = false;

// ---------- 关卡生成 ----------
const isGood = g => g.op === '+' || g.op === '×';
const label = g => (g.op === '-' ? '−' : g.op) + g.v;
function applyOp(n, g) {
  switch (g.op) {
    case '+': return n + g.v;
    case '-': return n - g.v;
    case '×': return n * g.v;
    default: return Math.floor(n / g.v);
  }
}
function makeGate(best, L) {
  const plus = () => ({ op: '+', v: Math.max(5, Math.round(best * rand(.15, .6) / 5) * 5) });
  const mul = () => ({ op: '×', v: (L >= 3 && Math.random() < .25) ? 3 : 2 });
  const minus = () => ({ op: '-', v: Math.max(3, Math.round(best * rand(.15, .45))) });
  const div = () => ({ op: '÷', v: (L >= 4 && Math.random() < .2) ? 3 : 2 });
  const good = Math.random() < .55 ? plus() : mul();
  let other;
  if (Math.random() < .25) other = Math.random() < .5 ? plus() : mul();
  else other = Math.random() < .6 ? minus() : div();
  return Math.random() < .5 ? { l: good, r: other } : { l: other, r: good };
}
function genLevel(L) {
  rows = [];
  let z = 650, best = startCount;
  const n = Math.min(5 + L, 13);
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 3 === 2) {
      const en = Math.max(3, Math.round(best * rand(.12, .3)));
      rows.push({ type: 'enemy', z, x: (Math.random() < .5 ? -1 : 1) * rand(.35, .6), n: en, done: false });
      z += 300;
    }
    const g = makeGate(best, L);
    rows.push({ type: 'gate', z, l: g.l, r: g.r, done: false });
    best = Math.max(1, Math.max(applyOp(best, g.l), applyOp(best, g.r)));
    z += 330;
  }
  const ratio = Math.min(.85, .42 + .03 * L);
  const bossN = Math.max(6, Math.floor(best * rand(ratio - .1, ratio + .05)));
  bossRow = { type: 'boss', z: z + 60, n: bossN, done: false };
  rows.push(bossRow);
  totalZ = bossRow.z;
}
function startLevel() {
  startCount = 10 + Math.min(level - 1, 10) * 2;
  count = startCount; px = 0; targetX = 0; dist = 0; speed = 0;
  speedBase = Math.min(300, 230 + level * 8);
  revived = false; particles = []; floaters = []; shake = 0; flash = 0;
  endEntity = null; outcome = null;
  genLevel(level);
  state = 'play';
}

// ---------- 逻辑 ----------
const CONF = ['#ffd166', '#59c2ff', '#ff5a66', '#7bed9f', '#c792ff'];
function burst(color, n) {
  const x = sx(px, 1), y = PY - 20;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(60, 280);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140, life: rand(.5, 1), max: 1,
      color: color === 'multi' ? pick(CONF) : color, size: rand(2, 4.5) });
  }
}
function popAtPlayer(text, color) {
  floaters.push({ x: sx(px, 1), y: PY - 70, text, color, life: .9, max: .9 });
}
function lose(r) {
  state = 'ending'; outcome = 'lose'; endEntity = r; endTimer = .8;
  shake = 14; sfx.lose(); buzz(80); burst('#ff5a66', 60);
}
function win(r) {
  state = 'ending'; outcome = 'win'; endEntity = r; endTimer = 1;
  sfx.win(); buzz(40); burst('multi', 90); shake = 6;
}
function resolve(r) {
  r.done = true;
  if (r.type === 'gate') {
    const g = px < 0 ? r.l : r.r;
    const before = count;
    count = applyOp(count, g);
    const good = count >= before;
    popAtPlayer(label(g), good ? '#7fd1ff' : '#ff7b86');
    burst(good ? '#59c2ff' : '#ff5a66', 26);
    if (good) sfx.good(); else sfx.bad();
    buzz(good ? 12 : 30);
    shake = good ? 3 : 8;
    if (count <= 0) { count = 0; lose(r); }
  } else if (r.type === 'enemy') {
    if (Math.abs(px - r.x) < .42) {
      count -= r.n;
      popAtPlayer('−' + fmt(r.n), '#ff7b86');
      burst('#ff5a66', 34); sfx.hit(); buzz(40); shake = 10; flash = .5;
      if (count <= 0) { count = 0; lose(r); }
    }
  } else {
    if (count > r.n) { count -= r.n; winCount = count; win(r); }
    else { count = 0; lose(r); }
  }
}
function finishEnding() {
  levelsSinceAd++;
  if (outcome === 'win') {
    bestLevel = Math.max(bestLevel, level + 1);
    store.set('best', bestLevel);
    store.set('level', level + 1);
    state = 'win';
  } else {
    state = 'over';
  }
}
function proceed() {
  if (levelsSinceAd >= 2) { levelsSinceAd = 0; Ads.maybeInterstitial(startLevel); }
  else startLevel();
}
function nextLevel() { level++; proceed(); }
function retry() { proceed(); }
function revive() {
  Ads.showRewarded(() => {
    revived = true;
    if (endEntity && endEntity.type === 'boss') {
      count = endEntity.n + 12; endEntity.done = false; endEntity.z = 0;
    } else {
      count = Math.max(20, startCount);
    }
    speed = speedBase * .6; flash = 0; shake = 0; outcome = null;
    state = 'play';
  }, () => { floaters.push({ x: CX, y: VH / 2, text: '广告暂时不可用', color: '#fff', life: 1.2, max: 1.2 }); });
}

function update(dt) {
  time += dt;
  shake *= Math.pow(.001, dt);
  flash = Math.max(0, flash - dt * 3);
  if (state === 'play') {
    speed += (speedBase - speed) * Math.min(1, dt * 3);
    const d = speed * dt;
    dist += d;
    px += (targetX - px) * Math.min(1, dt * 14);
    for (const r of rows) {
      r.z -= d;
      if (!r.done && r.z <= 0) { resolve(r); if (state !== 'play') break; }
    }
    rows = rows.filter(r => r.z > -70);
  } else if (state === 'ending') {
    speed *= Math.pow(.02, dt);
    dist += speed * dt;
    endTimer -= dt;
    if (endTimer <= 0) finishEnding();
  } else if (state === 'menu') {
    dist += 60 * dt;
  }
  for (const p of particles) { p.life -= dt; p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) { f.life -= dt; f.y -= 50 * dt; }
  floaters = floaters.filter(f => f.life > 0);
}

// ---------- 绘制：背景 ----------
const skyline = []; let skyW = 520;
{ let x = 0; while (x < 520) { const w = 18 + Math.random() * 28; skyline.push({ x, w, h: 18 + Math.random() * 60 }); x += w + 2 + Math.random() * 6; } skyW = x; }
const clouds = [];
for (let i = 0; i < 6; i++) clouds.push({ x: Math.random() * 480, f: rand(.12, .55), r: rand(14, 26), s: rand(3, 9) });

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function cloud(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU); ctx.arc(x + r * .9, y + r * .2, r * .8, 0, TAU); ctx.arc(x - r * .9, y + r * .25, r * .7, 0, TAU);
  ctx.fill();
}
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#3b6fe0'); g.addColorStop(1, '#bfe7ff');
  ctx.fillStyle = g; ctx.fillRect(-10, -10, VW + 20, HORIZON + 10);
  const sxn = VW * .72, syn = HORIZON - 38;
  const rg = ctx.createRadialGradient(sxn, syn, 4, sxn, syn, 70);
  rg.addColorStop(0, 'rgba(255,240,180,1)'); rg.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = rg; ctx.fillRect(sxn - 80, syn - 80, 160, 160);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  const cw = VW + 120;
  for (const c of clouds) {
    const x = (((c.x - time * c.s - dist * .01) % cw) + cw) % cw - 60;
    cloud(x, c.f * HORIZON, c.r);
  }
  ctx.fillStyle = '#8db4e6';
  const off = (dist * .03) % skyW;
  for (let k = -1; k <= 2; k++) for (const b of skyline) {
    const x = b.x - off + k * skyW;
    if (x > -60 && x < VW + 10) ctx.fillRect(x, HORIZON - b.h, b.w, b.h);
  }
  const gg = ctx.createLinearGradient(0, HORIZON, 0, VH);
  gg.addColorStop(0, '#58d68d'); gg.addColorStop(1, '#1e8449');
  ctx.fillStyle = gg; ctx.fillRect(-10, HORIZON, VW + 20, VH - HORIZON + 10);
}
function drawRoad() {
  const tb = (VH + 20 - HORIZON) / (PY - HORIZON);
  ctx.beginPath();
  ctx.moveTo(CX - 2, HORIZON); ctx.lineTo(CX + 2, HORIZON);
  ctx.lineTo(CX + ROAD_HALF * tb, VH + 20); ctx.lineTo(CX - ROAD_HALF * tb, VH + 20);
  ctx.closePath();
  const rg = ctx.createLinearGradient(0, HORIZON, 0, VH);
  rg.addColorStop(0, '#5a5f85'); rg.addColorStop(1, '#343a5c');
  ctx.fillStyle = rg; ctx.fill();
  ctx.strokeStyle = '#e8ecff'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CX - 2, HORIZON); ctx.lineTo(CX - ROAD_HALF * tb, VH + 20);
  ctx.moveTo(CX + 2, HORIZON); ctx.lineTo(CX + ROAD_HALF * tb, VH + 20);
  ctx.stroke();
  const period = 200, o = dist % period;
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let z = -o; z < 2200; z += period) {
    const z1 = Math.max(-60, z), z2 = z + 90;
    if (z2 <= -60) continue;
    const t1 = proj(z1), t2 = proj(z2), y1 = sy(t1), y2 = sy(t2);
    ctx.beginPath();
    ctx.moveTo(CX - 3 * t1, y1); ctx.lineTo(CX + 3 * t1, y1);
    ctx.lineTo(CX + 3 * t2, y2); ctx.lineTo(CX - 3 * t2, y2);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#ffd166';
  const po = dist % 150;
  for (let z = -po; z < 1800; z += 150) {
    if (z < -50) continue;
    const t = proj(z), y = sy(t);
    for (const s of [-1, 1]) { const x = sx(s * 1.1, t); ctx.fillRect(x - 3 * t, y - 28 * t, 6 * t, 28 * t); }
  }
}

// ---------- 绘制：人群、门、敌人、Boss ----------
function drawCrowd(cx, cy, n, s, color, light, seed) {
  const m = Math.min(n, 70), pts = [];
  for (let i = 0; i < m; i++) {
    const a = i * 2.39996, rad = Math.sqrt(i) * 5.4 * s;
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad * .55 });
  }
  pts.sort((a, b) => a.y - b.y);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], bob = Math.sin(time * 12 + i * 1.7 + seed) * 1.6 * s;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 5 * s, 4.6 * s, 2 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + bob, 4.4 * s, 5.2 * s, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.arc(p.x, p.y - 5.6 * s + bob, 3.2 * s, 0, TAU); ctx.fill();
  }
}
function pill(text, x, y, s, bg, fg) {
  const fs = Math.max(8, 18 * s), w = text.length * fs * .62 + 16 * s, h = fs + 8 * s;
  rr(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.font = '800 ' + fs + 'px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}
function drawGate(r) {
  const t = proj(r.z);
  if (t < .04) return;
  const y = sy(t), h = 120 * t;
  ctx.globalAlpha = clamp((1500 - r.z) / 400, 0, 1);
  for (const side of [-1, 1]) {
    const g = side < 0 ? r.l : r.r;
    const xa = sx(side < 0 ? -1 : .03, t), xb = sx(side < 0 ? -.03 : 1, t);
    const good = isGood(g);
    const gr = ctx.createLinearGradient(0, y - h, 0, y);
    gr.addColorStop(0, good ? 'rgba(160,215,255,.25)' : 'rgba(255,160,170,.25)');
    gr.addColorStop(1, good ? 'rgba(70,160,255,.62)' : 'rgba(255,75,90,.62)');
    ctx.fillStyle = gr; ctx.fillRect(xa, y - h, xb - xa, h);
    const near = r.z < 350 && ((px < 0) === (side < 0));
    ctx.strokeStyle = near ? '#ffffff' : (good ? '#bfe3ff' : '#ffc3c9');
    ctx.lineWidth = Math.max(1, (near ? 6 : 3) * t);
    ctx.strokeRect(xa, y - h, xb - xa, h);
    const fs = Math.max(8, 40 * t), cx = (xa + xb) / 2, cy = y - h * .5;
    ctx.font = '900 ' + fs + 'px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, 6 * t); ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.strokeText(label(g), cx, cy);
    ctx.fillStyle = '#fff'; ctx.fillText(label(g), cx, cy);
  }
  ctx.fillStyle = '#f5f5ff';
  ctx.fillRect(sx(0, t) - 3 * t, y - h - 8 * t, 6 * t, h + 8 * t);
  ctx.globalAlpha = 1;
}
function drawEnemy(r) {
  const t = proj(r.z);
  if (t < .04) return;
  ctx.globalAlpha = clamp((1500 - r.z) / 400, 0, 1);
  const x = sx(r.x, t), y = sy(t);
  drawCrowd(x, y, r.n, t * .95, '#e8414f', '#ff9aa2', r.z * .01);
  pill(fmt(r.n), x, y - (20 + Math.sqrt(Math.min(r.n, 70)) * 3.5) * t, Math.max(.35, t), 'rgba(160,20,35,.9)', '#fff');
  ctx.globalAlpha = 1;
}
function drawBoss(r) {
  if (r.done && outcome === 'win' && state !== 'ending') return;
  const t = proj(r.z);
  if (t < .04) return;
  ctx.globalAlpha = clamp((1700 - r.z) / 400, 0, 1);
  if (state === 'ending' && outcome === 'win') ctx.globalAlpha = clamp(endTimer / .9, 0, 1);
  const cx = CX, y = sy(t), R = 88 * t, by = y - R;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(cx, y, R * 1.05, R * .22, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(cx - R * .3, by - R * .3, R * .1, cx, by, R);
  g.addColorStop(0, '#ff8a8a'); g.addColorStop(1, '#c1121f');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, by, R, 0, TAU); ctx.fill();
  ctx.fillStyle = '#7a0b14';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * R * .35, by - R * .85); ctx.lineTo(cx + s * R * .8, by - R * 1.45); ctx.lineTo(cx + s * R * .72, by - R * .6);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#fff';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * R * .35, by - R * .15, R * .2, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#220';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * R * .32, by - R * .12, R * .09, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = '#220'; ctx.lineWidth = Math.max(2, R * .07);
  ctx.beginPath(); ctx.arc(cx, by + R * .45, R * .3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  pill(fmt(r.n), cx, by - R * 1.7, Math.max(.4, t * 1.5), 'rgba(90,5,15,.92)', '#fff');
  ctx.globalAlpha = 1;
}
function drawPlayer() {
  if (count <= 0) return;
  const x = sx(px, 1);
  drawCrowd(x, PY, count, 1, '#2f7dff', '#a9ceff', 0);
  pill(fmt(count), x, PY - 34 - Math.sqrt(Math.min(count, 70)) * 3.5, 1, 'rgba(20,50,140,.92)', '#fff');
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 28px system-ui,sans-serif';
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life / f.max * 1.5, 0, 1);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- 绘制：界面 ----------
function button(text, x, y, w, h, action, c1, c2, pulse) {
  buttons.push({ x, y, w, h, action });
  ctx.save();
  if (pulse) {
    const p = 1 + Math.sin(time * 5) * .025;
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(p, p); ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  rr(x, y + 4, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  rr(x, y, w, h, h / 2); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '800 20px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}
function panel(title, sub, h) {
  ctx.fillStyle = 'rgba(6,10,28,.6)'; ctx.fillRect(0, 0, VW, VH);
  const w = 290, x = CX - w / 2, y = VH / 2 - h / 2;
  rr(x, y, w, h, 24); ctx.fillStyle = '#1e2552'; ctx.fill();
  ctx.strokeStyle = 'rgba(160,190,255,.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = '900 30px system-ui,sans-serif'; ctx.fillText(title, CX, y + 46);
  ctx.fillStyle = '#b9c6ff'; ctx.font = '600 16px system-ui,sans-serif'; ctx.fillText(sub, CX, y + 84);
  return y;
}
function drawHUD() {
  rr(12, 12, 86, 32, 16); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '800 16px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('第 ' + level + ' 关', 55, 29);
  if (bossRow) {
    const p = clamp(1 - bossRow.z / totalZ, 0, 1), bx = 110, bw = VW - 110 - 44;
    rr(bx, 20, bw, 14, 7); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
    if (p > .02) { rr(bx, 20, Math.max(14, bw * p), 14, 7); ctx.fillStyle = '#7bed9f'; ctx.fill(); }
    ctx.font = '20px system-ui,sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('👹', VW - 24, 28);
  }
}
function drawMenu() {
  ctx.fillStyle = 'rgba(6,10,28,.35)'; ctx.fillRect(0, 0, VW, VH);
  const ty = VH * .24;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 46px system-ui,sans-serif';
  ctx.lineWidth = 8; ctx.strokeStyle = '#1b2a6b'; ctx.strokeText('数字大冲关', CX, ty);
  const g = ctx.createLinearGradient(0, ty - 26, 0, ty + 26);
  g.addColorStop(0, '#fff6b0'); g.addColorStop(1, '#ffb347');
  ctx.fillStyle = g; ctx.fillText('数字大冲关', CX, ty);
  ctx.font = '700 16px system-ui,sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText('拖动手指选对门，人数越多越强！', CX, ty + 48);
  ctx.fillStyle = '#d9e4ff';
  ctx.fillText('最高到达：第 ' + bestLevel + ' 关', CX, ty + 76);
  button('开始 第 ' + level + ' 关', CX - 100, VH * .6, 200, 56, startLevel, '#ffd35a', '#ff9f1c', true);
  button(muted ? '🔇 声音：关' : '🔊 声音：开', CX - 70, VH * .6 + 76, 140, 40,
    () => { muted = !muted; store.set('muted', muted); }, '#6d7bd6', '#4a56b0');
}
function drawOver() {
  const canRevive = !revived && endEntity;
  const y = panel('挑战失败', '差一点点，再来一次！', 270);
  let by = y + 120;
  if (canRevive) { button('📺 看广告复活', CX - 110, by, 220, 52, revive, '#ffd35a', '#ff9f1c', true); by += 70; }
  else by += 20;
  button('再试一次', CX - 110, by, 220, 52, retry, '#4fc3f7', '#1e88e5');
}
function drawWin() {
  const y = panel('通关！', '剩余 ' + fmt(winCount) + ' 人', 240);
  button('下一关', CX - 110, y + 140, 220, 56, nextLevel, '#7bed9f', '#2ecc71', true);
}

function draw() {
  buttons = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0d1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.save();
  ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
  drawBackground(); drawRoad();
  const list = rows.slice().sort((a, b) => b.z - a.z);
  for (const r of list) {
    if (r.type === 'gate') drawGate(r); else if (r.type === 'enemy') drawEnemy(r); else drawBoss(r);
  }
  if (state !== 'menu') drawPlayer();
  drawParticles(); drawFloaters();
  ctx.restore();
  if (flash > 0) { ctx.fillStyle = 'rgba(255,60,70,' + (flash * .35) + ')'; ctx.fillRect(0, 0, VW, VH); }
  if (state === 'menu') drawMenu();
  else { drawHUD(); if (state === 'over') drawOver(); else if (state === 'win') drawWin(); }
}

// ---------- 输入 ----------
function toGame(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}
function setTarget(gx) { targetX = clamp((gx - CX) / ROAD_HALF, -.88, .88); }
canvas.addEventListener('pointerdown', e => {
  initAudio();
  if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (err) {} }
  const p = toGame(e);
  if (state === 'play' || state === 'ending') { dragging = true; setTarget(p.x); return; }
  for (const b of buttons) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { sfx.click(); b.action(); break; }
  }
});
canvas.addEventListener('pointermove', e => { if (dragging && state === 'play') setTarget(toGame(e).x); });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a') targetX = -.6;
  else if (e.key === 'ArrowRight' || e.key === 'd') targetX = .6;
  else if (e.key === 'ArrowDown') targetX = 0;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- 主循环 ----------
let last = 0;
function frame(ts) {
  const dt = Math.min(.05, (ts - last) / 1000 || .016);
  last = ts;
  update(dt); draw();
  requestAnimationFrame(frame);
}
try { Ads.init(); } catch (e) {}
requestAnimationFrame(frame);
})();
