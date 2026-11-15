(() => {
'use strict';

const BASE_W = 360, MIN_H = 600, ROAD_HALF = 150, K = 1 / 220;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const Ads = window.Ads || { init() {}, maybeInterstitial(cb) { cb(); }, showRewarded(ok) { ok(); } };
const stats = { shots: 0, hits: 0, kills: 0, mlg: 0, pickups: 0, wins: 0, loses: 0, memes: 0, revives: 0, bonus: 0 };
window.__stats = stats;
function dbg(e) { if (window.__errs) window.__errs.push(String((e && e.stack) || e)); }

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
const hsl = (h, a) => 'hsla(' + (((h % 360) + 360) % 360).toFixed(0) + ',100%,58%,' + (a == null ? 1 : a) + ')';
const MEME_FONT = 'Impact, Haettenschweiler, "Arial Black", sans-serif';

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

// ---------- 武器 ----------
const WEAPONS = {
  pistol:  { id: 'pistol',  name: '手枪',   en: 'PISTOL',  emoji: '🔫', rate: .30, bullets: 1, dmg: 2.2, speed: 1100, color: '#ffe066', size: 3.2, len: 34,  scale: true, jitter: .05, snd: 'pistol',  gun: 8 },
  shotgun: { id: 'shotgun', name: '霰弹枪', en: 'SHOTGUN', emoji: '💥', rate: .75, bullets: 5, fan: .34, dmg: 2.4, speed: 950, range: 760, color: '#ffb347', size: 3.4, len: 22, snd: 'shotgun', gun: 10 },
  mini:    { id: 'mini',    name: '机关枪', en: 'MINIGUN', emoji: '⚙️', rate: .075, bullets: 1, dmg: 1.1, speed: 1250, color: '#9be564', size: 2.6, len: 46, jitter: .18, scale: true, snd: 'mini', gun: 12 },
  laser:   { id: 'laser',   name: '激光炮', en: 'LASER',   emoji: '⚡', rate: .5, bullets: 1, dmg: 6, speed: 1900, color: '#6df7ff', size: 4, len: 150, pierce: true, beam: true, snd: 'laser', gun: 11 },
  rocket:  { id: 'rocket',  name: '火箭筒', en: 'BAZOOKA', emoji: '🚀', rate: .95, bullets: 1, dmg: 16, speed: 720, color: '#ff6b6b', size: 7, len: 40, splash: true, snd: 'rocket', gun: 13 },
  rainbow: { id: 'rainbow', name: '彩虹炮', en: 'RAINBOW', emoji: '🌈', rate: .12, bullets: 2, dmg: 3, speed: 1300, color: '#ff66cc', size: 4, len: 60, jitter: .2, rainbow: true, snd: 'rainbow', gun: 12 }
};
const wColor = (w, off) => w.rainbow ? hsl(time * 300 + (off || 0)) : w.color;

// ---------- 游戏状态 ----------
let state = 'menu';            // menu | play | ending | win | over
let level = store.get('level', 1);
let bestLevel = store.get('best', 1);
let count = 10, startCount = 10, px = 0, targetX = 0;
let speed = 0, speedBase = 240, dist = 0, time = 0, shake = 0, flash = 0, pulse = 0;
let rows = [], bossRow = null, totalZ = 1;
let particles = [], floaters = [], bullets = [], marks = [], booms = [], sprites = [], banners = [];
let endTimer = 0, endDur = 1, outcome = null, endEntity = null, winCount = 0;
let revived = false, levelsSinceAd = 0;
let buttons = [], dragging = false;
let weapon = WEAPONS.pistol, fireT = 0, bonusWeapon = null;
let streak = 0, streakT = 0, mlgT = 0, sprT = 0, lastMemeT = -9, beatT = 0, beatIdx = 0;

// ---------- 音效（全部程序合成，无需音频文件） ----------
let actx = null, master = null, noiseBuf = null, muted = store.get('muted', false);
function initAudio() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain(); master.gain.value = .9;
    master.connect(actx.destination);
    const len = Math.floor(actx.sampleRate), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
  } catch (e) { dbg(e); }
}
function tone(f, d, type, vol, slide, delay) {
  if (!actx || muted) return;
  try {
    const t = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || .15, t + Math.min(.012, d / 4));
    g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + .03);
  } catch (e) { dbg(e); }
}
function noise(d, vol, cutoff, ftype, delay) {
  if (!actx || muted || !noiseBuf) return;
  try {
    const t = actx.currentTime + (delay || 0);
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noiseBuf; f.type = ftype || 'lowpass'; f.frequency.value = cutoff || 1000;
    g.gain.setValueAtTime(vol || .2, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + d + .03);
  } catch (e) { dbg(e); }
}
const lastT = {};
function gate(name, gap) {
  if (time - (lastT[name] == null ? -99 : lastT[name]) < gap) return false;
  lastT[name] = time; return true;
}
const sfx = {
  click() { tone(600, .05, 'square', .08); },
  good() { tone(520, .09, 'triangle', .18); tone(780, .12, 'triangle', .18, 0, .07); },
  bad() { tone(220, .2, 'sawtooth', .14, -120); },
  hit() { noise(.12, .25, 500); tone(140, .15, 'square', .12, -60); },
  pistol() { if (!gate('gun', .05)) return; noise(.05, .12, 3000, 'highpass'); tone(900, .07, 'square', .07, -650); },
  shotgun() { noise(.18, .25, 1200); tone(140, .18, 'sawtooth', .14, -90); },
  mini() { if (!gate('mini', .06)) return; tone(520, .04, 'square', .04, -260); },
  laser() { tone(1600, .16, 'sawtooth', .07, -1300); },
  rocket() { noise(.25, .2, 600); tone(220, .3, 'sawtooth', .1, -160); },
  rainbow() { if (!gate('rb', .05)) return; tone(900, .06, 'triangle', .07, 500); },
  boom() { noise(.5, .5, 500); tone(90, .5, 'sine', .5, -60); },
  hitmark() { if (!gate('hm', .045)) return; tone(1900, .05, 'square', .06, -900); noise(.03, .08, 5000, 'highpass'); },
  kill() { tone(700, .08, 'triangle', .12); tone(1050, .12, 'triangle', .12, 0, .06); },
  airhorn() {
    if (!gate('horn', .4)) return;
    for (const [t0, d] of [[0, .13], [.17, .13], [.34, .6]])
      for (const f of [466, 587, 698, 932]) tone(f, d, 'sawtooth', .045, 0, t0);
  },
  vineBoom() { tone(70, .6, 'sine', .6, -40); noise(.25, .3, 300); },
  trombone() {
    [[233, .32], [220, .32], [208, .32]].forEach(([f, d], i) => tone(f, d, 'sawtooth', .1, 0, i * .34));
    tone(196, .9, 'sawtooth', .1, -14, 1.02);
  },
  oof() { tone(300, .16, 'square', .12, -170); tone(210, .2, 'triangle', .12, -100, .02); },
  pickup() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .1, 'triangle', .14, 0, i * .05)); },
  stonks() { [392, 494, 587, 784].forEach((f, i) => tone(f, .12, 'square', .07, 0, i * .07)); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, 'triangle', .2, 0, i * .11)); },
  kick(v) { tone(150, .13, 'sine', v, -110); },
  hat(v) { noise(.03, v, 7000, 'highpass'); }
};
const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

// ---------- 迷因 / MLG ----------
const MLG_WORDS = ['MLG PRO', '360 NO SCOPE', 'GET REKT', 'SNIPED!', 'WOW', 'OMG!!!'];
const HIT_WORDS = ['WOW', 'NICE', 'REKT', 'NOOB', 'OMG', 'NO SCOPE'];
function meme(text, color, big) {
  if (!big && time - lastMemeT < .35) return;
  lastMemeT = time; stats.memes++;
  banners.push({ text, color, t: 0, dur: big ? 1.5 : 1.0, rot: (Math.random() - .5) * .25, big: !!big });
  if (banners.length > 3) banners.shift();
}
function startMLG(msg) {
  const fresh = mlgT <= 0;
  mlgT = 8; stats.mlg++;
  sfx.airhorn(); sfx.vineBoom();
  if (msg !== null) meme(msg || pick(MLG_WORDS), 'rainbow', true);
  shake = Math.max(shake, 9); pulse = 1;
  if (fresh) for (let i = 0; i < 8; i++) spawnSprite();
}
function spawnSprite() {
  if (sprites.length > 26) return;
  const left = Math.random() < .5;
  sprites.push({
    x: left ? -20 : VW + 20, y: rand(30, HORIZON + 80),
    vx: (left ? 1 : -1) * rand(70, 170), vy: rand(-20, 40),
    rot: rand(0, TAU), vr: rand(-5, 5), size: rand(10, 18),
    life: 0, max: rand(2.4, 4), type: pick(['tri', 'tri', 'eye', 'shades'])
  });
}

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
function pickWeaponId(exclude) {
  const pool = ['shotgun', 'mini', 'laser', 'rocket'];
  if (level >= 2 && Math.random() < .25) pool.push('rainbow');
  let id, tries = 0;
  do { id = pick(pool); tries++; } while (id === exclude && tries < 6);
  return id;
}
function genLevel(L) {
  rows = [];
  let z = 650, best = startCount, lastPick = null;
  const n = Math.min(5 + L, 13);
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 2 === 1) {
      const en = Math.max(4, Math.round(best * rand(.1, .24)));
      const side = Math.random() < .5 ? -1 : 1;
      rows.push({ type: 'enemy', z, x: side * rand(.35, .6), n: en, max: en, done: false, flashT: 0 });
      if (L >= 3 && Math.random() < .6) {
        rows.push({ type: 'enemy', z: z + 10, x: -side * rand(.35, .6), n: en, max: en, done: false, flashT: 0 });
      }
      z += 300;
    }
    const g = makeGate(best, L);
    rows.push({ type: 'gate', z, l: g.l, r: g.r, done: false });
    best = Math.max(1, Math.max(applyOp(best, g.l), applyOp(best, g.r)));
    if (i === 0 || (i % 2 === 0 && Math.random() < .7)) {
      lastPick = pickWeaponId(lastPick);
      rows.push({ type: 'weapon', z: z + 160, x: (Math.random() < .5 ? -1 : 1) * rand(.35, .6), wid: lastPick, done: false });
    }
    z += 330;
  }
  const ratio = Math.min(.95, .5 + .035 * L);
  const bossN = Math.max(8, Math.floor(best * rand(ratio - .1, ratio + .05)));
  bossRow = { type: 'boss', z: z + 60, n: bossN, max: bossN, done: false, flashT: 0 };
  rows.push(bossRow);
  totalZ = bossRow.z;
}
function startLevel() {
  startCount = 10 + Math.min(level - 1, 10) * 2;
  count = startCount; px = 0; targetX = 0; dist = 0; speed = 0;
  speedBase = Math.min(300, 230 + level * 8);
  revived = false; particles = []; floaters = []; bullets = []; marks = []; booms = []; sprites = []; banners = [];
  shake = 0; flash = 0; pulse = 0; streak = 0; streakT = 0; mlgT = 0; fireT = .3;
  endEntity = null; outcome = null;
  weapon = bonusWeapon ? WEAPONS[bonusWeapon] : WEAPONS.pistol;
  bonusWeapon = null;
  genLevel(level);
  state = 'play';
  meme("LET'S GO!", '#ffffff', false);
}

// ---------- 逻辑 ----------
const CONF = ['#ffd166', '#59c2ff', '#ff5a66', '#7bed9f', '#c792ff'];
function burstAt(x, y, color, n, power) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(60, 280) * (power || 1);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140, life: rand(.5, 1), max: 1,
      color: color === 'multi' ? pick(CONF) : color, size: rand(2, 4.5) });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}
const burst = (color, n) => burstAt(sx(px, 1), PY - 20, color, n);
function popAtPlayer(text, color) {
  floaters.push({ x: sx(px, 1), y: PY - 70, text, color, life: .9, max: .9 });
}
function addBoom(x, y, r, dur) { booms.push({ x, y, r, t: 0, dur: dur || .5 }); }
function rowScreen(r) { const t = proj(Math.max(0, r.z)); return { x: sx(r.x == null ? 0 : r.x, t), y: sy(t), t }; }

function lose(r) {
  state = 'ending'; outcome = 'lose'; endEntity = r; endTimer = endDur = .9;
  shake = 14; stats.loses++;
  sfx.trombone(); buzz(80); burst('#ff5a66', 60);
  meme('BRUH', '#ff6b6b', true);
}
function win(r) {
  r.done = true; r.n = Math.max(0, r.n);
  state = 'ending'; outcome = 'win'; endEntity = r; endTimer = endDur = 1.9; winCount = count;
  stats.wins++;
  const s = rowScreen(r);
  addBoom(s.x, s.y - 80 * s.t, 90 * s.t + 40, .7);
  burstAt(s.x, s.y - 80 * s.t, 'multi', 80, 1.2);
  sfx.win(); sfx.boom(); buzz(40);
  meme('DEAL WITH IT', '#ffffff', true);
  startMLG(null);
}
function equip(id) {
  weapon = WEAPONS[id]; fireT = 0; stats.pickups++;
  sfx.pickup();
  popAtPlayer(weapon.name + '!', weapon.rainbow ? '#ffd1f4' : weapon.color);
  burstAt(sx(px, 1), PY - 20, weapon.rainbow ? 'multi' : weapon.color, 30);
  if (weapon.rainbow) { meme('OMG!!!', 'rainbow', true); startMLG(null); }
  else meme(weapon.en + '!', weapon.color);
}
function onKill() {
  stats.kills++;
  streak++; streakT = 4.5;
  sfx.kill();
  if (streak === 2) meme('DOUBLE KILL', '#ffd166');
  else if (streak === 3) { meme('TRIPLE KILL', '#ff9f43'); if (mlgT <= 0) startMLG(); }
  else if (streak >= 4) meme(pick(HIT_WORDS), 'rainbow');
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
    else if (good && count >= before * 2 && count >= 30) { meme('STONKS 📈', '#7bed9f'); sfx.stonks(); }
    else if (!good && count <= before * .6 && before >= 20) { meme('NOT STONKS 📉', '#ff6b6b'); }
  } else if (r.type === 'enemy') {
    if (r.n > 0 && Math.abs(px - r.x) < .42) {
      const dmg = Math.ceil(r.n);
      count -= dmg;
      popAtPlayer('−' + fmt(dmg), '#ff7b86');
      burst('#ff5a66', 34); sfx.hit(); sfx.oof(); buzz(40); shake = 10; flash = .5;
      meme('OOF', '#ff6b6b');
      if (count <= 0) { count = 0; lose(r); }
    }
  } else if (r.type === 'weapon') {
    if (Math.abs(px - r.x) < .42) equip(r.wid);
  } else {
    if (count > r.n) { count -= Math.ceil(Math.max(0, r.n)); win(r); }
    else { count = 0; lose(r); }
  }
}

// ---------- 开火 / 子弹 ----------
function fireInterval() { return weapon.rate / (1 + Math.min(count, 120) / 240) / (mlgT > 0 ? 1.6 : 1); }
function fire() {
  const w = weapon;
  stats.shots++;
  const n = w.bullets + (w.scale ? Math.min(2, Math.floor(count / 60)) : 0);
  const spreadL = Math.min(.45, Math.sqrt(Math.min(count, 70)) * 5.4 * 1.6 / ROAD_HALF);
  const dmg = w.dmg * (1 + Math.min(count, 150) / 150) * (mlgT > 0 ? 1.5 : 1);
  for (let i = 0; i < n; i++) {
    const off = w.fan ? 0 : (Math.random() - .5) * spreadL;
    const vx = w.fan ? (i - (n - 1) / 2) * w.fan : (Math.random() - .5) * (w.jitter || 0);
    bullets.push({ x: clamp(px + off, -.95, .95), z: 25, vx, w, dmg, dist: 0, hue: Math.random() * 360,
      hit: w.pierce ? new Set() : null, dead: false });
  }
  if (bullets.length > 160) bullets.splice(0, bullets.length - 160);
  const mx = sx(px, 1);
  for (let i = 0; i < 3; i++) {
    particles.push({ x: mx + rand(-14, 14), y: PY - 26, vx: rand(-50, 50), vy: rand(-240, -120), life: .22, max: .22,
      color: wColor(w, i * 40), size: rand(2, 4) });
  }
  sfx[w.snd]();
}
function addMark(x, y, big) { marks.push({ x, y, t: 0, big: !!big }); if (marks.length > 24) marks.shift(); }
function splash(x, z, dmg) {
  for (const r of rows) {
    if (r.done) continue;
    if (r.type === 'enemy' && Math.abs(r.z - z) < 140 && Math.abs(r.x - x) < .6) damageEnemy(r, dmg);
    else if (r.type === 'boss' && Math.abs(r.z - z) < 160) damageBoss(r, dmg);
  }
}
function damageEnemy(r, dmg) {
  if (r.done || r.n <= 0) return;
  r.n -= dmg; r.flashT = .1; stats.hits++;
  const s = rowScreen(r);
  addMark(s.x, s.y - 20 * s.t);
  sfx.hitmark();
  if (r.n <= 0) {
    r.n = 0; r.done = true;
    burstAt(s.x, s.y - 14 * s.t, '#ff5a66', 40);
    burstAt(s.x, s.y - 14 * s.t, '#ffd166', 16);
    addBoom(s.x, s.y - 14 * s.t, 46 * Math.max(.5, s.t), .4);
    shake = Math.max(shake, 5);
    onKill();
  }
}
function damageBoss(r, dmg) {
  if (r.done || r.n <= 0) return;
  r.n -= dmg; r.flashT = .08; stats.hits++;
  const s = rowScreen(r);
  addMark(s.x + rand(-20, 20) * s.t, s.y - 70 * s.t + rand(-20, 20) * s.t, true);
  sfx.hitmark();
  if (r.n <= 0) { r.n = 0; win(r); }
}
function hitTarget(b, r) {
  if (b.hit) b.hit.add(r); else b.dead = true;
  if (r.type === 'enemy') damageEnemy(r, b.dmg); else damageBoss(r, b.dmg);
  if (b.w.splash) {
    const s = rowScreen(r);
    addBoom(s.x, s.y - 30 * s.t, 60 * Math.max(.5, s.t), .45);
    burstAt(s.x, s.y - 30 * s.t, '#ffb347', 26);
    sfx.boom(); shake = Math.max(shake, 8);
    splash(r.x || 0, r.z, b.dmg * .6);
  }
}
function updateBullets(dt) {
  for (const b of bullets) {
    const step = b.w.speed * dt;
    b.z += step; b.dist += step; b.x += b.vx * dt;
    if (Math.abs(b.x) > 1.05 || b.dist > (b.w.range || 1500)) { b.dead = true; continue; }
    for (const r of rows) {
      if (r.done || (r.type !== 'enemy' && r.type !== 'boss')) continue;
      if (b.hit && b.hit.has(r)) continue;
      if (r.type === 'enemy') {
        if (Math.abs(b.x - r.x) < .34 && b.z >= r.z - 40 && b.z - step <= r.z + 52) hitTarget(b, r);
      } else if (Math.abs(b.x) < .75 && b.z >= r.z - 20) {
        hitTarget(b, r);
      }
      if (b.dead || state !== 'play') break;
    }
  }
  bullets = bullets.filter(b => !b.dead);
}

// ---------- 广告相关操作 ----------
function getBonus() {
  if (bonusWeapon) return;
  Ads.showRewarded(() => {
    bonusWeapon = pickWeaponId(null); stats.bonus++;
    sfx.pickup();
    floaters.push({ x: CX, y: VH * .4, text: '下一局开局：' + WEAPONS[bonusWeapon].name, color: '#ffe066', life: 1.6, max: 1.6 });
  }, () => { floaters.push({ x: CX, y: VH * .4, text: '广告暂时不可用', color: '#fff', life: 1.2, max: 1.2 }); });
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
    revived = true; stats.revives++;
    if (endEntity && endEntity.type === 'boss') {
      count = Math.ceil(endEntity.n) + 12; endEntity.done = false; endEntity.z = 0;
    } else {
      count = Math.max(20, startCount);
    }
    bullets = [];
    speed = speedBase * .6; flash = 0; shake = 0; outcome = null; banners = [];
    state = 'play';
    meme('COMEBACK!', '#7bed9f', true);
  }, () => { floaters.push({ x: CX, y: VH / 2, text: '广告暂时不可用', color: '#fff', life: 1.2, max: 1.2 }); });
}

function beat() {
  beatIdx++;
  const m = mlgT > 0;
  if (beatIdx % 4 === 0) { sfx.kick(m ? .2 : .09); if (m) pulse = 1; else pulse = Math.max(pulse, .25); }
  if (beatIdx % 2 === 1) sfx.hat(m ? .06 : .03);
}

function update(dt) {
  time += dt;
  shake *= Math.pow(.001, dt);
  flash = Math.max(0, flash - dt * 3);
  pulse = Math.max(0, pulse - dt * 4);
  if (state === 'play') {
    speed += (speedBase - speed) * Math.min(1, dt * 3);
    const d = speed * dt;
    dist += d;
    px += (targetX - px) * Math.min(1, dt * 14);
    for (const r of rows) { r.z -= d; if (r.flashT > 0) r.flashT -= dt; }
    fireT -= dt;
    if (fireT <= 0 && count > 0) { fire(); fireT = fireInterval(); }
    updateBullets(dt);
    if (state === 'play') {
      for (const r of rows) {
        if (!r.done && r.z <= 0) { resolve(r); if (state !== 'play') break; }
      }
    }
    rows = rows.filter(r => r.z > -70);
    beatT += dt;
    const bl = 60 / (mlgT > 0 ? 150 : 128) / 2;
    if (beatT >= bl) { beatT -= bl; beat(); }
  } else if (state === 'ending') {
    speed *= Math.pow(.02, dt);
    dist += speed * dt;
    endTimer -= dt;
    updateBullets(dt);
    for (const r of rows) if (r.flashT > 0) r.flashT -= dt;
    if (endTimer <= 0) finishEnding();
  } else if (state === 'menu') {
    dist += 60 * dt;
  }
  if (streak > 0) { streakT -= dt; if (streakT <= 0) streak = 0; }
  if (mlgT > 0) {
    mlgT -= dt;
    sprT -= dt;
    if (sprT <= 0) { spawnSprite(); sprT = .2; }
    if (mlgT <= 0) mlgT = 0;
  }
  for (const p of particles) { p.life -= dt; p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) { f.life -= dt; f.y -= 50 * dt; }
  floaters = floaters.filter(f => f.life > 0);
  for (const m of marks) m.t += dt;
  marks = marks.filter(m => m.t < .22);
  for (const b of booms) b.t += dt;
  booms = booms.filter(b => b.t < b.dur);
  for (const s of sprites) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt; }
  sprites = sprites.filter(s => s.life < s.max);
  for (const b of banners) b.t += dt;
  banners = banners.filter(b => b.t < b.dur);
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
  if (mlgT > 0) {  // 镜头光斑
    for (let k = 1; k <= 5; k++) {
      ctx.fillStyle = hsl(time * 90 + k * 60, .16);
      ctx.beginPath();
      ctx.arc(sxn + (CX - sxn) * k * .45, syn + (HORIZON + 90 - syn) * k * .3, 10 + k * 7, 0, TAU);
      ctx.fill();
    }
  }
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
  ctx.strokeStyle = mlgT > 0 ? hsl(time * 200) : '#e8ecff'; ctx.lineWidth = 3;
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

// ---------- 绘制：人群、门、敌人、Boss、武器 ----------
function drawCrowd(cx, cy, n, s, color, light, seed, gun, shades) {
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
    if (shades) { ctx.fillStyle = '#000'; ctx.fillRect(p.x - 3.4 * s, p.y - 6.6 * s + bob, 6.8 * s, 2.1 * s); }
    if (gun && i < 40) {
      const gh = gun.len * s * .6, gy = p.y - gh * .75 + bob;
      ctx.fillStyle = '#1d2136'; ctx.fillRect(p.x + 3 * s, gy, 2.4 * s, gh);
      ctx.fillStyle = gun.color; ctx.fillRect(p.x + 3 * s, gy, 2.4 * s, 2.4 * s);
    }
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
  if (t < .04 || r.n <= 0) return;
  ctx.globalAlpha = clamp((1500 - r.z) / 400, 0, 1);
  const x = sx(r.x, t), y = sy(t);
  const hurt = r.flashT > 0;
  drawCrowd(x, y, Math.max(1, Math.ceil(r.n)), t * .95, hurt ? '#ffffff' : '#e8414f', hurt ? '#ffffff' : '#ff9aa2', r.z * .01);
  pill(fmt(Math.ceil(r.n)), x, y - (20 + Math.sqrt(Math.min(r.n, 70)) * 3.5) * t, Math.max(.35, t), 'rgba(160,20,35,.9)', '#fff');
  ctx.globalAlpha = 1;
}
function drawShades(x, y, w, rot) {
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
  const h = w * .2;
  ctx.fillStyle = '#000';
  ctx.fillRect(-w / 2, -h / 2, w, h * .35);                     // 横梁
  ctx.fillRect(-w / 2, -h / 2, w * .44, h);                      // 左镜片
  ctx.fillRect(w * .06, -h / 2, w * .44, h);                     // 右镜片
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(-w * .4, -h * .3, w * .1, h * .22);
  ctx.fillRect(w * .12, -h * .3, w * .1, h * .22);
  ctx.restore();
}
function drawBoss(r) {
  if (r.done && outcome === 'win' && state !== 'ending') return;
  const t = proj(r.z);
  if (t < .04) return;
  const dying = state === 'ending' && outcome === 'win' && endEntity === r;
  ctx.globalAlpha = clamp((1700 - r.z) / 400, 0, 1);
  if (dying) ctx.globalAlpha = clamp(endTimer / .5, 0, 1);
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
  if (dying) {  // Deal with it 墨镜从天而降
    const p = clamp((endDur - endTimer) / .55, 0, 1), e = 1 - Math.pow(1 - p, 3);
    drawShades(cx, by - R * .12 - (1 - e) * R * 2.2, R * 1.35, 0);
  }
  if (r.flashT > 0) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.arc(cx, by, R, 0, TAU); ctx.fill(); }
  if (r.n > 0) pill(fmt(Math.ceil(r.n)), cx, by - R * 1.7, Math.max(.4, t * 1.5), 'rgba(90,5,15,.92)', '#fff');
  ctx.globalAlpha = 1;
}
function drawWeaponRow(r) {
  const t = proj(r.z);
  if (t < .04) return;
  const w = WEAPONS[r.wid], x = sx(r.x, t), y = sy(t);
  ctx.globalAlpha = clamp((1500 - r.z) / 400, 0, 1);
  const R = 24 * t, cy = y - R - 14 * t + Math.sin(time * 4 + r.z * .01) * 6 * t;
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(x, y, R, R * .28, 0, 0, TAU); ctx.fill();
  const col = wColor(w);
  const gg = ctx.createRadialGradient(x, cy, R * .3, x, cy, R * 2);
  gg.addColorStop(0, w.rainbow ? hsl(time * 300, .55) : 'rgba(255,255,255,.5)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, cy, R * 2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1b2150'; ctx.beginPath(); ctx.arc(x, cy, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 4 * t); ctx.stroke();
  ctx.font = Math.max(10, 26 * t) + 'px system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
  ctx.fillText(w.emoji, x, cy + 1);
  pill(w.name, x, y + 12 * t, Math.max(.4, t * .75), 'rgba(15,20,60,.9)', '#fff');
  ctx.globalAlpha = 1;
}
function drawBullet(b) {
  const t = proj(b.z);
  if (t < .03) return;
  const w = b.w, lift = 22;
  const y = sy(t) - lift * t, x = sx(b.x, t);
  const z2 = Math.max(0, b.z - w.len), t2 = proj(z2);
  const y2 = sy(t2) - lift * t2, x2 = sx(b.x - b.vx * .03, t2);
  const col = (w.rainbow || mlgT > 0) ? hsl(b.hue + time * 300) : w.color;
  ctx.lineCap = 'round';
  if (w.beam) {
    ctx.strokeStyle = 'rgba(109,247,255,.35)'; ctx.lineWidth = w.size * 3 * t + 2; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, w.size * t); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
  } else if (w.splash) {
    ctx.strokeStyle = 'rgba(255,170,60,.6)'; ctx.lineWidth = w.size * 1.4 * t + 2; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(x, y, Math.max(2, w.size * t), 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(x, y, Math.max(1, w.size * t * .45), 0, TAU); ctx.fill();
  } else {
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, w.size * t * 1.4);
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, Math.max(1, w.size * t * .55), 0, TAU); ctx.fill();
  }
  ctx.lineCap = 'butt';
}
function drawPlayer() {
  if (count <= 0) return;
  const x = sx(px, 1);
  drawCrowd(x, PY, count, 1, '#2f7dff', '#a9ceff', 0, { len: weapon.gun, color: wColor(weapon) }, mlgT > 0);
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
function drawBooms() {
  for (const b of booms) {
    const p = b.t / b.dur, r = b.r * (.35 + .65 * p);
    ctx.globalAlpha = clamp(1 - p, 0, 1);
    ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(b.x, b.y, r * .55, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawMarks() {
  ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
  for (const m of marks) {
    ctx.globalAlpha = clamp(1 - m.t / .22, 0, 1);
    const a = m.big ? 5 : 4, bl = m.big ? 13 : 10; ctx.lineWidth = m.big ? 3 : 2.4;
    ctx.beginPath();
    for (const sxn of [-1, 1]) for (const syn of [-1, 1]) {
      ctx.moveTo(m.x + sxn * a, m.y + syn * a);
      ctx.lineTo(m.x + sxn * bl, m.y + syn * bl);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
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
function drawSprites() {
  for (const s of sprites) {
    const p = s.life / s.max;
    ctx.globalAlpha = clamp(Math.min(p * 6, (1 - p) * 4, 1), 0, 1) * .9;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
    if (s.type === 'shades') { drawShades(0, 0, s.size * 2.6, 0); }
    else {
      const z = s.size;
      ctx.beginPath(); ctx.moveTo(0, -z); ctx.lineTo(z * .95, z * .75); ctx.lineTo(-z * .95, z * .75); ctx.closePath();
      if (s.type === 'tri') { ctx.fillStyle = '#ff8a1f'; ctx.fill(); ctx.strokeStyle = '#ffd08a'; ctx.lineWidth = 2; ctx.stroke(); }
      else {
        ctx.fillStyle = 'rgba(255,215,90,.25)'; ctx.fill(); ctx.strokeStyle = '#ffd75a'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, z * .2, z * .42, z * .24, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, z * .2, z * .15, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawBanners() {
  for (let i = banners.length - 1, k = 0; i >= 0; i--, k++) {
    const b = banners[i], p = b.t / b.dur;
    const pop = b.t < .18 ? 1 + (1 - b.t / .18) * .6 : 1;
    const a = p > .75 ? clamp((1 - p) / .25, 0, 1) : 1;
    const size = b.big ? 38 : 32;
    ctx.save();
    ctx.globalAlpha = a * (k === 0 ? 1 : .55);
    ctx.translate(CX, VH * .3 - k * 46);
    ctx.rotate(b.rot + (b.big ? Math.sin(time * 18) * .03 : 0));
    ctx.scale(pop, pop);
    ctx.font = '900 ' + size + 'px ' + MEME_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(255,0,60,.85)'; ctx.fillText(b.text, -3, 1);
    ctx.fillStyle = 'rgba(0,230,255,.85)'; ctx.fillText(b.text, 3, -1);
    ctx.lineWidth = size * .16; ctx.strokeStyle = '#000'; ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.color === 'rainbow' ? hsl(time * 400) : b.color; ctx.fillText(b.text, 0, 0);
    ctx.restore();
  }
}

// ---------- 绘制：界面 ----------
function button(text, x, y, w, h, action, c1, c2, pulseOn) {
  buttons.push({ x, y, w, h, action });
  ctx.save();
  if (pulseOn) {
    const p = 1 + Math.sin(time * 5) * .025;
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(p, p); ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  rr(x, y + 4, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  rr(x, y, w, h, h / 2); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '800 ' + (h < 50 ? 17 : 20) + 'px system-ui,sans-serif';
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
function bonusButton(x, y) {
  button(bonusWeapon ? '🎁 下局开局：' + WEAPONS[bonusWeapon].name : '📺 看广告领随机武器', x, y, 240, 46, getBonus,
    bonusWeapon ? '#4a8f5a' : '#b06cff', bonusWeapon ? '#2f6a3d' : '#7a3fe0');
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
    if (mlgT > 0) { ctx.fillStyle = hsl(time * 300); ctx.fillRect(bx, 39, bw * clamp(mlgT / 8, 0, 1), 5); }
  }
  if (state === 'play' || state === 'ending') {
    rr(12, VH - 48, 150, 32, 16); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 16px system-ui,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(weapon.emoji + ' ' + weapon.name, 24, VH - 31);
    if (streak >= 2) {
      ctx.textAlign = 'right'; ctx.font = '900 24px ' + MEME_FONT;
      ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText('COMBO x' + streak, VW - 14, 66);
      ctx.fillStyle = '#ffd166'; ctx.fillText('COMBO x' + streak, VW - 14, 66);
    }
  }
}
function drawMenu() {
  ctx.fillStyle = 'rgba(6,10,28,.35)'; ctx.fillRect(0, 0, VW, VH);
  const ty = VH * .21;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 46px system-ui,sans-serif';
  ctx.lineWidth = 8; ctx.strokeStyle = '#1b2a6b'; ctx.strokeText('数字大冲关', CX, ty);
  const g = ctx.createLinearGradient(0, ty - 26, 0, ty + 26);
  g.addColorStop(0, '#fff6b0'); g.addColorStop(1, '#ffb347');
  ctx.fillStyle = g; ctx.fillText('数字大冲关', CX, ty);
  ctx.font = '700 15px system-ui,sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText('拖动手指选门 · 自动开火 · 捡武器打爆 Boss', CX, ty + 46);
  ctx.fillStyle = '#d9e4ff';
  ctx.fillText('最高到达：第 ' + bestLevel + ' 关', CX, ty + 72);
  const by = VH * .5;
  button('开始 第 ' + level + ' 关', CX - 100, by, 200, 56, startLevel, '#ffd35a', '#ff9f1c', true);
  bonusButton(CX - 120, by + 74);
  button(muted ? '🔇 声音：关' : '🔊 声音：开', CX - 70, by + 134, 140, 40,
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
  const y = panel('通关！', '剩余 ' + fmt(winCount) + ' 人', 300);
  bonusButton(CX - 120, y + 122);
  button('下一关', CX - 110, y + 192, 220, 56, nextLevel, '#7bed9f', '#2ecc71', true);
}

function draw() {
  buttons = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0d1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.save();
  ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
  if (pulse > 0) {
    const z = 1 + pulse * .02;
    ctx.translate(CX, VH / 2); ctx.scale(z, z); ctx.translate(-CX, -VH / 2);
  }
  drawBackground(); drawRoad();
  const list = rows.concat(bullets);
  list.sort((a, b) => b.z - a.z);
  for (const o of list) {
    if (o.type === undefined) drawBullet(o);
    else if (o.type === 'gate') drawGate(o);
    else if (o.type === 'enemy') drawEnemy(o);
    else if (o.type === 'weapon') { if (!o.done) drawWeaponRow(o); }
    else drawBoss(o);
  }
  if (state !== 'menu') drawPlayer();
  drawBooms(); drawParticles(); drawMarks(); drawFloaters();
  ctx.restore();
  if (mlgT > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hsl(time * 120, .09 + .05 * pulse);
    ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = 'source-over';
    drawSprites();
  }
  if (flash > 0) { ctx.fillStyle = 'rgba(255,60,70,' + (flash * .35) + ')'; ctx.fillRect(0, 0, VW, VH); }
  if (state === 'menu') drawMenu();
  else { drawHUD(); drawBanners(); if (state === 'over') drawOver(); else if (state === 'win') drawWin(); }
}

// ---------- 输入 ----------
function toGame(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}
function setTarget(gx) { targetX = clamp((gx - CX) / ROAD_HALF, -.88, .88); }
canvas.addEventListener('pointerdown', e => {
  initAudio();
  if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (err) { dbg(err); } }
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
try { Ads.init(); } catch (e) { dbg(e); }

// 测试钩子：仅在自动化测试里存在 window.__errs 时启用
if (window.__errs) {
  window.__game = {
    get rows() { return rows; }, get px() { return px; }, get count() { return count; }, get state() { return state; },
    get weapon() { return weapon.id; }, get mlg() { return mlgT; }, get buttons() { return buttons; },
    get scale() { return scale; }, get cx() { return CX; }, get bullets() { return bullets.length; }
  };
}
requestAnimationFrame(frame);
})();
