import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/* =========================================================
   OOT STREET — mini open-world web game (Kediri, sunset)
   Edit CONFIG below to tweak rewards, store items, caps.
   ========================================================= */
const CONFIG = {
  DAILY_CAP: 20,           // max koin dari main game per hari (server: game_settings.daily_cap)
  COIN_PICKUP: 5,          // nilai koin yang tersebar di jalan
  COIN_RESPAWN: 45,        // detik sebelum koin muncul lagi
  REWARD: { kopi: 50, poster: 80, copet: 100 },
  VOUCHER_DAYS: 7,
  STORE: [
    { id: 'D10', name: 'Voucher Diskon 10% semua merch OOT', cost: 150, label: '10%' },
    { id: 'KEY', name: 'Gratis Keychain OOT (min. belanja Rp100rb)', cost: 300, label: 'KEY' },
    { id: 'RNG', name: 'Diskon 20% Cincin "Pēpo uze"', cost: 350, img: 'assets/cincin.jpg' },
    { id: 'GLS', name: 'Diskon 20% Kacamata "For Life"', cost: 400, img: 'assets/kacamata.jpg' },
    { id: 'PRF', name: 'Diskon 20% Parfum OOT', cost: 400, img: 'assets/parfum.jpg' },
    { id: 'JRS', name: 'Diskon 25% Jersey OOT "de Vivre"', cost: 500, img: 'assets/jersey.jpg' },
  ],
  REDEEM_NOTE: 'Screenshot voucher ini, lalu tunjukkan ke kasir Texture Coffee atau kirim via DM Instagram OOT.',
};

/* ---------------- save ---------------- */
const SAVE_KEY = 'oot_street_v1';
const today = () => new Date().toLocaleDateString('sv');
let save = { coins: 0, day: today(), earned: 0, vouchers: [], done: {}, muted: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
if (save.day !== today()) { save.day = today(); save.earned = 0; }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
/* ---------------- online (Supabase) ---------------- */
// If the online layer cannot load (offline, blocked CDN), the game falls back
// to the old device-only coins so it still plays.
let NET = null;
try { NET = await import('./net.js'); } catch (e) { console.warn('online layer unavailable', e); }
const ON = { me: null, guest: false, warned: false };
const dailyCap = () => ON.me?.daily_cap ?? CONFIG.DAILY_CAP;
async function refreshMe() {
  if (!NET) return null;
  try { ON.me = (await NET.session()) ? await NET.me() : null; } catch (e) { console.warn(e); ON.me = null; }
  if (typeof updateHUD === 'function' && started) updateHUD();
  return ON.me;
}
const balance = () => (NET ? (ON.me?.profile ? ON.me.balance : 0) : save.coins);
// Server is the truth: after a flush, reload what it actually counted.
function syncPlay(r) { if (ON.me && r) refreshMe(); }
function earn(n) {
  if (NET) {
    if (!ON.me?.profile) {
      if (!ON.warned) { ON.warned = true; toast('Login dulu biar koin kamu tersimpan dan masuk leaderboard.', 3800); }
      return 0;
    }
    const got = Math.max(0, Math.min(n, ON.me.daily_cap - ON.me.today));
    if (got > 0) {
      ON.me.today += got; ON.me.balance += got; ON.me.total += got;
      NET.queuePlay(got, syncPlay);
    }
    updateHUD();
    return got;
  }
  if (save.day !== today()) { save.day = today(); save.earned = 0; }
  const got = Math.max(0, Math.min(n, CONFIG.DAILY_CAP - save.earned));
  save.coins += got; save.earned += got; persist(); updateHUD();
  return got;
}

/* ---------------- dom ---------------- */
const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

/* ---------------- audio ---------------- */
const bgm = new Audio('assets/bgm.mp3'); bgm.loop = true; bgm.volume = 0.35;
const sfxSrc = { buy: 'assets/buy.mp3', whoosh: 'assets/whoosh.mp3' };
function sfx(name, vol = 0.6) {
  if (save.muted) return;
  const a = new Audio(sfxSrc[name]); a.volume = vol; a.play().catch(() => {});
}
function applyMute() { $('btnMute').textContent = save.muted ? '✕' : '♪'; if (save.muted) bgm.pause(); else if (started) bgm.play().catch(() => {}); }

/* ---------------- map data (real Kota Kediri, © OpenStreetMap contributors) ---------------- */
const MAP = await (await fetch('assets/kediri.json')).json();
const XF = MAP.xf; const [CX0, CX1, CZ0, CZ1] = MAP.crop;
const GW = Math.round(CX1 - CX0), GH = Math.round(CZ1 - CZ0); // 1 px = 1 m, OSM frame (north up)
const toOsm = (gx, gz) => [(gx - 20) * XF.nz + gz * XF.nx + XF.fx, -(gx - 20) * XF.nx + gz * XF.nz + XF.fz];
const toGame = (ox, oz) => { const X = ox - XF.fx, Z = oz - XF.fz; return [X * XF.nz - Z * XF.nx + 20, X * XF.nx + Z * XF.nz]; };
const toImg = (gx, gz) => { const [ox, oz] = toOsm(gx, gz); return [ox - CX0, oz - CZ0]; };
const IMG_FROM_GAME = new DOMMatrix([XF.nz, -XF.nx, XF.nx, XF.nz, -20 * XF.nz + XF.fx - CX0, 20 * XF.nx + XF.fz - CZ0]);
const GAME_FROM_IMG = IMG_FROM_GAME.inverse();
const NORTH = [XF.nx, -XF.nz], WEST = [-XF.nz, -XF.nx]; // unit vectors in the game frame

/* ---------------- renderer ---------------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
const FOG = new THREE.Color('#d9804a');
scene.fog = new THREE.Fog(FOG, 30, 135);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
function resize() {
  const w = innerWidth, h = innerHeight;
  const s = Math.min(1, 400 / h);
  renderer.setSize(Math.max(1, Math.floor(w * s)), Math.max(1, Math.floor(h * s)), false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ---------------- helpers ---------------- */
let seed = 1337;
const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function angLerp(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }

function canvasTex(w, h, draw, nearest = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter; }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noise(g, w, h, amt = 18, step = 2) {
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const v = (Math.random() - 0.5) * amt;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    g.fillRect(x, y, step, step);
  }
}
const loadMgr = new THREE.LoadingManager();
loadMgr.onLoad = () => $('loading').classList.add('hidden');
const texLoader = new THREE.TextureLoader(loadMgr);
function imgTex(url) { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t; }

// scale BoxGeometry UVs so textures tile per world unit
function boxUV(geo, w, h, d, unit = 4, unitY = 3.5) {
  const uv = geo.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i; const [a, b] = dims[f];
    const uy = (f === 2 || f === 3) ? unit : unitY;
    uv.setXY(k, uv.getX(k) * a / unit, uv.getY(k) * b / uy);
  }
  uv.needsUpdate = true; return geo;
}
const lam = (opts) => new THREE.MeshLambertMaterial({ flatShading: true, ...opts });

/* ---------------- sky & light ---------------- */
const skyGroup = new THREE.Group(); scene.add(skyGroup);
{
  const skyTex = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2b1f4a'); gr.addColorStop(0.32, '#7d3f5e'); gr.addColorStop(0.46, '#e0703a');
    gr.addColorStop(0.5, '#ffb04a'); gr.addColorStop(0.52, '#d9804a'); gr.addColorStop(1, '#5a3420');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, false);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  skyGroup.add(sky);
  const sunTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.35, '#ffd36b'); gr.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false }));
  sun.position.set(WEST[0] * 360 + NORTH[0] * 60, 40, WEST[1] * 360 + NORTH[1] * 60); sun.scale.set(110, 110, 1); skyGroup.add(sun);
  // pixel clouds
  const cloudTex = canvasTex(64, 16, (g) => { g.fillStyle = '#f0a066'; for (let i = 0; i < 9; i++) g.fillRect(Math.random() * 50, 4 + Math.random() * 8, 10 + Math.random() * 14, 4); }, true);
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: 0.7, depthWrite: false }));
    const a = Math.random() * Math.PI * 2; c.position.set(Math.cos(a) * 330, 70 + Math.random() * 60, Math.sin(a) * 330); c.scale.set(110, 26, 1); skyGroup.add(c);
  }
}
scene.add(new THREE.HemisphereLight('#ffd2a0', '#5a3a2a', 0.95));
const dir = new THREE.DirectionalLight('#ffb070', 1.5); dir.position.set(WEST[0] * 80 + NORTH[0] * 20, 45, WEST[1] * 80 + NORTH[1] * 20); scene.add(dir);

/* ---------------- textures ---------------- */
const T = {};
T.asphalt = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#4a4440'; g.fillRect(0, 0, w, h); noise(g, w, h, 30, 2); });
T.road = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#4a4440'; g.fillRect(0, 0, w, h); noise(g, w, h, 30, 2); g.fillStyle = '#e8d9a8'; g.fillRect(30, 0, 4, 34); });
T.roadV = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#4a4440'; g.fillRect(0, 0, w, h); noise(g, w, h, 30, 2); g.fillStyle = '#e8d9a8'; g.fillRect(0, 30, 34, 4); });
T.side = canvasTex(32, 32, (g, w, h) => { g.fillStyle = '#9c8f80'; g.fillRect(0, 0, w, h); noise(g, w, h, 26, 2); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h); });
T.grass = canvasTex(32, 32, (g, w, h) => { g.fillStyle = '#5d6b34'; g.fillRect(0, 0, w, h); noise(g, w, h, 40, 2); });
T.curb = canvasTex(16, 4, (g) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#222' : '#ddd'; g.fillRect(i * 4, 0, 4, 4); } });
const WALLS = ['#c9b79a', '#d8c7a6', '#b9876a', '#c99a86', '#a9a39a', '#d4b48a', '#9f8c76', '#c4a690'];
T.walls = WALLS.map((col) => canvasTex(32, 28, (g, w, h) => {
  g.fillStyle = col; g.fillRect(0, 0, w, h); noise(g, w, h, 34, 2);
  g.fillStyle = 'rgba(60,30,10,.18)'; g.fillRect(0, h - 3, w, 3);
  const lit = Math.random() < 0.35;
  g.fillStyle = '#3a2a20'; g.fillRect(8, 6, 16, 14);
  g.fillStyle = lit ? '#f5b64e' : '#2a3540'; g.fillRect(10, 8, 12, 10);
  g.fillStyle = '#3a2a20'; g.fillRect(15, 8, 2, 10);
}));
T.roof = canvasTex(16, 16, (g, w, h) => { g.fillStyle = '#5a4a40'; g.fillRect(0, 0, w, h); noise(g, w, h, 30, 2); });
T.shoe = canvasTex(8, 8, (g) => { for (let y = 0; y < 8; y += 2) for (let x = 0; x < 8; x += 2) { g.fillStyle = ['#111', '#eee', '#888', '#eee'][(Math.random() * 4) | 0]; g.fillRect(x, y, 2, 2); } });
T.shirt = canvasTex(16, 16, (g, w, h) => { g.fillStyle = '#e9e7e2'; g.fillRect(0, 0, w, h); noise(g, w, h, 22, 2); });
T.shorts = canvasTex(16, 16, (g, w, h) => { g.fillStyle = '#d4d6d8'; g.fillRect(0, 0, w, h); noise(g, w, h, 30, 2); g.fillStyle = '#9aa0a8'; g.fillRect(7, 0, 1, 16); });
T.jersey = imgTex('assets/jersey_tex.jpg');
T.crate = imgTex('assets/crate.jpg');
T.coin = canvasTex(32, 32, (g) => { g.fillStyle = '#ffcf3a'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#c98a12'; g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.fillText('OOT', 16, 21); });

const SHOP_NAMES = ['TAHU TAKWA', 'GETUK PISANG', 'PECEL TUMPANG', 'TOKO EMAS', 'TOKO SEPATU', 'BATIK KEDIRI', 'PONSEL JAYA', 'OPTIK', 'TOKO KAIN', 'APOTEK', 'SATE BEKICOT', 'NASI PECEL', 'BENGKEL', 'FOTOKOPI'];
const SIGN_COLS = [['#b3262a', '#fff'], ['#2a3c8a', '#ffcf3a'], ['#f2e8d2', '#2b1c12'], ['#1f5a32', '#fff'], ['#ffcf3a', '#2b1c12'], ['#222', '#ff9a3a']];
/* ---------------- world: real Kota Kediri from OpenStreetMap ----------------
   assets/kediri.json is generated by tools/build_kediri.py (map data © OpenStreetMap contributors, ODbL).
   Game frame = OSM metres rotated so Texture Coffee's frontage road (Jl. Dr. Wahidin) runs along z = 0. */
const solids = [];      // AABB colliders {x0,x1,z0,z1} for props (game frame)
const occluders = [];   // prop meshes for camera collision; buildings use the height grid
function addSolid(x0, x1, z0, z1) { solids.push({ x0, x1, z0, z1 }); }
const CAFE = { x: 20, z: 20 };
const CAFE_LOT = { x0: 4, x1: 36, z0: 5, z1: 30 };
function groundY(x, z) { return x > CAFE_LOT.x0 && x < CAFE_LOT.x1 && z > CAFE_LOT.z0 && z < CAFE_LOT.z1 ? 0.25 : 0; }
const CLS_W = [12, 11, 9, 7.5, 6, 5, 3.6, 3.5, 4];

// ---- occupancy / height grid (1 m cells, OSM frame, drawn with a 2D canvas) ----
const gridC = document.createElement('canvas'); gridC.width = GW; gridC.height = GH;
const gctx = gridC.getContext('2d', { willReadFrequently: true });
gctx.fillStyle = '#000'; gctx.fillRect(0, 0, GW, GH); gctx.setTransform(IMG_FROM_GAME);
const polyPath = (g, p) => { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); };
const linePath = (g, p) => { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); };
// water is solid…
gctx.fillStyle = 'rgb(255,0,0)';
for (const w of MAP.water) { gctx.beginPath(); polyPath(gctx, w.o); for (const h of w.h) polyPath(gctx, h); gctx.fill('evenodd'); }
// …except where a road crosses it (bridges)
gctx.globalCompositeOperation = 'destination-out'; gctx.lineCap = 'round'; gctx.lineJoin = 'round';
for (const r of MAP.roads) { if (r.c > 6) continue; gctx.lineWidth = r.w + 0.6; gctx.beginPath(); linePath(gctx, r.p); gctx.stroke(); }
gctx.globalCompositeOperation = 'source-over';
let OCC, HGT; // filled by finishGrid()
function gridBox(x, z, w, d, h, yaw = 0) { // solid prop drawn into the grid (game frame, rotated box)
  gctx.save(); gctx.translate(x, z); gctx.rotate(-yaw); gctx.fillStyle = `rgb(255,${Math.min(255, Math.round(h * 4))},0)`; gctx.fillRect(-w / 2, -d / 2, w, d); gctx.restore();
}
function finishGrid() {
  const d = gctx.getImageData(0, 0, GW, GH).data; const n = GW * GH;
  OCC = new Uint8Array(n); HGT = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const r = d[i * 4]; if (r >= 128) { OCC[i] = 1; HGT[i] = Math.min(255, Math.round(d[i * 4 + 1] * 255 / r)); } }
}
const cellOf = (x, z) => { const [u, v] = toImg(x, z); const i = Math.floor(u), j = Math.floor(v); return (i < 0 || j < 0 || i >= GW || j >= GH) ? -1 : j * GW + i; };
function heightAt(x, z) { const k = cellOf(x, z); return k < 0 ? 0 : HGT[k] / 4; }
function freeAt(x, z, r = 0) {
  for (const [dx, dz] of r ? [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]] : [[0, 0]]) { const k = cellOf(x + dx, z + dz); if (k < 0 || OCC[k]) return false; }
  return true;
}

// ---- shared geometry builder ----
class GeoBuf {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  v(x, y, z, u = 0, w = 0, c) { this.pos.push(x, y, z); this.uv.push(u, w); if (c) this.col.push(c.r, c.g, c.b); return this.n++; }
  upTri(a, b, c) { const P = this.pos, ax = P[a * 3], az = P[a * 3 + 2]; const bx = P[b * 3] - ax, bz = P[b * 3 + 2] - az, cx = P[c * 3] - ax, cz = P[c * 3 + 2] - az; if (bz * cx - bx * cz >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b); }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setIndex(this.idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
  mesh(mat) { const m = new THREE.Mesh(this.geo(), mat); scene.add(m); return m; }
}
function addStrip(buf, p, w, y, uvS = 0.25, joints = true) {
  const h = w / 2;
  for (let i = 0; i < p.length - 2; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]; const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const nx = -(bz - az) / L * h, nz = (bx - ax) / L * h;
    const q = [[ax + nx, az + nz], [ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz]].map(([x, z]) => buf.v(x, y, z, x * uvS, z * uvS));
    buf.upTri(q[0], q[1], q[2]); buf.upTri(q[0], q[2], q[3]);
  }
  if (joints) for (let i = 0; i < p.length; i += 2) {
    const c = buf.v(p[i], y, p[i + 1], p[i] * uvS, p[i + 1] * uvS); const ring = [];
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; const x = p[i] + Math.cos(a) * h, z = p[i + 1] + Math.sin(a) * h; ring.push(buf.v(x, y, z, x * uvS, z * uvS)); }
    for (let k = 0; k < 8; k++) buf.upTri(c, ring[k], ring[(k + 1) % 8]);
  }
}
function offsetLine(p, off) { // parallel polyline (per-vertex averaged normals)
  const out = []; const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    let nx = 0, nz = 0;
    for (const j of [i - 1, i]) { if (j < 0 || j >= n - 1) continue; const dx = p[j * 2 + 2] - p[j * 2], dz = p[j * 2 + 3] - p[j * 2 + 1], L = Math.hypot(dx, dz) || 1; nx += -dz / L; nz += dx / L; }
    const L = Math.hypot(nx, nz) || 1; out.push(p[i * 2] + nx / L * off, p[i * 2 + 1] + nz / L * off);
  }
  return out;
}
function shapeGeo(outer, holes = [], uvS = 0.1) { // flat polygon in the xz plane, facing up
  const toV = (p) => { const a = []; for (let i = 0; i < p.length; i += 2) a.push(new THREE.Vector2(p[i], -p[i + 1])); return a; };
  const s = new THREE.Shape(toV(outer)); for (const h of holes) s.holes.push(new THREE.Path(toV(h)));
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvS, uv.getY(i) * uvS);
  return g;
}

// ---- ground ----
T.ground = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#6a6a48'; g.fillRect(0, 0, w, h); noise(g, w, h, 34, 2); for (let i = 0; i < 40; i++) { g.fillStyle = Math.random() < 0.5 ? '#7a6a4a' : '#5a6a3a'; g.fillRect(Math.random() * w, Math.random() * h, 4, 3); } });
{
  const [mx, mz] = toGame((CX0 + CX1) / 2, (CZ0 + CZ1) / 2);
  const g = new THREE.PlaneGeometry(6000, 6000); g.rotateX(-Math.PI / 2); g.translate(mx, 0, mz);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1200, uv.getY(i) * 1200);
  scene.add(new THREE.Mesh(g, lam({ map: T.ground })));
}
// shared geometries/materials
const sideMat = lam({ map: T.side });
const grassMat = lam({ map: T.grass });
const roofMat = lam({ map: T.roof });
const trunkMat = lam({ color: '#5b3b24' });
const leafMats = ['#3f6b2a', '#56782e', '#2f5a2a'].map((c) => lam({ color: c }));
const leafGeo = new THREE.IcosahedronGeometry(1.6, 0);
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 3, 5);
function tree(x, z, s = 1) { // single (prop) tree with an AABB collider
  const g = new THREE.Group();
  const t = new THREE.Mesh(trunkGeo, trunkMat); t.position.y = 1.5; g.add(t);
  const l1 = new THREE.Mesh(leafGeo, pick(leafMats)); l1.position.y = 3.6; l1.scale.set(1.2, 0.9, 1.2); g.add(l1);
  const l2 = new THREE.Mesh(leafGeo, pick(leafMats)); l2.position.set(0.5, 4.5, 0.2); l2.scale.setScalar(0.75); g.add(l2);
  g.position.set(x, groundY(x, z), z); g.scale.setScalar(s); g.rotation.y = rand() * 6; scene.add(g);
  addSolid(x - 0.35, x + 0.35, z - 0.35, z + 0.35);
}

// ---- parks / alun-alun ----
{
  const pitchMat = lam({ map: canvasTex(32, 32, (g, w, h) => { g.fillStyle = '#5a8a3a'; g.fillRect(0, 0, w, h); noise(g, w, h, 26, 2); }) });
  for (const pk of MAP.parks) { const m = new THREE.Mesh(shapeGeo(pk.p, [], 0.2), pk.k ? pitchMat : grassMat); m.position.y = 0.012; scene.add(m); }
}
// ---- Sungai Brantas ----
const riverTex = canvasTex(32, 64, (g, W, H) => { g.fillStyle = '#3f6470'; g.fillRect(0, 0, W, H); for (let i = 0; i < 50; i++) { g.fillStyle = Math.random() < 0.5 ? '#5a8590' : '#2f4c58'; g.fillRect(Math.random() * W, Math.random() * H, 1, 2 + Math.random() * 7); } for (let i = 0; i < 10; i++) { g.fillStyle = '#c8dce0'; g.fillRect(Math.random() * W, Math.random() * H, 1, 2); } });
{
  const wm = lam({ map: riverTex, emissive: '#1a2a30' });
  for (const w of MAP.water) { const m = new THREE.Mesh(shapeGeo(w.o, w.h, 0.08), wm); m.position.y = 0.02; scene.add(m); }
}
// ---- roads ----
{
  const bufs = { side: new GeoBuf(), serv: new GeoBuf(), minor: new GeoBuf(), major: new GeoBuf(), dash: new GeoBuf(), rail: new GeoBuf(), ballast: new GeoBuf(), bridge: new GeoBuf() };
  for (const r of MAP.roads) {
    if (r.c <= 3) { addStrip(bufs.side, r.p, r.w + 3.2, 0.03); addStrip(bufs.major, r.p, r.w, 0.06 + (3 - r.c) * 0.004); }
    else if (r.c <= 6) addStrip(bufs.minor, r.p, r.w, 0.05);
    else addStrip(bufs.serv, r.p, r.w, 0.04);
    if (r.c <= 2) { // centre dashes
      let carry = 0; const p = r.p;
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz); if (L < 0.01) continue;
        for (let s = carry; s < L; s += 6) { const e = Math.min(L, s + 3); addStrip(bufs.dash, [ax + dx * s / L, az + dz * s / L, ax + dx * e / L, az + dz * e / L], 0.22, 0.075, 1, false); }
        carry = ((carry - L) % 6 + 6) % 6;
      }
    }
    if (r.b && r.c <= 6) for (const sg of [-1, 1]) { // bridge railings (vertical strips)
      const q = offsetLine(r.p, sg * (r.w / 2 + 0.15)); const B = bufs.bridge;
      for (let i = 0; i < q.length - 2; i += 2) { const a0 = B.v(q[i], 0, q[i + 1]), b0 = B.v(q[i + 2], 0, q[i + 3]), a1 = B.v(q[i], 1.1, q[i + 1]), b1 = B.v(q[i + 2], 1.1, q[i + 3]); B.idx.push(a0, b1, b0, a0, a1, b1); }
    }
  }
  for (const p of MAP.rails) { addStrip(bufs.ballast, p, 3.2, 0.035, 0.3); for (const o of [-0.72, 0.72]) addStrip(bufs.rail, offsetLine(p, o), 0.12, 0.11, 1, false); }
  bufs.side.mesh(sideMat);
  bufs.serv.mesh(lam({ map: T.side, color: '#b8ae9e' }));
  bufs.minor.mesh(lam({ map: T.asphalt, color: '#c4bcb2' }));
  bufs.major.mesh(lam({ map: T.asphalt }));
  bufs.dash.mesh(lam({ color: '#e8d9a8' }));
  bufs.ballast.mesh(lam({ color: '#6a625a' }));
  bufs.rail.mesh(lam({ color: '#a0a0a0' }));
  bufs.bridge.mesh(lam({ color: '#d8d2c4', side: THREE.DoubleSide }));
}

// ---- buildings (extruded OSM footprints, merged per 200 m chunk) ----
const WALL_TEX = canvasTex(64, 56, (g, w, h) => {
  g.fillStyle = '#e6e0d4'; g.fillRect(0, 0, w, h); noise(g, w, h, 30, 2);
  for (const [cx, cy] of [[0, 0], [32, 0], [0, 28], [32, 28]]) {
    g.fillStyle = 'rgba(60,30,10,.18)'; g.fillRect(cx, cy + 25, 32, 3);
    const lit = Math.random() < 0.35;
    g.fillStyle = '#3a2a20'; g.fillRect(cx + 8, cy + 6, 16, 14);
    g.fillStyle = lit ? '#f5b64e' : '#2a3540'; g.fillRect(cx + 10, cy + 8, 12, 10);
    g.fillStyle = '#3a2a20'; g.fillRect(cx + 15, cy + 8, 2, 10);
  }
});
const ROOF_TEX = canvasTex(16, 16, (g, w, h) => { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h); noise(g, w, h, 36, 2); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, 0, w, 1); });
const wallMatV = lam({ map: WALL_TEX, vertexColors: true });
const roofMatV = lam({ map: ROOF_TEX, vertexColors: true });
const C = (h) => new THREE.Color(h);
const WALLC = WALLS.map(C), TILE = ['#9a4a2e', '#a85a34', '#8a3e28', '#7a4a3a'].map(C), FLAT = ['#77706a', '#8a8078', '#6a625c', '#5e5650'].map(C);
// shop-sign atlas (one texture, one merged mesh)
const SIGN_ROWS = SHOP_NAMES.length;
const signAtlas = canvasTex(128, 24 * SIGN_ROWS, (g, W) => { SHOP_NAMES.forEach((n, i) => { const [bg, fg] = SIGN_COLS[i % SIGN_COLS.length]; const y = i * 24; g.fillStyle = bg; g.fillRect(0, y, W, 24); g.fillStyle = fg; g.fillRect(2, y + 2, W - 4, 1); g.fillRect(2, y + 21, W - 4, 1); g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.fillText(n, W / 2, y + 17); }); });
signAtlas.minFilter = THREE.NearestFilter; signAtlas.generateMipmaps = false;
const BLD = MAP.bld.map((b) => { let cx = 0, cz = 0; const n = b.p.length / 2; for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; } return { ...b, cx: cx / n, cz: cz / n }; });
// landmark buildings: nearest footprint to each OSM landmark point
const LM = {}; for (const l of MAP.lm) LM[l.id] = l;
const LM_BLD = {};
for (const id of ['masjid', 'klenteng', 'stasiun', 'mall', 'plaza']) {
  const l = LM[id]; if (!l) continue; let best = null, bd = 45;
  for (const b of BLD) { const d = Math.hypot(b.cx - l.x, b.cz - l.z); if (d < bd) { bd = d; best = b; } }
  if (best) { LM_BLD[id] = best; best.lmk = id; }
}
const LM_STYLE = { masjid: { wall: '#eeeae0', roof: '#2f7a4a', h: 9 }, klenteng: { wall: '#b3262a', roof: '#c8552a', h: 7 }, stasiun: { wall: '#e8dcc0', roof: '#9a4a2a', h: 7 }, mall: { wall: '#cfcac0', roof: '#77706a', h: 16 }, plaza: { wall: '#d8d4cc', roof: '#77706a', h: 14 } };
{
  const chunks = new Map(); const signs = new GeoBuf();
  const chunk = (b) => { const k = `${Math.floor(b.cx / 200)},${Math.floor(b.cz / 200)}`; if (!chunks.has(k)) chunks.set(k, { w: new GeoBuf(), r: new GeoBuf() }); return chunks.get(k); };
  let hseed = 0;
  for (const b of BLD) {
    const p = b.p, n = p.length / 2, st = LM_STYLE[b.lmk];
    const r1 = ((hseed = (hseed * 9301 + 49297) % 233280) / 233280);
    const h = st ? Math.max(b.h, st.h) : b.h; b.hh = h;
    const wc = st ? C(st.wall) : WALLC[Math.floor(r1 * WALLC.length)];
    const ch = chunk(b), W = ch.w, R = ch.r;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], j = (i + 1) % n, bx = p[j * 2], bz = p[j * 2 + 1]; const L = Math.hypot(bx - ax, bz - az);
      const u0 = acc / 8, u1 = (acc + L) / 8; acc += L;
      const a0 = W.v(ax, 0, az, u0, 0, wc), b0 = W.v(bx, 0, bz, u1, 0, wc), a1 = W.v(ax, h, az, u0, h / 7, wc), b1 = W.v(bx, h, bz, u1, h / 7, wc);
      W.idx.push(a0, b1, b0, a0, a1, b1);
    }
    if (b.k === 0 && !st) { // hip roof: fan to an apex over the centroid
      const rc = TILE[Math.floor(r1 * 97) % TILE.length]; const area = Math.abs(n); const top = h + Math.min(2.2, 0.9 + Math.sqrt(b.h) * 0.3);
      const apex = R.v(b.cx, top, b.cz, b.cx / 3, b.cz / 3, rc);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; const a = R.v(p[i * 2], h, p[i * 2 + 1], p[i * 2] / 3, p[i * 2 + 1] / 3, rc), c = R.v(p[j * 2], h, p[j * 2 + 1], p[j * 2] / 3, p[j * 2 + 1] / 3, rc); R.upTri(a, c, apex); }
      b.hh = top;
    } else {
      const rc = st ? C(st.roof) : FLAT[Math.floor(r1 * 53) % FLAT.length];
      const contour = []; for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
      const base = R.n; for (let i = 0; i < n; i++) R.v(p[i * 2], h, p[i * 2 + 1], p[i * 2] / 4, p[i * 2 + 1] / 4, rc);
      for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) R.upTri(base + t[0], base + t[1], base + t[2]);
    }
    if (b.s !== undefined) { // shop sign on the edge that faces a main road
      const i = b.s, j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / L, uz = (bz - az) / L, ox = uz * 0.08, oz = -ux * 0.08; const sw = Math.min(L * 0.8, 7), mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const y = Math.min(4, h - 0.9), row = Math.floor(r1 * 1000) % SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS, v1 = 1 - row / SIGN_ROWS;
      const sa = [mx - ux * sw / 2 + ox, mz - uz * sw / 2 + oz], sb = [mx + ux * sw / 2 + ox, mz + uz * sw / 2 + oz];
      const a0 = signs.v(sa[0], y - 0.65, sa[1], 1, v0), b0 = signs.v(sb[0], y - 0.65, sb[1], 0, v0), a1 = signs.v(sa[0], y + 0.65, sa[1], 1, v1), b1 = signs.v(sb[0], y + 0.65, sb[1], 0, v1);
      signs.idx.push(a0, b1, b0, a0, a1, b1);
    }
    gctx.fillStyle = `rgb(255,${Math.min(255, Math.round(b.hh * 4))},0)`; gctx.beginPath(); polyPath(gctx, p); gctx.fill();
  }
  for (const { w, r } of chunks.values()) { w.mesh(wallMatV); r.mesh(roofMatV); }
  signs.mesh(lam({ map: signAtlas }));
}

/* ----- Texture Coffee (client café) ----- */
function buildCafe() {
  const x0 = 8, x1 = 32, z0 = 10, z1 = 27, h = 9; const w = x1 - x0, d = z1 - z0;
  const front = canvasTex(384, 144, (g, W, H) => {
    g.fillStyle = '#cdb898'; g.fillRect(0, 0, W, H); noise(g, W, H, 40, 3);
    // brick patches
    for (let i = 0; i < 9; i++) { const bx = Math.random() < 0.5 ? Math.random() * 60 : W - 60 + Math.random() * 40; const by = 20 + Math.random() * (H - 40); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.fillStyle = ['#8a4a2e', '#a35a36', '#6e3a24'][(Math.random() * 3) | 0]; g.fillRect(bx + c * 8 + (r % 2) * 4, by + r * 4, 7, 3); } }
    // upper windows
    for (const wx of [40, 150, 260]) { g.fillStyle = '#3a2618'; g.fillRect(wx, 8, 84, 40); g.fillStyle = '#1e1a18'; g.fillRect(wx + 4, 12, 76, 32); g.fillStyle = '#3a2618'; g.fillRect(wx + 40, 12, 3, 32); }
    // red emblem
    g.fillStyle = '#b3423a'; g.beginPath(); g.arc(W / 2, 74, 26, Math.PI, 0); g.fill();
    // ground floor: door + windows with warm interior
    const warm = (x, y, ww, hh) => { const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, '#6a3a1a'); gr.addColorStop(1, '#e7a14e'); g.fillStyle = '#2a1a10'; g.fillRect(x - 3, y - 3, ww + 6, hh + 3); g.fillStyle = gr; g.fillRect(x, y, ww, hh); g.fillStyle = '#4a2a14'; for (let s = y + 10; s < y + hh - 6; s += 12) g.fillRect(x + 4, s, ww - 8, 2); };
    warm(158, 92, 68, 52); warm(40, 96, 70, 34); warm(276, 96, 70, 34);
    // sign
    g.fillStyle = '#2b1c12'; g.fillRect(150, 80, 84, 11); g.fillStyle = '#f2e8d2'; g.font = 'bold 10px monospace'; g.textAlign = 'center'; g.fillText('TEXTURE COFFEE', 192, 89);
    // garage sale poster
    g.fillStyle = '#2a3c8a'; g.fillRect(240, 96, 22, 32); g.fillStyle = '#ffcf3a'; g.fillRect(242, 100, 18, 6); g.fillStyle = '#e23b3b'; g.fillRect(242, 108, 18, 10); g.fillStyle = '#fff'; g.fillRect(244, 120, 14, 5);
  });
  const sideTex = canvasTex(64, 64, (g, W, H) => { g.fillStyle = '#c4ad8c'; g.fillRect(0, 0, W, H); noise(g, W, H, 40, 3); });
  const sideM = lam({ map: sideTex });
  const cafe = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideM, sideM, roofMat, roofMat, sideM, lam({ map: front })]);
  cafe.position.set((x0 + x1) / 2, 0.25 + h / 2, (z0 + z1) / 2); scene.add(cafe); occluders.push(cafe);
  addSolid(x0, x1, z0, z1);
  // awning (corrugated)
  const aw = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.15, 2.6), lam({ color: '#5a4636' })); aw.position.set(20, 4.3, z0 - 1.2); aw.rotation.x = 0.16; scene.add(aw);
  // warm glow from door
  const glow = new THREE.PointLight('#ffa040', 6, 12, 1.5); glow.position.set(20, 2, z0 - 1.5); scene.add(glow);
  // crates, stools, cones
  const crateMat = lam({ color: '#c22a22' });
  const crate = (cx, cz, y = 0.25) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), crateMat); m.position.set(cx, y + 0.35, cz); scene.add(m); };
  crate(9.5, 9.2); crate(9.5, 9.2, 0.95); crate(10.6, 9.2); crate(29.5, 9.2); crate(30.6, 9.2); crate(30.6, 9.2, 0.95);
  addSolid(9, 11.1, 8.7, 9.7); addSolid(29, 31.1, 8.7, 9.7);
  const stoolMat = lam({ color: '#e8e4dc' });
  const stool = (sx, sz) => { const s = new THREE.Group(); const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), stoolMat); top.position.y = 0.7; s.add(top); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.07), stoolMat); l.position.set(a * 0.24, 0.35, b * 0.24); l.rotation.z = a * 0.06; s.add(l); } s.position.set(sx, 0.25, sz); scene.add(s); };
  stool(12.5, 8.6); stool(14, 9); stool(26.5, 8.8); stool(27.8, 8.5);
  const cone = (cx, cz) => { const c = new THREE.Group(); const a = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6), lam({ color: '#ff6a1a' })); a.position.y = 0.4; c.add(a); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 6), lam({ color: '#fff' })); b.position.y = 0.5; c.add(b); c.position.set(cx, groundY(cx, cz), cz); scene.add(c); };
  cone(14, 3.6); cone(26, 3.6);
  // OOT sign pole
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4, 0.15), lam({ color: '#555' })); pole.position.set(6.2, 2.25, 6.5); scene.add(pole);
  const signTex = canvasTex(64, 80, (g) => { g.fillStyle = '#f2e8d2'; g.fillRect(0, 0, 64, 80); g.strokeStyle = '#b3262a'; g.lineWidth = 5; g.beginPath(); g.ellipse(32, 34, 24, 18, 0, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#b3262a'; g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.fillText('OOT', 32, 41); g.font = 'bold 9px monospace'; g.fillText('GARAGE', 32, 66); g.fillText('SALE 11.11', 32, 76); });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 0.12), [lam({ color: '#ddd' }), lam({ color: '#ddd' }), lam({ color: '#ddd' }), lam({ color: '#ddd' }), lam({ map: signTex }), lam({ map: signTex })]);
  sign.position.set(6.2, 3.4, 6.4); scene.add(sign);
  addSolid(6, 6.4, 6.3, 6.7);
  // corrugated fence on left
  const fence = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 16), lam({ color: '#6b4a32' })); fence.position.set(6, 1.55, 19); scene.add(fence);
  // garage sale crate (merch) with real crate art on top
  const wood = lam({ color: '#a8803e' });
  const gcrate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), [wood, wood, lam({ map: T.crate }), wood, wood, wood]);
  gcrate.position.set(23.5, 0.65, 8.9); scene.add(gcrate); addSolid(22.8, 24.2, 8.2, 9.6);
}
{ // the café lot: raised pavement slab + the café itself
  const L = CAFE_LOT, w = L.x1 - L.x0, d = L.z1 - L.z0;
  const sw = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, 0.25, d), w, 0.25, d, 2, 2), sideMat); sw.position.set((L.x0 + L.x1) / 2, 0.125, (L.z0 + L.z1) / 2); scene.add(sw);
  buildCafe();
}

/* ----- landmarks at their real OSM positions ----- */
const textSign = (txt, bg, fg, w = 256, h = 40, font = 22) => lam({ map: canvasTex(w, h, (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.font = `bold ${font}px monospace`; g.textAlign = 'center'; g.fillText(txt, W / 2, H / 2 + font * 0.36); }) });
function label3D(txt, x, y, z, bg = '#1a1a1a', fg = '#ffcf3a', s = 1) { // floating landmark name (sprite, fogs out with distance)
  const W = 16 + txt.length * 13;
  const tex = canvasTex(W, 28, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, W, 28); g.fillStyle = bg; g.fillRect(2, 2, W - 4, 24); g.fillStyle = fg; g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.fillText(txt, W / 2, 20); });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false })); sp.scale.set(W / 28 * 2.2 * s, 2.2 * s, 1); sp.position.set(x, y, z); scene.add(sp); return sp;
}
function bigTree(x, z, s) { // beringin (banyan)
  const g = new THREE.Group(); const dark = lam({ color: '#2c4a22' });
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 4, 6), trunkMat); t.position.y = 2; g.add(t);
  for (const [a, b, c, r] of [[0, 5.5, 0, 1.6], [1.6, 5, 0.6, 1.1], [-1.5, 5.1, -0.4, 1.2], [0.3, 6.6, -0.8, 1.1], [-0.5, 4.8, 1.5, 1.0]]) { const l = new THREE.Mesh(leafGeo, dark); l.position.set(a, b, c); l.scale.set(r * 1.3, r * 0.8, r * 1.3); g.add(l); }
  g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g); gridBox(x, z, 1.6 * s, 1.6 * s, 0);
}
{
  const N = NORTH; // game-frame unit vector pointing north
  if (LM.alun) { const { x, z } = LM.alun; bigTree(x - N[1] * 9, z + N[0] * 9, 1.6); bigTree(x + N[1] * 9, z - N[0] * 9, 1.6); label3D('ALUN-ALUN KEDIRI', x, 13, z, '#1f5a32', '#fff'); }
  const mb = LM_BLD.masjid;
  if (mb) {
    const green = lam({ color: '#2f7a4a' }), white = lam({ color: '#eeeae0' });
    const area = Math.abs(mb.p.reduce((s, _, i, p) => (i % 2 ? s : s + p[i] * p[(i + 3) % p.length] - p[(i + 2) % p.length] * p[i + 1]), 0)) / 2;
    const r = clamp(Math.sqrt(area) * 0.28, 4, 9);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), green); dome.position.set(mb.cx, mb.hh, mb.cz); scene.add(dome);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2, 6), lam({ color: '#d8b04a' })); tip.position.set(mb.cx, mb.hh + r + 0.9, mb.cz); scene.add(tip);
    const k = 0; let mx = mb.p[k * 2], mz = mb.p[k * 2 + 1]; const dx = mb.cx - mx, dz = mb.cz - mz, dl = Math.hypot(dx, dz) || 1; mx += dx / dl * 3; mz += dz / dl * 3;
    const mn = new THREE.Mesh(new THREE.BoxGeometry(2.4, 26, 2.4), white); mn.position.set(mx, 13, mz); scene.add(mn);
    const md = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 8), green); md.position.set(mx, 27.7, mz); scene.add(md);
    const bc = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 3.2), white); bc.position.set(mx, 20, mz); scene.add(bc);
    gridBox(mx, mz, 2.4, 2.4, 26);
    label3D('MASJID AGUNG KEDIRI', mb.cx, mb.hh + r + 5, mb.cz, '#2f7a4a', '#fff');
  }
  const kb = LM_BLD.klenteng;
  if (kb) {
    const gold = lam({ color: '#e0b040' }), lantern = lam({ color: '#ff3a2a', emissive: '#661010' });
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 0.6), gold); ridge.position.set(kb.cx, kb.hh + 0.25, kb.cz); scene.add(ridge);
    for (const sx of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 4), gold); horn.position.set(kb.cx + sx * 5.2, kb.hh + 0.9, kb.cz); horn.rotation.z = -sx * 0.6; scene.add(horn); }
    for (let i = 0; i < kb.p.length; i += 2) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lantern); const dx = kb.cx - kb.p[i], dz = kb.cz - kb.p[i + 1], dl = Math.hypot(dx, dz) || 1; l.position.set(kb.p[i] - dx / dl * 0.6, kb.hh - 1, kb.p[i + 1] - dz / dl * 0.6); l.scale.y = 1.2; scene.add(l); }
    label3D('KLENTENG TJOE HWIE KIONG', kb.cx, kb.hh + 5, kb.cz, '#b3262a', '#ffd24a');
  } else if (LM.klenteng) label3D('KLENTENG TJOE HWIE KIONG', LM.klenteng.x, 10, LM.klenteng.z, '#b3262a', '#ffd24a');
  if (LM.stasiun) { const b = LM_BLD.stasiun; label3D('STASIUN KEDIRI', b ? b.cx : LM.stasiun.x, (b ? b.hh : 6) + 5, b ? b.cz : LM.stasiun.z, '#f2f2f2', '#1a2a6a'); }
  if (LM.mall) { const b = LM_BLD.mall; label3D('MALL', b ? b.cx : LM.mall.x, (b ? b.hh : 14) + 5, b ? b.cz : LM.mall.z, '#b3262a', '#fff', 1.6); }
  if (LM.plaza) { const b = LM_BLD.plaza; label3D('PLAZA', b ? b.cx : LM.plaza.x, (b ? b.hh : 12) + 5, b ? b.cz : LM.plaza.z, '#2a3c8a', '#ffcf3a', 1.4); }
  if (LM.jembatan) label3D('SUNGAI BRANTAS', LM.jembatan.x, 6, LM.jembatan.z, '#3f6470', '#fff');
}
finishGrid();

// ---- street + park trees (instanced; trunks block movement) ----
{
  const spots = [];
  const tryAdd = (x, z, s) => { if (spots.length < 1600 && freeAt(x, z, 1.4)) { spots.push([x, z, s]); const k = cellOf(x, z); OCC[k] = 1; } };
  for (const pk of MAP.parks) { // scatter inside park polygons
    const p = pk.p; if (pk.k) continue; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    const inPoly = (x, z) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { if ((p[i + 1] > z) !== (p[j + 1] > z) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; } return c; };
    const want = Math.min(45, (x1 - x0) * (z1 - z0) / 220);
    for (let k = 0; k < want * 3 && want > 0; k++) { const x = rr(x0, x1), z = rr(z0, z1); if (inPoly(x, z)) tryAdd(x, z, rr(0.9, 1.5)); }
  }
  for (const r of MAP.roads) { // roadside trees
    if (r.c > 5 || r.b) continue; const p = r.p;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz); if (L < 1) continue;
      for (let s = rr(4, 14); s < L; s += rr(14, 26)) {
        if (rand() > (r.c <= 3 ? 0.55 : 0.3)) continue;
        const sg = rand() < 0.5 ? 1 : -1, off = r.w / 2 + 1.7;
        tryAdd(ax + dx * s / L - dz / L * off * sg, az + dz * s / L + dx / L * off * sg, rr(0.8, 1.15));
      }
    }
  }
  const tr = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length), lf = new THREE.InstancedMesh(leafGeo, lam({ color: '#ffffff' }), spots.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), cols = ['#3f6b2a', '#56782e', '#2f5a2a', '#4a6a2a'].map(C);
  spots.forEach(([x, z, s], i) => {
    e.set(0, rand() * 6, 0); q.setFromEuler(e);
    tr.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 1.5 * s, z), q, new THREE.Vector3(s, s, s)));
    lf.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(x, 3.6 * s, z), q, new THREE.Vector3(1.2 * s, 0.9 * s, 1.2 * s)));
    lf.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(x + 0.5 * s, 4.5 * s, z + 0.2 * s), q, new THREE.Vector3(0.75 * s, 0.75 * s, 0.75 * s)));
    lf.setColorAt(i * 2, pick(cols)); lf.setColorAt(i * 2 + 1, pick(cols));
  });
  scene.add(tr, lf);
}

// ---- distant mountains (follow the camera like the sky): Klotok + Wilis to the west, Kelud to the east ----
{
  const mtn = (dirx, dirz, dist, side, r, h, col, top = 0.01) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, 7, 1), new THREE.MeshBasicMaterial({ color: col, fog: false })); m.position.set(dirx * dist - dirz * side, h / 2 - 4, dirz * dist + dirx * side); skyGroup.add(m); };
  const [wx, wz] = WEST;
  mtn(wx, wz, 380, 120, 190, 120, '#5a3a52'); mtn(wx, wz, 350, -60, 150, 95, '#664360');
  mtn(wx, wz, 250, -30, 55, 48, '#3e2a3c'); mtn(wx, wz, 260, 30, 40, 34, '#45303f');
  mtn(-wx, -wz, 380, 60, 160, 85, '#6a4458', 22);
}

// ---- collision: prop AABBs + the building/water grid ----
function collide(p, r) {
  let hit = false;
  for (const b of solids) {
    if (p.x + r < b.x0 || p.x - r > b.x1 || p.z + r < b.z0 || p.z - r > b.z1) continue;
    const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x += dx / d * (r - d); p.z += dz / d * (r - d); }
    else { // inside: push along smallest axis
      const l = p.x - b.x0, rt = b.x1 - p.x, f = p.z - b.z0, bk = b.z1 - p.z, m = Math.min(l, rt, f, bk);
      if (m === l) p.x = b.x0 - r; else if (m === rt) p.x = b.x1 + r; else if (m === f) p.z = b.z0 - r; else p.z = b.z1 + r;
    }
  }
  // grid cells (OSM frame)
  let [u, v] = toImg(p.x, p.z); const u0 = u, v0 = v;
  const solid = (i, j) => i < 0 || j < 0 || i >= GW || j >= GH || OCC[j * GW + i] === 1;
  if (solid(Math.floor(u), Math.floor(v))) { // stuck inside: hop to the nearest free cell
    let best = null;
    for (let rad = 1; rad < 12 && !best; rad++) for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
      const ci = Math.floor(u) + i, cj = Math.floor(v) + j; if (solid(ci, cj)) continue;
      const d = Math.hypot(ci + 0.5 - u, cj + 0.5 - v); if (!best || d < best[0]) best = [d, ci + 0.5, cj + 0.5];
    }
    if (best) { u = best[1]; v = best[2]; }
  }
  for (let j = Math.floor(v - r); j <= Math.floor(v + r); j++) for (let i = Math.floor(u - r); i <= Math.floor(u + r); i++) {
    if (!solid(i, j)) continue;
    const cx = clamp(u, i, i + 1), cz = clamp(v, j, j + 1), dx = u - cx, dz = v - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r || d2 < 1e-10) continue;
    const d = Math.sqrt(d2); u += dx / d * (r - d); v += dz / d * (r - d);
  }
  if (u !== u0 || v !== v0) { const [x, z] = toGame(u + CX0, v + CZ0); p.x = x; p.z = z; hit = true; }
  return hit;
}

// ---- names: roads, districts, landmarks ----
const ROAD_HASH = new Map();
for (const r of MAP.roads) {
  if (!r.n || r.c > 6) continue; const p = r.p;
  for (let i = 0; i < p.length - 2; i += 2) for (const k of new Set([`${Math.floor(p[i] / 25)},${Math.floor(p[i + 1] / 25)}`, `${Math.floor(p[i + 2] / 25)},${Math.floor(p[i + 3] / 25)}`])) { if (!ROAD_HASH.has(k)) ROAD_HASH.set(k, []); ROAD_HASH.get(k).push([p[i], p[i + 1], p[i + 2], p[i + 3], r.n, r.w]); }
}
const prettyRoad = (n) => n.replace(/^Jalan /i, 'Jl. ').replace(/Dokter /i, 'Dr. ');
function roadAt(x, z, maxD = 22) {
  let best = null, bd = maxD;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of ROAD_HASH.get(`${Math.floor(x / 25) + i},${Math.floor(z / 25) + j}`) || []) {
    const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1; const t = clamp(((x - s[0]) * dx + (z - s[1]) * dz) / L2, 0, 1);
    const d = Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t) - s[5] / 2; if (d < bd) { bd = d; best = s[4]; }
  }
  return best ? prettyRoad(MAP.names[best]) : null;
}
function roadNameAt(x, z) { return roadAt(x, z, 60) || 'gang kampung'; }
function districtAt(x, z) {
  const [ox, oz] = toOsm(x, z); const R = MAP.river; if (!R.length) return 'KOTA';
  let lo = 0, hi = R.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m][0] < oz) lo = m; else hi = m; }
  return ox < R[lo][1] ? 'MOJOROTO' : 'KOTA';
}

/* ---------------- characters ---------------- */
// skinned low-poly character: assets/oot_char.glb (generated by tools/build_char.py)
const cm = (opts) => new THREE.MeshLambertMaterial(opts);
const box = (w, h, d, mat, x = 0, y = 0, z = 0, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (parent) parent.add(m); return m; };
const charGLTF = await new GLTFLoader(loadMgr).loadAsync('assets/oot_char.glb');
const CHAR_MATS = {};
charGLTF.scene.traverse((n) => {
  if (!n.isMesh) return;
  const src = n.material;
  let m = CHAR_MATS[src.name];
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: src.map, color: src.color.clone(), transparent: src.transparent, opacity: src.opacity, side: src.side });
    if (m.map) m.map.magFilter = THREE.NearestFilter;
    m.name = src.name; CHAR_MATS[src.name] = m;
  }
  n.material = m; n.frustumCulled = false;
});

// o: { shirt: '#hex' (plain colour, no print), shorts: '#hex' tint, skin: number tint, hair: '#hex', carry: material, glasses: bool }
// headwear, parented to the head bone (head-local coords: bone at y 1.74, crown top ~ +0.24)
function makeHat(type, col, head) {
  const g = new THREE.Group(), m = cm({ color: col });
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); me.scale.set(sx, sy, sz); g.add(me); return me; };
  const dome = (r) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  if (type === 'peci') { // black songkok
    add(new THREE.CylinderGeometry(0.094, 0.098, 0.115, 12), m, 0, 0.2, 0.004, 1, 1, 1.1);
  } else if (type === 'bucket') {
    add(new THREE.CylinderGeometry(0.085, 0.1, 0.1, 12), m, 0, 0.205, 0.004, 1, 1, 1.08);
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 14), m, 0, 0.152, 0.004, 1, 1, 1.05);
  } else if (type === 'cap' || type === 'snap') { // snap = worn backwards
    add(dome(0.102), m, 0, 0.125, 0.002, 1, 0.95, 1.08);
    const bz = type === 'snap' ? -0.15 : 0.15;
    add(new THREE.BoxGeometry(0.16, 0.014, 0.1), m, 0, 0.14, bz).rotation.x = (type === 'snap' ? -1 : 1) * 0.12;
    if (type === 'snap') add(new THREE.BoxGeometry(0.07, 0.03, 0.01), cm({ color: '#f2efe6' }), 0, 0.21, 0.11); // OOT tag on the front
  } else if (type === 'helmet') {
    add(dome(0.135), m, 0, 0.1, 0.0, 1, 1.05, 1.1);
    add(new THREE.BoxGeometry(0.22, 0.05, 0.02), cm({ color: '#1a1a1e', transparent: true, opacity: 0.85 }), 0, 0.07, 0.15);
  }
  head.add(g);
  return g;
}
function makeChar(o = {}) {
  const g = new THREE.Group();
  const model = SkeletonUtils.clone(charGLTF.scene); g.add(model);
  const b = {}, mesh = {};
  model.traverse((n) => { if (n.isBone) b[n.name] = n; else if (n.name) mesh[n.name] = n; });
  const tint = (name, f) => { const m = mesh[name]; if (!m || !m.isMesh) return; m.material = m.material.clone(); f(m.material); m.material.needsUpdate = true; };
  if (o.shirt) tint('shirt', (m) => { m.map = null; m.color.set(o.shirt); });
  if (o.shorts) tint('shorts', (m) => m.color.set(o.shorts));
  if (o.skin) tint('body_skin', (m) => m.color.setScalar(o.skin));
  if (o.hair) tint('hair', (m) => m.color.set(o.hair));
  const parts = {
    legL: b.hip_L, legR: b.hip_R, kneeL: b.knee_L, kneeR: b.knee_R, armL: b.shoulder_L, armR: b.shoulder_R,
    elbowL: b.elbow_L, elbowR: b.elbow_R, torso: b.spine, pelvis: b.pelvis, head: b.head,
    glasses: mesh.glasses, shirt: mesh.shirt, shorts: mesh.shorts, pelvisY: b.pelvis.position.y,
  };
  parts.glasses.visible = !!o.glasses;
  // the hair shell reads as a beanie under the sky light; the buzz cut painted on the skin texture looks closer to the key art
  if (mesh.hair) mesh.hair.visible = false;
  // body build: { h: height scale, w: width scale }
  if (o.build) model.scale.set(o.build.w, o.build.h, o.build.w);
  if (o.hat) parts.hat = makeHat(o.hat, o.hatCol || '#222', b.head);
  if (o.carry) { const c = box(0.6, 0.45, 0.45, o.carry, 0, 1.15, 0.4, g); parts.carry = c; }
  // blob shadow
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.04; g.add(sh);
  return { group: g, parts, phase: Math.random() * 6 };
}
function animChar(c, speed, dt, mode = 'walk') {
  const p = c.parts;
  p.head.rotation.set(0, 0, 0);
  if (mode === 'ride') {
    p.legL.rotation.x = p.legR.rotation.x = -1.35; p.kneeL.rotation.x = p.kneeR.rotation.x = 1.45;
    p.armL.rotation.x = p.armR.rotation.x = -0.95; p.elbowL.rotation.x = p.elbowR.rotation.x = -0.45;
    p.torso.rotation.set(0.12, 0, 0); p.pelvis.position.y = p.pelvisY; return;
  }
  c.phase += dt * (2 + speed * 1.15);
  const th = c.phase, sn = Math.sin(th), PI = Math.PI;
  const amp = clamp(speed / 6, 0, 1) * 0.8;
  const rb = clamp((speed - 4.6) / 3, 0, 1);              // 0 = walk, 1 = full sprint
  const L = (a, b) => a + (b - a) * rb;
  const kick = (ph) => Math.max(0, Math.sin(ph - 0.3));   // heel flicks up behind after push-off
  // legs: long stride, rear knee folds high, front leg reaches
  p.legL.rotation.x = L(sn * amp, sn * 1.0 - 0.12);
  p.legR.rotation.x = L(-sn * amp, -sn * 1.0 - 0.12);
  p.kneeL.rotation.x = L(amp * (0.15 + Math.max(0, Math.sin(th - 0.9)) * 1.25), 0.3 + 1.75 * kick(th));
  p.kneeR.rotation.x = L(amp * (0.15 + Math.max(0, Math.sin(th + PI - 0.9)) * 1.25), 0.3 + 1.75 * kick(th + PI));
  // arms: pumping, elbows bent ~90 degrees when running
  p.armL.rotation.x = L(-sn * amp * 0.85, -sn * 0.95 - 0.25);
  p.armR.rotation.x = L(sn * amp * 0.85, sn * 0.95 - 0.25);
  p.elbowL.rotation.x = L(-0.12 - amp * (0.3 + Math.max(0, -sn) * 0.6), -1.3 - 0.4 * Math.max(0, sn));
  p.elbowR.rotation.x = L(-0.12 - amp * (0.3 + Math.max(0, sn) * 0.6), -1.3 - 0.4 * Math.max(0, -sn));
  if (p.carry) { p.armL.rotation.x = p.armR.rotation.x = -0.9; p.elbowL.rotation.x = p.elbowR.rotation.x = -0.6; }
  p.torso.rotation.set(L(amp * 0.12, 0.3), L(sn * amp * 0.12, sn * 0.18), 0);
  p.pelvis.position.y = p.pelvisY + L(Math.abs(Math.cos(th)) * amp * 0.05, Math.abs(Math.cos(th)) * 0.1 - 0.05);
  p.head.rotation.set(-0.24 * rb, -sn * amp * 0.08, 0);
}

// player look: plain white tee until the first mission, then the OOT jersey (texture baked in the glb)
const jerseyMap = CHAR_MATS.shirt.map;
const teeMap = canvasTex(32, 32, (g, w, h) => { g.fillStyle = '#e9e7e2'; g.fillRect(0, 0, w, h); noise(g, w, h, 22, 2); });
// main character: bare head + short hair (as in the OOT key art), floating marker so he never blends into the crowd
const player = makeChar({ build: { h: 1.03, w: 1.02 } });
player.parts.shirt.material = player.parts.shirt.material.clone();
player.parts.shorts.material = player.parts.shorts.material.clone();
scene.add(player.group);
const playerMarker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshBasicMaterial({ color: '#ffcc33' }));
playerMarker.rotation.x = Math.PI; player.group.add(playerMarker);
function applyOutfit() {
  const j = !!save.done.kopi || !!save.done.poster || !!save.done.copet;
  player.parts.shirt.material.map = j ? jerseyMap : teeMap; player.parts.shirt.material.needsUpdate = true;
  player.parts.shorts.material.color.setScalar(j ? 1 : 1.75); // white baggy shorts with the plain tee
  player.parts.glasses.visible = Object.keys(save.done).length >= 3;
}
applyOutfit();

const P = { pos: new THREE.Vector3(20, 0, 4.4), vy: 0, heading: 0, speed: 0, onBike: false, grounded: true, knock: 0,
  hp: 100, down: 0, fall: 0, kx: 0, kz: 0, lastHit: -99, fainted: false };
player.group.rotation.order = 'YXZ';

/* ---------------- road graph: agents walk / ride along the real streets ---------------- */
const GV = MAP.graph.v, GEI = MAP.graph.e;
const vx = (i) => GV[i * 2], vz = (i) => GV[i * 2 + 1];
const ADJ = Array.from({ length: GV.length / 2 }, () => []), EDGES = [];
for (let i = 0; i < GEI.length; i += 3) {
  const a = GEI[i], b = GEI[i + 1], c = GEI[i + 2], L = Math.hypot(vx(b) - vx(a), vz(b) - vz(a)); if (L < 0.05) continue;
  const e = { a, b, c, L, w: CLS_W[c], mx: (vx(a) + vx(b)) / 2, mz: (vz(a) + vz(b)) / 2 }; EDGES.push(e); ADJ[a].push(e); ADJ[b].push(e);
}
function edgesNear(maxC, rMin, rMax, cx = P.pos.x, cz = P.pos.z) { return EDGES.filter((e) => { if (e.c > maxC) return false; const d = Math.hypot(e.mx - cx, e.mz - cz); return d >= rMin && d <= rMax; }); }
function placeOnEdge(ag, e, from) { ag.e = e; ag.from = from ?? (Math.random() < 0.5 ? e.a : e.b); ag.s = Math.random() * e.L; }
function advance(ag, d, maxC, pickFn) { // move along the graph; no U-turn unless it's a dead end
  ag.s += d; let guard = 0;
  while (ag.s >= ag.e.L && guard++ < 8) {
    ag.s -= ag.e.L; const node = ag.e.a === ag.from ? ag.e.b : ag.e.a;
    let opts = ADJ[node].filter((e) => e !== ag.e && e.c <= maxC); if (!opts.length) opts = [ag.e];
    ag.e = pickFn ? pickFn(opts, node) : opts[Math.floor(Math.random() * opts.length)]; ag.from = node;
  }
}
function agentPos(ag, off = 0) { // off > 0 = left of travel direction (Indonesia keeps left)
  const e = ag.e, to = e.a === ag.from ? e.b : e.a, ax = vx(ag.from), az = vz(ag.from), dx = (vx(to) - ax) / e.L, dz = (vz(to) - az) / e.L, t = Math.min(ag.s, e.L);
  return [ax + dx * t + dz * off, az + dz * t - dx * off, Math.atan2(dx, dz)];
}
function respawnAgent(ag, maxC, rMin, rMax) { const pool = edgesNear(maxC, rMin, rMax); if (!pool.length) return false; placeOnEdge(ag, pool[Math.floor(Math.random() * pool.length)]); ag.h = null; return true; }

/* ---------------- motorbikes ---------------- */
function makeBikeMesh(col) {
  const b = new THREE.Group(), body = lam({ color: col }), dark = lam({ color: '#1e1e22' }), red = lam({ color: '#b3262a' });
  box(0.42, 0.42, 1.5, body, 0, 0.6, -0.05, b);
  box(0.5, 0.16, 0.7, dark, 0, 0.88, -0.25, b);
  box(0.36, 0.55, 0.2, body, 0, 0.75, 0.62, b);
  box(0.9, 0.08, 0.08, dark, 0, 1.15, 0.62, b);
  box(0.2, 0.1, 0.06, lam({ color: '#ffe9a0', emissive: '#ffcc55' }), 0, 1.0, 0.74, b);
  box(0.44, 0.08, 0.3, red, 0, 0.4, -0.75, b);
  const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 8); wg.rotateZ(Math.PI / 2);
  for (const z of [-0.62, 0.68]) { const w = new THREE.Mesh(wg, dark); w.position.set(0, 0.3, z); b.add(w); }
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.9), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.04; b.add(sh);
  return b;
}
const bikes = [];
function addBike(x, z, heading, col) {
  const bk = { group: makeBikeMesh(col), pos: new THREE.Vector3(x, groundY(x, z), z), heading, speed: 0, lean: 0 };
  scene.add(bk.group); bikes.push(bk); return bk;
}
let bike = addBike(33, 6.5, Math.PI / 2, '#e9e6e0'); // the white one next to Texture Coffee
MAP.bikes.forEach(([x, z, h], i) => addBike(x, z, h, ['#b3262a', '#2a2a2a', '#3c5a8a', '#d8b04a', '#e9e6e0', '#4a7a4a'][i % 6]));

/* ---------------- NPC pedestrians ---------------- */
const npcs = [];
const npcShirts = ['#3c5a8a', '#8a3c3c', '#d8b04a', '#4a7a4a', '#222', '#c86a2a', '#6a4a8a', '#ddd', '#5a7a8a', '#9a6a8a', '#7a6a4a'];
// random NPC: varied height/build, skin, hair colour, headwear (never the player's red snapback)
function npcLook(hat, shorts) {
  const hatCol = hat === 'peci' ? '#151515' : pick(['#2a2a2a', '#3c5a8a', '#e9e6e0', '#4a7a4a', '#9a8a70', '#d8b04a']);
  return {
    shirt: pick(npcShirts), shorts, skin: pick([0.75, 0.9, 1, 1.25, 1.55]),
    hair: pick(['#111', '#1d1510', '#2a1d14', '#555', '#888']),
    build: { h: rr(0.9, 1.04), w: rr(0.9, 1.15) },
    hat: hat || undefined, hatCol, glasses: rand() < 0.12,
  };
}
const PED = { maxC: 6, far: 120, r0: 20, r1: 90 };
for (let i = 0; i < 30; i++) {
  const c = makeChar(npcLook(pick(['', '', 'peci', 'bucket', 'cap']), pick(['#556070', '#777', '#9a8a70', '#4a4a4a', '#fff'])));
  scene.add(c.group);
  const n = { c, spd: rr(1.1, 1.6), side: rand() < 0.5 ? 1 : -1 }; respawnAgent(n, PED.maxC, 0, PED.r1); npcs.push(n);
}

/* ---------------- traffic ---------------- */
const cars = [];
const carCols = ['#c9c4b8', '#8a2a22', '#2a3c5a', '#d8b04a', '#3a3a3a', '#5a6a4a'];
const CAR = { maxC: 3, far: 170, r0: 60, r1: 150 }, RIDER = { maxC: 5, far: 170, r0: 60, r1: 150 };
for (let i = 0; i < 12; i++) {
  const g = new THREE.Group(); const col = lam({ color: carCols[i % carCols.length] }); const dark = lam({ color: '#1a1a1e' }); const glass = lam({ color: '#33424e' });
  box(1.9, 0.75, 4, col, 0, 0.6, 0, g); box(1.7, 0.6, 2.1, glass, 0, 1.25, -0.2, g); box(1.72, 0.08, 2.0, col, 0, 1.58, -0.2, g);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.25, 0.5, 0.6, dark, a * 0.9, 0.25, b * 1.3, g);
  box(1.4, 0.15, 0.05, lam({ color: '#ffe9a0', emissive: '#ffcc55' }), 0, 0.7, 2.01, g);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.04; g.add(sh);
  scene.add(g);
  const car = { g, spd: rr(9, 13) }; respawnAgent(car, CAR.maxC, 0, CAR.r1); cars.push(car);
}
// NPC motorbike riders
const riders = [];
for (let i = 0; i < 12; i++) {
  const g = makeBikeMesh(['#2a2a2a', '#b3262a', '#3c5a8a', '#d8b04a', '#e9e6e0', '#4a7a4a'][i % 6]); scene.add(g);
  const c = makeChar(npcLook(rand() < 0.75 ? 'helmet' : 'cap', pick(['#556070', '#777', '#9a8a70', '#4a4a4a'])));
  scene.add(c.group);
  const r = { g, c, spd: rr(8, 12) }; respawnAgent(r, RIDER.maxC, 0, RIDER.r1); riders.push(r);
}

/* ---------------- coins ---------------- */
const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12); coinGeo.rotateX(Math.PI / 2);
const coinMat = [lam({ color: '#e0a820', emissive: '#553300' }), lam({ map: T.coin, emissive: '#331a00' }), lam({ map: T.coin, emissive: '#331a00' })];
const COIN_POOL_NEAR = edgesNear(5, 0, 350, CAFE.x, CAFE.z), COIN_POOL_ALL = EDGES.filter((e) => e.c <= 5);
function pointOnEdge(e, spread = 0.5) {
  const t = rand(), ax = vx(e.a), az = vz(e.a), bx = vx(e.b), bz = vz(e.b), o = (rand() - 0.5) * e.w * spread;
  return [ax + (bx - ax) * t - (bz - az) / e.L * o, az + (bz - az) * t + (bx - ax) / e.L * o];
}
for (let i = 0; i < 80; i++) {
  const [x, z] = pointOnEdge(pick(i % 2 ? COIN_POOL_ALL : COIN_POOL_NEAR));
  const m = new THREE.Mesh(coinGeo, coinMat); m.position.set(x, groundY(x, z) + 1, z); scene.add(m);
  coins.push({ m, t: 0 });
}

/* ---------------- missions ---------------- */
const MISSIONS = {
  kopi: { name: 'Antar Kopi Texture', desc: 'Pelanggan pesan kopi dari Texture Coffee. Antar sebelum waktu habis! Naik motor biar cepat.', pos: [15.5, 7.2], letter: 'K' },
  poster: { name: 'Sebar Poster Garage Sale', desc: 'Antar & tempel 4 poster GARAGE SALE 11.11 OOT ke papan pengumuman (titik merah) sebelum waktu habis. Habis itu posternya bisa kamu lihat & download.', pos: [26.8, 6.6], letter: 'P' },
  copet: { name: 'Kejar Copet!', desc: 'Ada copet bawa kabur box merch OOT! Kejar dan tangkap dia sebelum kabur.', pos: MAP.copet, letter: 'C' },
};
const markerTex = {};
for (const [id, m] of Object.entries(MISSIONS)) {
  markerTex[id] = canvasTex(32, 32, (g) => { g.fillStyle = '#ffcf3a'; g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = 'bold 20px monospace'; g.textAlign = 'center'; g.fillText(m.letter, 16, 23); });
  const grp = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffcf3a', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  cyl.position.y = 0.8; grp.add(cyl);
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex[id], depthTest: true })); icon.position.y = 2.6; icon.scale.setScalar(0.9); grp.add(icon);
  grp.position.set(m.pos[0], groundY(m.pos[0], m.pos[1]), m.pos[1]); scene.add(grp);
  m.marker = grp; m.icon = icon;
}
const checkpointMat = new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const cpGeo = new THREE.CylinderGeometry(1.6, 1.6, 3, 16, 1, true);
function makeCheckpoint(x, z) { const m = new THREE.Mesh(cpGeo, checkpointMat); m.position.set(x, groundY(x, z) + 1.5, z); scene.add(m); return m; }
// direction arrow above player
const arrow = new THREE.Mesh((() => { const g = new THREE.ConeGeometry(0.28, 0.7, 4); g.rotateX(Math.PI / 2); return g; })(), new THREE.MeshBasicMaterial({ color: '#ff3a2a' }));
arrow.visible = false; scene.add(arrow);

/* ---------------- partner coffee shops (Supabase game_places, see supabase/places.sql) ---------------- */
// Admin adds rows (name, instagram, address, lat/lon). Each one inside the map gets a teal marker on the
// kerb in front of the shop; walking into it opens a card with the address + Instagram + Google Maps.
const GEO = { lat0: -7.81925, lon0: 112.01125, kz: 110540 }; // same frame as tools/build_kediri.py
GEO.kx = 111320 * Math.cos(GEO.lat0 * Math.PI / 180);
const latLonToGame = (lat, lon) => toGame((lon - GEO.lon0) * GEO.kx, -(lat - GEO.lat0) * GEO.kz);
function kerbFront(x, z) {
  let best = null;
  for (const r of MAP.roads) {
    if (r.c > 6) continue; const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), fx = ax + dx * t, fz = az + dz * t, d = Math.hypot(x - fx, z - fz);
      if (!best || d < best.d) best = { d, fx, fz, dx, dz, w: r.w };
    }
  }
  if (!best || best.d > 80) return [x, z];
  let ux = x - best.fx, uz = z - best.fz, m = Math.hypot(ux, uz);
  if (m < 0.5) { m = Math.hypot(best.dx, best.dz) || 1; ux = -best.dz; uz = best.dx; } // pin on the road: pick a side
  const off = best.w / 2 + 1.8; let px = best.fx + ux / m * off, pz = best.fz + uz / m * off;
  // keep clear of the mission markers
  const along = Math.hypot(best.dx, best.dz) || 1;
  for (let k = 0; k < 6 && Object.values(MISSIONS).some((mm) => Math.hypot(mm.pos[0] - px, mm.pos[1] - pz) < 3); k++) { px += best.dx / along * 1.5; pz += best.dz / along * 1.5; }
  return [px, pz];
}
const placeTex = canvasTex(32, 32, (g) => {
  g.fillStyle = '#13877f'; g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#fff'; g.fillRect(9, 12, 11, 10); g.fillRect(8, 22, 13, 2); // cup + saucer
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(21, 16, 3, -1.4, 1.4); g.stroke();
  g.fillStyle = '#5a3a1e'; g.fillRect(10, 13, 9, 3);
});
const placeCylMat = new THREE.MeshBasicMaterial({ color: '#2ad1c2', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const placeCylGeo = new THREE.CylinderGeometry(1.1, 1.1, 1.6, 16, 1, true);
const PLACES = [];
let placeOpen = null, placeSuppress = null;
async function loadPlaces() {
  if (!NET?.places) return;
  let rows; try { rows = await NET.places(); } catch (e) { console.warn('places', e); return; }
  for (const r of rows || []) {
    const [gx, gz] = latLonToGame(r.lat, r.lon); const [ox, oz] = toOsm(gx, gz);
    if (ox < CX0 || ox > CX1 || oz < CZ0 || oz > CZ1) continue; // outside the playable map
    const [x, z] = kerbFront(gx, gz);
    const grp = new THREE.Group();
    const cyl = new THREE.Mesh(placeCylGeo, placeCylMat); cyl.position.y = 0.8; grp.add(cyl);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: placeTex })); icon.position.y = 2.6; icon.scale.setScalar(0.9); grp.add(icon);
    grp.position.set(x, groundY(x, z), z); scene.add(grp);
    PLACES.push({ ...r, x, z, marker: grp, icon });
  }
}
function openPlace(pl) {
  placeOpen = pl;
  $('plName').textContent = pl.name;
  $('plAddr').textContent = pl.address || roadNameAt(pl.x, pl.z);
  $('plIg').classList.toggle('hidden', !pl.instagram);
  if (pl.instagram) { $('plIg').href = `https://www.instagram.com/${encodeURIComponent(pl.instagram)}/`; $('plIgName').textContent = '@' + pl.instagram; }
  $('plMaps').href = `https://www.google.com/maps/search/?api=1&query=${pl.lat},${pl.lon}`;
  $('placeCard').classList.remove('hidden');
  if (P.onBike) bike.speed = 0;
  NET?.placeHit(pl.id, 'view');
}
function closePlace() { $('placeCard').classList.add('hidden'); placeSuppress = placeOpen; placeOpen = null; }
$('plClose').onclick = closePlace;
$('plIg').addEventListener('click', () => { if (placeOpen) NET?.placeHit(placeOpen.id, 'ig'); });
$('plMaps').addEventListener('click', () => { if (placeOpen) NET?.placeHit(placeOpen.id, 'maps'); });
function updatePlaces() {
  let inside = null;
  for (const pl of PLACES) {
    pl.marker.visible = !active;
    pl.icon.position.y = 2.6 + Math.sin(clock.elapsedTime * 3 + 1) * 0.15;
    if (!active && Math.hypot(pl.x - P.pos.x, pl.z - P.pos.z) < 1.4) inside = pl;
  }
  if (inside && inside !== placeSuppress && !placeOpen && !promptFor) openPlace(inside);
  if (!inside) placeSuppress = null;
}
loadPlaces();

/* ---------------- posters (notice boards around town) ---------------- */
const POSTERS = [
  { title: 'Garage Sale 11.11 — Up to 50% Off', file: 'assets/poster_garage.jpg', dl: 'OOT-Garage-Sale-11.11.jpg', aspect: 1414 / 2000 },
  { title: 'Garage Sale 11.11 — Story', file: 'assets/poster_story.jpg', dl: 'OOT-Garage-Sale-11.11-Story.jpg', aspect: 1080 / 1920 },
  { title: 'OutOfTex — Koran Garage Sale', file: 'assets/poster_koran.jpg', dl: 'OutOfTex-Garage-Sale-Koran.jpg', aspect: 1414 / 2000 },
];
for (const po of POSTERS) { po.tex = texLoader.load(po.file); po.tex.colorSpace = THREE.SRGBColorSpace; po.mat = new THREE.MeshBasicMaterial({ map: po.tex }); }
const blankPosterMat = lam({ map: canvasTex(32, 48, (g, w, h) => { g.fillStyle = '#d9cfb8'; g.fillRect(0, 0, w, h); noise(g, w, h, 25, 2); g.fillStyle = '#8a7a5a'; g.font = 'bold 6px monospace'; g.textAlign = 'center'; g.fillText('TEMPEL', w / 2, h / 2 - 2); g.fillText('DI SINI', w / 2, h / 2 + 6); }) });
// [x, z, facing yaw] at real kerbsides around town, facing the road. Spot 0 = in front of Texture Coffee (always has a poster)
const POSTER_SPOTS = MAP.posters;
save.posters = save.posters || {};
const woodMat = lam({ color: '#5a3b24' });
function setBoard(b, idx) {
  b.poster = idx;
  if (idx < 0) { b.face.material = blankPosterMat; b.face.scale.set(1.2, 1.7, 1); return; }
  const po = POSTERS[idx]; b.face.material = po.mat; b.face.scale.set(Math.min(1.25, 1.75 * po.aspect), 1.75, 1);
}
const boards = POSTER_SPOTS.map(([x, z, yaw], i) => {
  const g = new THREE.Group(); const y0 = groundY(x, z);
  for (const s of [-0.62, 0.62]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.5, 0.1), woodMat); post.position.set(s, 1.25, -0.06); g.add(post); }
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.36, 1.92, 0.06), woodMat); back.position.set(0, 1.55, -0.04); g.add(back);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.3), woodMat); roof.position.set(0, 2.55, 0); g.add(roof);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blankPosterMat); face.position.set(0, 1.55, 0.005); g.add(face);
  g.position.set(x, y0, z); g.rotation.y = yaw; scene.add(g);
  const b = { g, face, x, z, nx: Math.sin(yaw), nz: Math.cos(yaw), poster: -1 };
  setBoard(b, i === 0 ? 0 : (save.posters[i] ?? -1));
  return b;
});
let nearBoard = null;
function updatePosterNear() {
  nearBoard = null;
  if (!P.onBike && P.down <= 0) {
    for (const b of boards) {
      if (b.poster < 0) continue;
      const fx = b.x + b.nx * 1.2, fz = b.z + b.nz * 1.2;
      if (Math.hypot(fx - P.pos.x, fz - P.pos.z) < 2.2) { nearBoard = b; break; }
    }
  }
  $('btnPoster').classList.toggle('hidden', !nearBoard || paused());
}
let pvIdx = 0;
function openPoster(idx) {
  pvIdx = (idx + POSTERS.length) % POSTERS.length; const po = POSTERS[pvIdx];
  $('pvTitle').textContent = po.title; $('pvImg').src = po.file;
  $('pvDl').href = po.file; $('pvDl').download = po.dl;
  $('pvCount').textContent = `${pvIdx + 1}/${POSTERS.length}`;
  $('posterView').classList.remove('hidden');
  for (const k in keys) keys[k] = false;
}

let active = null;      // running mission
let promptFor = null;   // mission id being offered
let suppress = null;    // marker you declined (until you step away)
let thief = null;

function startMission(id) {
  sfx('whoosh', 0.7);
  const m = MISSIONS[id];
  if (id === 'kopi') {
    let pool = edgesNear(5, 120, 380); if (!pool.length) pool = edgesNear(5, 60, 600);
    const [x, z] = pointOnEdge(pick(pool), 0.3); const d = Math.hypot(x - P.pos.x, z - P.pos.z);
    active = { id, time: Math.round(d / 4 + 25), targets: [{ x, z, m: makeCheckpoint(x, z) }], info: `Antar ke pelanggan di ${roadNameAt(x, z)}` };
  } else if (id === 'poster') {
    // empty boards first, refill used ones once the whole town is covered
    const dP = (b) => Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
    const empty = boards.slice(1).filter((b) => b.poster < 0), used = boards.slice(1).filter((b) => b.poster >= 0);
    const pickFrom = [...empty.sort((a, b) => dP(a) - dP(b)), ...used.sort((a, b) => dP(a) - dP(b))].slice(0, 4);
    // time from a greedy route through the 4 boards
    let D = 0, cx = P.pos.x, cz = P.pos.z; const left = [...pickFrom];
    while (left.length) { left.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)); const b = left.shift(); D += Math.hypot(b.x - cx, b.z - cz); cx = b.x; cz = b.z; }
    const t = pickFrom.map((b, i) => { const x = b.x + b.nx * 1.4, z = b.z + b.nz * 1.4; return { x, z, m: makeCheckpoint(x, z), board: b, design: i % POSTERS.length }; });
    active = { id, time: Math.round(D * 1.35 / 9 + 35), targets: t, info: 'Poster tertempel: 0/4' };
  } else if (id === 'copet') {
    const c = makeChar({ shirt: '#7a1c1c', shorts: '#444', carry: cm({ map: T.crate }), hair: '#111' });
    scene.add(c.group);
    // start on a street 15-40 m away, heading away from the player
    let pool = edgesNear(6, 15, 40); if (!pool.length) pool = edgesNear(6, 0, 80);
    const e = pick(pool), far = Math.hypot(vx(e.a) - P.pos.x, vz(e.a) - P.pos.z) > Math.hypot(vx(e.b) - P.pos.x, vz(e.b) - P.pos.z) ? e.a : e.b;
    thief = { c, spd: 7.4 }; placeOnEdge(thief, e, far === e.a ? e.b : e.a);
    active = { id, time: 70, targets: [], info: 'Tangkap si copet!' };
  }
  active.name = m.name;
  $('missionBar').classList.remove('hidden');
  $('missionTitle').textContent = m.name;
  big(m.name.toUpperCase(), '', false, 1800);
  for (const mm of Object.values(MISSIONS)) mm.marker.visible = false;
}
const thiefPick = (opts, node) => { // run toward whichever street leads furthest from the player
  let best = opts[0], bs = -1e9;
  for (const e of opts) { const o = e.a === node ? e.b : e.a; const s = Math.hypot(vx(o) - P.pos.x, vz(o) - P.pos.z) + Math.random() * 25; if (s > bs) { bs = s; best = e; } }
  return best;
};
function endMission(ok) {
  const id = active.id;
  for (const t of active.targets) scene.remove(t.m);
  if (thief) { scene.remove(thief.c.group); thief = null; }
  active = null; arrow.visible = false;
  $('missionBar').classList.add('hidden');
  for (const mm of Object.values(MISSIONS)) mm.marker.visible = true;
  suppress = id;
  if (ok) {
    const firstTime = !save.done[id];
    save.done[id] = (save.done[id] || 0) + 1; persist();
    const got = earn(CONFIG.REWARD[id]);
    sfx('buy', 0.8);
    big('MISI BERHASIL!', got > 0 ? `+${got} KOIN OOT` : 'Batas koin harian tercapai', false, 3200);
    const n = Object.keys(save.done).length;
    if (firstTime && n === 1) setTimeout(() => toast('Unlocked: Jersey OOT "de Vivre" — karaktermu sekarang pakai jersey!'), 3300);
    if (firstTime && n === 3) setTimeout(() => toast('Unlocked: Kacamata "For Life" — semua misi selesai!'), 3300);
    applyOutfit();
  } else {
    big('MISI GAGAL', 'Coba lagi di penanda kuning', true, 2600);
  }
}
function updateMission(dt) {
  if (!active) return;
  active.time -= dt;
  const t = Math.max(0, Math.ceil(active.time));
  $('missionTimer').textContent = `${String(Math.floor(t / 60)).padStart(1, '0')}:${String(t % 60).padStart(2, '0')}`;
  $('missionTimer').style.color = t <= 10 ? '#ff5a4a' : '#fff';
  const reach = P.onBike ? 2.4 : 1.8;
  let target = null, bestD = 1e9;
  for (const tg of active.targets) {
    if (tg.done) continue;
    tg.m.rotation.y += dt;
    const d = Math.hypot(tg.x - P.pos.x, tg.z - P.pos.z);
    if (d < reach) {
      tg.done = true; scene.remove(tg.m); sfx('buy', 0.5);
      if (active.id === 'poster') {
        setBoard(tg.board, tg.design); save.posters[boards.indexOf(tg.board)] = tg.design; persist();
        const n = active.targets.filter((q) => q.done).length; active.info = `Poster tertempel: ${n}/4`;
        if (n === 4) { endMission(true); setTimeout(() => toast(isTouch ? 'Dekati papan poster & tekan LIHAT POSTER buat lihat / download' : 'Dekati papan poster & tekan E buat lihat / download', 4000), 3400); return; }
        toast('Poster ditempel!');
      }
      else return endMission(true);
      continue;
    }
    if (d < bestD) { bestD = d; target = tg; }
  }
  if (thief) {
    const th = thief;
    advance(th, th.spd * dt, 6, thiefPick);
    const [x, z, h] = agentPos(th, th.e.w / 4);
    th.c.group.position.set(x, groundY(x, z), z);
    th.c.group.rotation.y = angLerp(th.c.group.rotation.y, h, Math.min(1, 10 * dt));
    animChar(th.c, th.spd, dt);
    const tp = th.c.group.position; const d = Math.hypot(tp.x - P.pos.x, tp.z - P.pos.z);
    // panic: speed up when close, slow when far so it stays catchable
    th.spd = d < 10 ? 8.0 : d > 45 ? 3.2 : d > 30 ? 5.5 : 7.2;
    if (d < (P.onBike ? 2.6 : 1.7)) return endMission(true);
    if (d > 110) { active.time = 0; }
    target = { x: tp.x, z: tp.z };
    active.info = `Jarak copet: ${Math.round(d)} m`;
  }
  $('missionInfo').textContent = active.info;
  if (target) {
    arrow.visible = true;
    arrow.position.set(P.pos.x, P.pos.y + (P.onBike ? 2.9 : 2.6), P.pos.z);
    arrow.rotation.y = Math.atan2(target.x - P.pos.x, target.z - P.pos.z);
  }
  active.target = target;
  if (active.time <= 0) endMission(false);
}

/* ---------------- input ---------------- */
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyE' && nearBoard && !paused()) openPoster(nearBoard.poster);
  else if (e.code === 'KeyF' || e.code === 'KeyE') toggleBike();
  if (e.code === 'Escape') { $('posterView').classList.add('hidden'); closeMap(); if (placeOpen) closePlace(); }
  if (e.code === 'KeyM' && started) { if (mapOpen()) closeMap(); else if (!paused()) openMap(); }
  if (e.code === 'Space') { jump(); e.preventDefault(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
const stick = { x: 0, y: 0, id: null };
let runToggle = false, jumpReq = false;
{
  const el = $('stick'), knob = $('knob');
  const move = (e) => {
    const r = el.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), M = 46; if (m > M) { dx *= M / m; dy *= M / m; }
    knob.style.transform = `translate(${dx}px,${dy}px)`; stick.x = dx / M; stick.y = -dy / M;
  };
  el.addEventListener('pointerdown', (e) => { stick.id = e.pointerId; el.setPointerCapture(e.pointerId); move(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) move(e); });
  const up = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  $('btnRun').addEventListener('pointerdown', () => { runToggle = !runToggle; $('btnRun').classList.toggle('on', runToggle); });
  $('btnEnter').addEventListener('pointerdown', () => toggleBike());
  $('btnJump').addEventListener('pointerdown', () => jump());
  $('btnPoster').addEventListener('click', () => { if (nearBoard) openPoster(nearBoard.poster); });
  $('pvClose').addEventListener('click', () => $('posterView').classList.add('hidden'));
  $('pvPrev').addEventListener('click', () => openPoster(pvIdx - 1));
  $('pvNext').addEventListener('click', () => openPoster(pvIdx + 1));
  // inside a Claude Artifact plain <a download> is blocked: route through the downloads capability when present
  const dlCap = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  $('pvDl').addEventListener('click', async (e) => {
    if (!window.claude?.use) return; // normal browser / Netlify: let the link download
    e.preventDefault();
    const dl = await dlCap; const po = POSTERS[pvIdx];
    if (!dl) { window.open(po.file, '_blank'); return; }
    try { const blob = await (await fetch(po.file)).blob(); await dl.save({ filename: po.dl, data: blob }); toast('Poster tersimpan!'); }
    catch (err) { if (err?.code !== 'declined') toast('Download gagal, coba lagi'); }
  });
}
// camera orbit drag
const cam = { yaw: 0, pitch: 0.36, dist: 7, lastDrag: -10 };
{
  let id = null, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { id = e.pointerId; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(id); });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const k = isTouch ? 0.008 : 0.005;
    cam.yaw -= (e.clientX - lx) * k; cam.pitch = clamp(cam.pitch + (e.clientY - ly) * k * 0.7, 0.05, 1.1);
    lx = e.clientX; ly = e.clientY; cam.lastDrag = clock.elapsedTime;
  });
  const up = (e) => { if (e.pointerId === id) id = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}
function jump() { if (!P.onBike && P.grounded) { P.vy = 6.2; P.grounded = false; } }
function toggleBike() {
  if (paused() || P.down > 0) return;
  if (P.onBike) {
    P.onBike = false;
    P.pos.set(bike.pos.x + Math.cos(bike.heading) * 1.1, bike.pos.y, bike.pos.z - Math.sin(bike.heading) * 1.1);
    collide(P.pos, 0.4); bike.speed = 0; P.heading = bike.heading;
    $('btnEnter').textContent = 'MOTOR';
    return;
  }
  const nb = nearestBike(3);
  if (nb) { bike = nb; P.onBike = true; $('btnEnter').textContent = 'TURUN'; cam.yaw = bike.heading; }
  else toast('Tidak ada motor di dekatmu — cari ikon M putih di radar.');
}
function nearestBike(maxD) {
  let nb = null, nd = maxD;
  for (const b of bikes) { const d = Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z); if (d < nd) { nd = d; nb = b; } }
  return nb;
}
/* ---------------- health ---------------- */
function hitPlayer(dmg, kx, kz, msg) {
  if (P.fainted) return;
  P.hp = Math.max(0, P.hp - dmg); P.knock = 1.5; P.lastHit = clock.elapsedTime;
  const h = $('hurt'); h.style.transition = 'none'; h.style.opacity = dmg >= 30 ? '0.85' : '0.45'; void h.offsetWidth; h.style.transition = 'opacity .9s'; h.style.opacity = '0';
  toast(msg, 1400); sfx('whoosh', 0.6);
  if (dmg >= 30) { // knocked down
    if (P.onBike) { P.onBike = false; bike.speed = 0; $('btnEnter').textContent = 'MOTOR'; }
    P.down = 1.6; P.kx = kx; P.kz = kz; P.vy = 5.5; P.grounded = false; P.heading = Math.atan2(-kx, -kz);
  } else { P.kx = kx; P.kz = kz; if (P.onBike) bike.speed *= 0.4; }
  updateHUD();
  if (P.hp <= 0) faint();
}
function faint() {
  P.fainted = true; P.down = 99;
  if (active) endMission(false);
  big('PINGSAN!', 'Dibawa balik ke Texture Coffee…', true, 3000);
  setTimeout(() => {
    P.pos.set(20, 0, 4.4); P.kx = P.kz = 0; P.vy = 0; P.hp = 100; P.down = 0; P.fall = 0; P.fainted = false; P.heading = 0;
    cam.yaw = 0; updateHUD(); toast('Darah penuh lagi. Hati-hati di jalan!');
  }, 3000);
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  const bal = balance();
  $('coinVal').textContent = String(bal).padStart(5, '0');
  $('dailyVal').textContent = NET ? (ON.me?.today || 0) : save.earned; $('dailyCap').textContent = dailyCap();
  $('storeCoins').textContent = bal;
  const hp = Math.ceil(P.hp); $('hpFill').style.width = hp + '%'; $('hpFill').classList.toggle('low', hp <= 30);
}
let toastT = 0;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }
let bigT = 0;
function big(a, b, fail, ms) { const el = $('bigText'); el.innerHTML = `${a}${b ? `<small>${b}</small>` : ''}`; el.classList.toggle('fail', !!fail); el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; clearTimeout(bigT); bigT = setTimeout(() => el.classList.add('hidden'), ms); }

/* ---------------- map image (radar + full map) ---------------- */
const mapImg = document.createElement('canvas'); mapImg.width = GW; mapImg.height = GH;
{
  const g = mapImg.getContext('2d');
  g.fillStyle = '#5b5a44'; g.fillRect(0, 0, GW, GH); g.setTransform(IMG_FROM_GAME); g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = '#5e7a3e'; for (const pk of MAP.parks) { g.beginPath(); polyPath(g, pk.p); g.fill(); }
  g.fillStyle = '#3f7f9f'; for (const w of MAP.water) { g.beginPath(); polyPath(g, w.o); for (const h of w.h) polyPath(g, h); g.fill('evenodd'); }
  g.fillStyle = '#8a7f6a'; for (const b of MAP.bld) { g.beginPath(); polyPath(g, b.p); g.fill(); }
  g.strokeStyle = '#3a3430'; g.lineWidth = 2.4; for (const r of MAP.rails) { g.beginPath(); linePath(g, r); g.stroke(); }
  for (const [test, col, extra] of [[(c) => c > 6, '#a89f8e', 0], [(c) => c > 3 && c <= 6, '#d8cfbc', 0], [(c) => c <= 3, '#3a3026', 3], [(c) => c <= 3, '#f2e2a8', 0]]) {
    g.strokeStyle = col; for (const r of MAP.roads) { if (!test(r.c)) continue; g.lineWidth = r.w + extra; g.beginPath(); linePath(g, r.p); g.stroke(); }
  }
}
const radar = $('radar').getContext('2d');
function drawRadar() {
  const W = 160, C = 80, S = P.onBike ? 0.6 : 0.9; // px per metre
  const f = [Math.sin(cam.yaw), Math.cos(cam.yaw)], r = [-Math.cos(cam.yaw), Math.sin(cam.yaw)];
  const px = P.pos.x, pz = P.pos.z;
  const proj = (x, z) => { const dx = x - px, dz = z - pz; return [C + (dx * r[0] + dz * r[1]) * S, C - (dx * f[0] + dz * f[1]) * S]; };
  radar.setTransform(1, 0, 0, 1, 0, 0); radar.fillStyle = '#5b5a44'; radar.fillRect(0, 0, W, W);
  radar.setTransform(new DOMMatrix([S * r[0], -S * f[0], S * r[1], -S * f[1], C - S * (r[0] * px + r[1] * pz), C + S * (f[0] * px + f[1] * pz)]).multiply(GAME_FROM_IMG));
  radar.drawImage(mapImg, 0, 0);
  radar.setTransform(1, 0, 0, 1, 0, 0);
  const dot = (x, z, col, rad = 3, clampEdge = false, label) => {
    let [sx, sy] = proj(x, z);
    if (clampEdge) { const dx = sx - C, dy = sy - C, m = Math.hypot(dx, dy); if (m > 70) { sx = C + dx / m * 70; sy = C + dy / m * 70; } }
    radar.fillStyle = col; radar.strokeStyle = '#000'; radar.lineWidth = 1.5;
    radar.beginPath(); radar.arc(sx, sy, rad, 0, 7); radar.fill(); radar.stroke();
    if (label) { radar.fillStyle = '#000'; radar.font = 'bold 9px monospace'; radar.textAlign = 'center'; radar.fillText(label, sx, sy + 3); }
  };
  for (const c of coins) if (c.m.visible) { const [sx, sy] = proj(c.m.position.x, c.m.position.z); if (sx > -2 && sx < W + 2 && sy > -2 && sy < W + 2) { radar.fillStyle = '#ffcf3a'; radar.fillRect(sx - 1, sy - 1, 2, 2); } }
  for (const pl of PLACES) if (!active) dot(pl.x, pl.z, '#2ad1c2', 4);
  dot(20, 12, '#b3262a', 6, true, 'T');
  { const nb = P.onBike ? null : bikes.reduce((a, b) => (Math.hypot(b.pos.x - px, b.pos.z - pz) < Math.hypot(a.pos.x - px, a.pos.z - pz) ? b : a));
    for (const b of bikes) if (!(P.onBike && b === bike)) dot(b.pos.x, b.pos.z, '#ffffff', 5, b === nb, 'M'); }
  if (!active) for (const m of Object.values(MISSIONS)) dot(m.pos[0], m.pos[1], '#ffcf3a', 6, true, m.letter);
  else { for (const t of active.targets) if (!t.done) dot(t.x, t.z, '#ff3a2a', 5, true); if (thief) dot(thief.c.group.position.x, thief.c.group.position.z, '#ff3a2a', 5, true); }
  // north tick on the rim
  { const a = Math.atan2(-(NORTH[0] * r[0] + NORTH[1] * r[1]), NORTH[0] * f[0] + NORTH[1] * f[1]); const nx = C - Math.sin(a) * 68, ny = C - Math.cos(a) * 68;
    radar.fillStyle = '#b3262a'; radar.beginPath(); radar.arc(nx, ny, 7, 0, 7); radar.fill(); radar.fillStyle = '#fff'; radar.font = 'bold 9px monospace'; radar.textAlign = 'center'; radar.fillText('U', nx, ny + 3); }
  // player arrow
  const h = P.onBike ? bike.heading : P.heading; const rel = h - cam.yaw;
  radar.save(); radar.translate(C, C); radar.rotate(-rel); radar.fillStyle = '#fff'; radar.strokeStyle = '#000'; radar.lineWidth = 1.5;
  radar.beginPath(); radar.moveTo(0, -7); radar.lineTo(5, 6); radar.lineTo(0, 3); radar.lineTo(-5, 6); radar.closePath(); radar.fill(); radar.stroke(); radar.restore();
}

/* ---------------- full map (click the radar or press M) ---------------- */
const MV = { zoom: 1, cx: 0, cy: 0, ptrs: new Map(), pinch: 0 };
const mapCv = $('mapCanvas'), mctx = mapCv.getContext('2d');
const mapOpen = () => !$('mapView').classList.contains('hidden');
function openMap() {
  const [u, v] = toImg(P.pos.x, P.pos.z); MV.cx = u; MV.cy = v; MV.zoom = 1.2;
  $('mapView').classList.remove('hidden'); for (const k in keys) keys[k] = false; drawMap();
}
function closeMap() { $('mapView').classList.add('hidden'); }
function mapZoom(k, sx, sy) { // zoom around a screen point
  const W = mapCv.clientWidth, H = mapCv.clientHeight, z0 = MV.zoom, z1 = clamp(z0 * k, 0.25, 4);
  if (sx !== undefined) { MV.cx += (sx - W / 2) * (1 / z0 - 1 / z1); MV.cy += (sy - H / 2) * (1 / z0 - 1 / z1); }
  MV.zoom = z1;
}
function drawMap() {
  const dpr = Math.min(2, devicePixelRatio || 1), W = mapCv.clientWidth, H = mapCv.clientHeight; if (!W || !H) return;
  if (mapCv.width !== Math.round(W * dpr) || mapCv.height !== Math.round(H * dpr)) { mapCv.width = Math.round(W * dpr); mapCv.height = Math.round(H * dpr); }
  MV.cx = clamp(MV.cx, 0, GW); MV.cy = clamp(MV.cy, 0, GH);
  const z = MV.zoom, g = mctx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#4a4936'; g.fillRect(0, 0, W, H);
  g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - MV.cx * z), dpr * (H / 2 - MV.cy * z)); g.imageSmoothingEnabled = z < 1.5; g.drawImage(mapImg, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toS = (gx, gz) => { const [u, v] = toImg(gx, gz); return [W / 2 + (u - MV.cx) * z, H / 2 + (v - MV.cy) * z]; };
  const label = (txt, x, y, col = '#fff', size = 11) => { g.font = `bold ${size}px "Space Mono", monospace`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000'; g.strokeText(txt, x, y); g.fillStyle = col; g.fillText(txt, x, y); };
  const pin = (gx, gz, col, txt, r = 8) => { const [x, y] = toS(gx, gz); g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); if (txt) { g.fillStyle = '#000'; g.font = `bold ${r + 3}px monospace`; g.textAlign = 'center'; g.fillText(txt, x, y + r * 0.45); } return [x, y]; };
  // road names when zoomed in
  if (z >= 1.6) {
    const seen = new Set();
    for (const rd of MAP.roads) { if (!rd.n || rd.c > 4 || seen.has(rd.n)) continue; const p = rd.p, k = Math.floor(p.length / 4) * 2; const [x, y] = toS(p[k], p[k + 1]); if (x < 0 || y < 0 || x > W || y > H) continue; seen.add(rd.n); label(prettyRoad(MAP.names[rd.n]), x, y + 4, '#ffe9a8', 10); }
  }
  for (const l of MAP.lm) { if (l.id === 'texture') continue; const [x, y] = toS(l.x, l.z); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); label(l.id === 'plaza' ? 'PLAZA' : l.name, x, y - 7); }
  if (!active) { for (const m of Object.values(MISSIONS)) if (m.letter !== 'K' && m.letter !== 'P') pin(m.pos[0], m.pos[1], '#ffcf3a', m.letter, 7); }
  else { for (const t of active.targets) if (!t.done) pin(t.x, t.z, '#ff3a2a', '', 6); }
  for (const pl of PLACES) { const [x, y] = pin(pl.x, pl.z, '#2ad1c2', '', 6); if (Math.hypot(pl.x - 20, pl.z - 12) > 20 && z >= 1.2) label(pl.name.toUpperCase(), x, y - 10, '#9ff5ec', 10); }
  if (thief) pin(thief.c.group.position.x, thief.c.group.position.z, '#ff3a2a', 'C', 7);
  { const [x, y] = pin(20, 12, '#b3262a', 'T', 10); label('TEXTURE COFFEE', x, y + 24, '#ffcf3a', 12); }
  // player
  { const [x, y] = toS(P.pos.x, P.pos.z), h = P.onBike ? bike.heading : P.heading, sh = Math.sin(h), ch = Math.cos(h);
    const du = XF.nz * sh + XF.nx * ch, dv = -XF.nx * sh + XF.nz * ch;
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill();
    g.save(); g.translate(x, y); g.rotate(Math.atan2(du, -dv)); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
    label('KAMU', x, y + 26, '#fff', 11); }
  // north + attribution
  g.fillStyle = '#b3262a'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(W - 28, 72, 15, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 15px "Bungee", monospace'; g.textAlign = 'center'; g.fillText('U', W - 28, 78);
  g.font = '11px "Space Mono", monospace'; g.textAlign = 'right'; g.fillStyle = 'rgba(0,0,0,.6)'; const at = '© OpenStreetMap contributors'; const tw = g.measureText(at).width; g.fillRect(W - tw - 14, H - 22, tw + 14, 22);
  g.fillStyle = '#f2e8d2'; g.fillText(at, W - 7, H - 7);
  // scale bar
  const m100 = 100 * z; g.fillStyle = '#000'; g.fillRect(12, H - 18, m100 + 4, 8); g.fillStyle = '#f2e8d2'; g.fillRect(14, H - 16, m100, 4); g.textAlign = 'left'; label('100 m', 14 + m100 / 2, H - 24, '#f2e8d2', 10);
}
mapCv.addEventListener('pointerdown', (e) => { mapCv.setPointerCapture(e.pointerId); MV.ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); MV.pinch = 0; });
mapCv.addEventListener('pointermove', (e) => {
  const prev = MV.ptrs.get(e.pointerId); if (!prev) return;
  const cur = [e.offsetX, e.offsetY]; MV.ptrs.set(e.pointerId, cur);
  if (MV.ptrs.size === 1) { MV.cx -= (cur[0] - prev[0]) / MV.zoom; MV.cy -= (cur[1] - prev[1]) / MV.zoom; }
  else if (MV.ptrs.size === 2) { const [a, b] = [...MV.ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (MV.pinch) mapZoom(d / MV.pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); MV.pinch = d; }
});
for (const ev of ['pointerup', 'pointercancel']) mapCv.addEventListener(ev, (e) => { MV.ptrs.delete(e.pointerId); MV.pinch = 0; });
mapCv.addEventListener('wheel', (e) => { e.preventDefault(); mapZoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
$('mapZoomIn').onclick = () => mapZoom(1.5); $('mapZoomOut').onclick = () => mapZoom(1 / 1.5);
$('mapCenter').onclick = () => { [MV.cx, MV.cy] = toImg(P.pos.x, P.pos.z); };
$('mapTexture').onclick = () => { [MV.cx, MV.cy] = toImg(20, 12); MV.zoom = Math.max(MV.zoom, 2); };
$('mapClose').onclick = closeMap;
$('radarWrap').onclick = () => { if (started && !paused()) openMap(); };

/* ---------------- store ---------------- */
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function openStore(tab = 'items') {
  updateHUD();
  const box = $('storeItems'); box.innerHTML = '';
  for (const it of CONFIG.STORE) {
    const el = document.createElement('div'); el.className = 'item';
    el.innerHTML = `${it.img ? `<img src="${it.img}" alt="">` : `<div class="ph">${it.label}</div>`}<div class="info"><div class="nm">${it.name}</div><div class="cost">◉ ${it.cost}</div><button ${balance() < it.cost ? 'disabled' : ''}>TUKAR</button></div>`;
    el.querySelector('button').onclick = () => redeem(it);
    box.appendChild(el);
  }
  $('store').classList.remove('hidden');
  showTab(tab);
}
async function renderVouchers() {
  const v = $('storeVouchers');
  let list;
  if (NET) {
    if (!ON.me?.profile) { v.innerHTML = '<p class="muted">Login dulu untuk melihat voucher kamu.</p>'; return; }
    v.innerHTML = '<p class="muted">Memuat…</p>';
    try {
      list = (await NET.myVouchers()).map((x) => ({
        code: x.code, name: x.item_name,
        exp: x.used_at ? 'SUDAH DIPAKAI' : `berlaku s/d ${new Date(x.expires_at).toLocaleDateString('id-ID')}`,
      }));
    } catch (e) { v.innerHTML = `<p class="muted">${esc(NET.errText(e))}</p>`; return; }
  } else list = [...save.vouchers].reverse().map((x) => ({ code: x.code, name: x.name, exp: `berlaku s/d ${x.exp}` }));
  v.innerHTML = list.length ? '' : '<p class="muted">Belum ada voucher. Kumpulkan koin lalu tukar di tab Hadiah.</p>';
  for (const x of list) {
    const el = document.createElement('div'); el.className = 'vrow';
    el.innerHTML = `<div>${esc(x.name)}<br><span class="muted">${esc(x.exp)}</span></div><b>${esc(x.code)}</b>`;
    v.appendChild(el);
  }
}
async function renderBoard() {
  const ol = $('boardList');
  if (!NET) { ol.innerHTML = '<li>Leaderboard butuh koneksi internet.</li>'; return; }
  ol.innerHTML = '<li>Memuat…</li>';
  try {
    if (ON.me?.profile) { await NET.flushPlay(syncPlay).catch(() => {}); await refreshMe(); }
    const [rows, st] = await Promise.all([NET.leaderboard(50), NET.settings()]);
    const prizes = st.prizes || [];
    const end = st.period_end ? new Date(st.period_end).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
    $('prizeInfo').innerHTML = prizes.map((p) => `<b>Juara ${p.rank}</b>: ${esc(p.name)} (min. ${p.min} koin)`).join(' · ') +
      `<br>Periode sampai ${esc(end)}.${ON.me?.profile ? ` Posisi kamu: <b>#${ON.me.rank}</b> · ${ON.me.total} koin` : ''}`;
    ol.innerHTML = rows.length ? '' : '<li>Belum ada pemain. Jadilah yang pertama!</li>';
    for (const r of rows) {
      const li = document.createElement('li');
      const pz = prizes.find((p) => p.rank === r.rank && r.total >= p.min);
      li.className = (r.is_me ? 'me ' : '') + (pz ? 'prize' : '');
      li.innerHTML = `<span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span><b>◉ ${r.total}</b>`;
      ol.appendChild(li);
    }
  } catch (e) { ol.innerHTML = `<li>${esc(NET.errText(e))}</li>`; }
}
function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  $('storeItems').classList.toggle('hidden', tab !== 'items');
  $('storeVouchers').classList.toggle('hidden', tab !== 'vouchers');
  $('storeNota').classList.toggle('hidden', tab !== 'nota');
  $('storeBoard').classList.toggle('hidden', tab !== 'board');
  if (tab === 'vouchers') renderVouchers();
  if (tab === 'board') renderBoard();
  if (tab === 'nota') { $('notaMsg').textContent = !NET ? 'Tukar nota butuh koneksi internet.' : !ON.me?.profile ? 'Login dulu untuk menukar nota.' : ''; $('notaMsg').className = 'muted'; }
}
async function redeemNota() {
  const msg = $('notaMsg'), code = $('notaCode').value.trim();
  if (!NET || !ON.me?.profile) { msg.textContent = 'Login dulu untuk menukar nota.'; msg.className = 'err'; return; }
  if (!code) return;
  $('notaGo').disabled = true; msg.textContent = 'Mengecek…'; msg.className = 'muted';
  try {
    await NET.flushPlay(syncPlay).catch(() => {});
    const r = await NET.redeemCode(code);
    await refreshMe(); updateHUD();
    msg.textContent = `+${r.coins} koin dari ${r.kind === 'merch' ? 'pembelian merch' : 'nota Texture'}!`; msg.className = 'ok';
    $('notaCode').value = ''; sfx('buy', 0.9);
  } catch (e) { msg.textContent = NET.errText(e); msg.className = 'err'; }
  $('notaGo').disabled = false;
}
async function redeem(it) {
  if (balance() < it.cost) return;
  if (!(await ask('Tukar koin?', `Tukar ${it.cost} koin untuk ${it.name}?`, 'TUKAR'))) return;
  if (NET) {
    try {
      await NET.flushPlay(syncPlay).catch(() => {});
      const v = await NET.buy(it.id);
      await refreshMe();
      const exp = new Date(v.expires_at).toLocaleDateString('id-ID');
      sfx('buy', 0.9);
      $('vName').textContent = v.item_name; $('vCode').textContent = v.code; $('vNote').textContent = `${CONFIG.REDEEM_NOTE} Berlaku s/d ${exp}.`;
      $('voucher').classList.remove('hidden');
      openStore();
    } catch (e) { toast(NET.errText(e), 3500); }
    return;
  }
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = ''; for (let i = 0; i < 6; i++) r += A[(Math.random() * A.length) | 0];
  const code = `OOT-${it.id}-${r}`;
  const exp = new Date(Date.now() + CONFIG.VOUCHER_DAYS * 864e5).toLocaleDateString('id-ID');
  save.coins -= it.cost; save.vouchers.push({ code, name: it.name, exp, at: Date.now() }); persist(); updateHUD();
  sfx('buy', 0.9);
  $('vName').textContent = it.name; $('vCode').textContent = code; $('vNote').textContent = `${CONFIG.REDEEM_NOTE} Berlaku s/d ${exp}.`;
  $('voucher').classList.remove('hidden');
  openStore();
}
$('btnStore').onclick = () => openStore();
$('notaGo').onclick = redeemNota;
$('notaCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') redeemNota(); });
$('storeClose').onclick = () => $('store').classList.add('hidden');
$('vOk').onclick = () => $('voucher').classList.add('hidden');
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
$('btnMute').onclick = () => { save.muted = !save.muted; persist(); applyMute(); };
$('pYes').onclick = () => { $('prompt').classList.add('hidden'); const id = promptFor; promptFor = null; startMission(id); };
$('pNo').onclick = () => { $('prompt').classList.add('hidden'); suppress = promptFor; promptFor = null; };
const paused = () => !started || !$('mapView').classList.contains('hidden') || !$('posterView').classList.contains('hidden') || !$('prompt').classList.contains('hidden') || !$('placeCard').classList.contains('hidden') || !$('store').classList.contains('hidden') || !$('voucher').classList.contains('hidden') || !$('auth').classList.contains('hidden');

let started = false;
/* ---------------- account / login ---------------- */
// Players get an anonymous Supabase account kept in this browser; no email
// verification. Name + phone + email are contact data for prize winners.
// Email + password accounts (no email verification), so players can log in
// again on another phone and keep their coins.
async function authStep(step, msg = '', err = false) {
  $('aMsg').textContent = msg; $('aMsg').className = err ? 'err' : 'muted';
  $('auth').classList.remove('hidden');
  for (const el of document.querySelectorAll('#auth .aStep')) el.classList.toggle('hidden', el.id !== step);
  if (step === 'authLogin') { setTimeout(() => $('lEmail').focus(), 50); return; }
  const editing = !!ON.me?.profile;
  // A password is needed to sign up, and for older anonymous accounts to secure them.
  const needPass = !editing || (NET && await NET.isAnon());
  $('aTitle').textContent = editing ? 'Ubah Data' : 'Daftar Pemain';
  $('aPass').classList.toggle('hidden', !needPass);
  $('aToLoginP').classList.toggle('hidden', editing);
  $('aEmail').disabled = editing && !needPass;
  if (ON.me?.name) { $('aName').value = ON.me.name; $('aPhone').value = '0' + String(ON.me.phone || '').slice(2); $('aEmail').value = ON.me.email || ''; }
  setTimeout(() => $('aName').focus(), 50);
}
function renderAcct() {
  const online = !!NET, inn = !!ON.me?.profile;
  $('btnPlay').classList.toggle('hidden', online && !inn && !ON.guest);
  $('btnLogin').classList.toggle('hidden', !online || inn || ON.guest);
  $('btnGuest').classList.toggle('hidden', !online || inn || ON.guest);
  // Same account line on the title screen and inside OOT STORE (so players can log out mid-game).
  const html = !online ? '' : inn
    ? `Masuk sebagai <b>${esc(ON.me.name)}</b> · ◉ ${ON.me.total} · peringkat #${ON.me.rank} · <a data-act="edit">ubah data</a> · <a data-act="out">keluar</a>`
    : ON.guest ? 'Mode tamu: koin tidak tersimpan. <a data-act="in">Daftar</a> · <a data-act="login">Masuk</a>' : '';
  const acts = { edit: () => authStep('authProfile'), out: doLogout, in: () => authStep('authProfile'), login: () => authStep('authLogin') };
  for (const box of [$('acct'), $('storeAcct')]) {
    box.innerHTML = html;
    for (const a of box.querySelectorAll('a[data-act]')) a.onclick = acts[a.dataset.act];
  }
}
// In-page yes/no box; native confirm() is blocked in some in-app browsers.
function ask(title, text, okLabel) {
  $('askTitle').textContent = title; $('askText').textContent = text; $('askOk').textContent = okLabel;
  $('askBox').classList.remove('hidden');
  return new Promise((done) => {
    const end = (v) => { $('askBox').classList.add('hidden'); done(v); };
    $('askOk').onclick = () => end(true); $('askNo').onclick = () => end(false);
  });
}
async function doLogout() {
  if (!(await ask('Keluar dari akun?', 'Koin dan peringkat kamu tetap aman. Masuk lagi kapan saja, di HP mana saja, pakai email dan password kamu.', 'KELUAR'))) return;
  await NET.flushPlay(syncPlay).catch(() => {});
  await NET.logout().catch(() => {});
  location.reload();
}
async function afterLogin() {
  await refreshMe();
  if (ON.me && !ON.me.profile) { authStep('authProfile', 'Lengkapi nama dan nomor HP dulu.'); return; }
  $('auth').classList.add('hidden'); ON.guest = false; renderAcct();
  if (started) { updateHUD(); toast(`Halo ${ON.me.name}! Koin kamu sekarang tersimpan.`); }
}
$('btnLogin').onclick = () => authStep('authProfile');
// Warn before guest play: coins are not saved without an account.
$('btnGuest').onclick = () => $('guestWarn').classList.remove('hidden');
$('gwLogin').onclick = () => { $('guestWarn').classList.add('hidden'); authStep('authProfile'); };
$('gwPlay').onclick = () => { $('guestWarn').classList.add('hidden'); ON.guest = true; renderAcct(); $('btnPlay').click(); };
$('aCancel').onclick = $('lCancel').onclick = () => $('auth').classList.add('hidden');
$('aToLogin').onclick = () => authStep('authLogin');
$('aToSignup').onclick = () => authStep('authProfile');
$('aSave').onclick = async () => {
  const name = $('aName').value.trim(), phone = $('aPhone').value.trim(), em = $('aEmail').value.trim().toLowerCase();
  const pass = $('aPass').value, needPass = !$('aPass').classList.contains('hidden');
  if (name.length < 2) { authStep('authProfile', 'Isi nama minimal 2 huruf.', true); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { authStep('authProfile', 'Email tidak valid.', true); return; }
  if (needPass && pass.length < 6) { authStep('authProfile', 'Password minimal 6 karakter.', true); return; }
  $('aSave').disabled = true; $('aMsg').textContent = 'Menyimpan…'; $('aMsg').className = 'muted';
  try {
    if (needPass) await NET.signUp(em, pass);
    await NET.saveProfile(name, phone, em); $('aPass').value = ''; await afterLogin();
  } catch (e) { authStep('authProfile', NET.errText(e), true); }
  $('aSave').disabled = false;
};
$('lGo').onclick = async () => {
  const em = $('lEmail').value.trim().toLowerCase(), pass = $('lPass').value;
  if (!em || !pass) { authStep('authLogin', 'Isi email dan password.', true); return; }
  $('lGo').disabled = true; $('aMsg').textContent = 'Masuk…'; $('aMsg').className = 'muted';
  try { await NET.signIn(em, pass); $('lPass').value = ''; await afterLogin(); }
  catch (e) { authStep('authLogin', NET.errText(e), true); }
  $('lGo').disabled = false;
};
$('authProfile').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('aSave').click(); });
$('authLogin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lGo').click(); });
if (NET) {
  await refreshMe();
  if (ON.me && !ON.me.profile) authStep('authProfile');
  setInterval(() => { if (ON.me?.profile && !document.hidden) NET.flushPlay(syncPlay).catch(() => {}); }, 15000);
  addEventListener('pagehide', () => { NET.flushPlay(syncPlay).catch(() => {}); });
}
renderAcct();
$('btnPlay').onclick = () => {
  started = true; $('title').classList.add('hidden'); $('hud').classList.remove('hidden');
  applyMute(); updateHUD();
  if (document.documentElement.requestFullscreen && isTouch) document.documentElement.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  setTimeout(() => toast('Masuk ke penanda kuning untuk mulai misi. Motor putih ada di samping kafe.', 4500), 600);
};
document.addEventListener('visibilitychange', () => { if (document.hidden) bgm.pause(); else if (started && !save.muted) bgm.play().catch(() => {}); });

/* ---------------- update loop ---------------- */
const clock = new THREE.Clock();
let gameMin = 17 * 60 + 30;
let capWarned = false;
const tmpV = new THREE.Vector3(), ray = new THREE.Raycaster();

function update(dt) {
  // input vector
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + stick.x;
  let iy = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + stick.y;
  ix = clamp(ix, -1, 1); iy = clamp(iy, -1, 1);
  const mag = Math.min(1, Math.hypot(ix, iy));

  if (P.onBike) {
    const thr = iy;
    if (thr > 0) bike.speed += thr * 15 * dt; else if (thr < 0) bike.speed += thr * (bike.speed > 0 ? 26 : 8) * dt;
    bike.speed -= bike.speed * 0.7 * dt; if (!thr) bike.speed -= Math.sign(bike.speed) * Math.min(Math.abs(bike.speed), 4 * dt);
    bike.speed = clamp(bike.speed, -6, 24);
    const turn = ix * 2.1 * clamp(Math.abs(bike.speed) / 5, 0, 1) * Math.sign(bike.speed || 1);
    bike.heading -= turn * dt;
    bike.lean = lerp(bike.lean, -ix * clamp(bike.speed / 20, 0, 1) * 0.35, 6 * dt);
    bike.pos.x += Math.sin(bike.heading) * bike.speed * dt; bike.pos.z += Math.cos(bike.heading) * bike.speed * dt;
    if (P.kx || P.kz) { bike.pos.x += P.kx * dt; bike.pos.z += P.kz * dt; const k = Math.exp(-5 * dt); P.kx *= k; P.kz *= k; }
    if (collide(bike.pos, 0.9) && Math.abs(bike.speed) > 6) {
      if (Math.abs(bike.speed) > 15 && P.knock <= 0) hitPlayer(10, 0, 0, 'Nabrak tembok!');
      bike.speed *= -0.3;
    }
    bike.pos.y = lerp(bike.pos.y, groundY(bike.pos.x, bike.pos.z), 12 * dt);
    P.pos.copy(bike.pos); P.heading = bike.heading;
    // camera trails behind bike
    if (clock.elapsedTime - cam.lastDrag > 1.2 && Math.abs(bike.speed) > 1) cam.yaw = angLerp(cam.yaw, bike.heading, 2.8 * dt);
  } else {
    const run = keys.ShiftLeft || keys.ShiftRight || runToggle || (isTouch && mag > 0.92);
    const spd = P.down > 0 ? 0 : mag > 0.08 ? (run ? 8.5 : 4.2) * Math.max(mag, 0.5) : 0;
    if (spd > 0) {
      const f = [Math.sin(cam.yaw), Math.cos(cam.yaw)], r = [-Math.cos(cam.yaw), Math.sin(cam.yaw)];
      const mx = f[0] * iy + r[0] * ix, mz = f[1] * iy + r[1] * ix;
      const want = Math.atan2(mx, mz);
      P.heading = angLerp(P.heading, want, 12 * dt);
      P.pos.x += Math.sin(want) * spd * dt; P.pos.z += Math.cos(want) * spd * dt;
      if (clock.elapsedTime - cam.lastDrag > 2 && iy > 0.3) cam.yaw = angLerp(cam.yaw, P.heading, 0.9 * dt);
    }
    P.speed = lerp(P.speed, spd, 10 * dt);
    if (P.kx || P.kz) { P.pos.x += P.kx * dt; P.pos.z += P.kz * dt; const k = Math.exp(-(P.grounded ? 5 : 0.8) * dt); P.kx *= k; P.kz *= k; if (Math.hypot(P.kx, P.kz) < 0.05) P.kx = P.kz = 0; }
    if (P.down > 0 && !P.fainted) P.down -= dt;
    collide(P.pos, 0.4);
    // hint when standing next to a bike
    const nb = nearestBike(2.6);
    if (nb && !P.bikeHint && P.down <= 0) { P.bikeHint = true; toast(isTouch ? 'Tekan tombol MOTOR untuk naik' : 'Tekan F untuk naik motor', 1800); }
    if (!nearestBike(4)) P.bikeHint = false;
    const gy = groundY(P.pos.x, P.pos.z);
    P.vy -= 18 * dt; P.pos.y += P.vy * dt;
    if (P.pos.y <= gy) { P.pos.y = gy; P.vy = 0; P.grounded = true; }
  }

  // traffic: cars + motorbike riders follow the real street graph
  const tgt = P.onBike ? bike.pos : P.pos, tr = P.onBike ? 0.9 : 0.4;
  const hitTest = (cx, cz, h, hl, hw, spd, name) => { // vehicle-local box test (h = heading, hl/hw = half length/width)
    if (P.fainted || P.down > 0) return;
    const s = Math.sin(h), c = Math.cos(h), dx = tgt.x - cx, dz = tgt.z - cz;
    const ahead = dx * s + dz * c, side = dx * c - dz * s;                  // ahead > 0: in front of the vehicle
    if (Math.abs(ahead) > hl + tr || Math.abs(side) > hw + tr) return;
    const hard = ahead > hl * 0.45 && Math.abs(side) < hw * 0.9;           // hit by the nose = ketabrak
    const sg = Math.sign(side) || 1, ns = sg * (hw + tr);                   // push out sideways
    tgt.x = cx + s * ahead + c * ns; tgt.z = cz + c * ahead - s * ns;
    if (P.knock > 0) return;
    const fx = s, fz = c, sx = c * sg, sz = -s * sg;
    if (hard) hitPlayer(50, fx * spd * 0.8 + sx * 5, fz * spd * 0.8 + sz * 5, `Ketabrak ${name}! Darah -50%`);
    else hitPlayer(10, fx * 2 + sx * 3, fz * 2 + sz * 3, `Kesenggol ${name}`);
  };
  const drive = (ag, cfg, lane) => { // move a graph agent, recycle it near the player when it wanders off
    advance(ag, ag.spd * dt, cfg.maxC);
    let [x, z, h] = agentPos(ag, lane(ag));
    if (Math.hypot(x - P.pos.x, z - P.pos.z) > cfg.far && respawnAgent(ag, cfg.maxC, cfg.r0, cfg.r1)) [x, z, h] = agentPos(ag, lane(ag));
    ag.h = ag.h == null ? h : angLerp(ag.h, h, Math.min(1, 6 * dt)); ag.x = x; ag.z = z;
  };
  for (const c of cars) {
    drive(c, CAR, (a) => a.e.w / 4);
    c.g.position.set(c.x, 0, c.z); c.g.rotation.y = c.h;
    hitTest(c.x, c.z, c.h, 2.1, 1.1, c.spd, 'mobil');
  }
  for (const r of riders) {
    drive(r, RIDER, (a) => a.e.w / 4);
    const h = r.h;
    r.g.position.set(r.x, groundY(r.x, r.z), r.z); r.g.rotation.set(0, h, 0);
    const far = Math.hypot(r.x - P.pos.x, r.z - P.pos.z) > 95;
    r.c.group.visible = !far;
    if (!far) {
      r.c.group.position.set(r.x - Math.sin(h) * 0.25, r.g.position.y + 0.02, r.z - Math.cos(h) * 0.25); r.c.group.rotation.set(0, h, 0);
      animChar(r.c, 0, dt, 'ride');
    }
    hitTest(r.x, r.z, h, 1.0, 0.45, r.spd, 'motor');
  }
  P.knock -= dt;
  // slow regen after 10 s without damage
  if (!P.fainted && P.hp < 100 && clock.elapsedTime - P.lastHit > 10) { P.hp = Math.min(100, P.hp + 2 * dt); if (Math.random() < 0.1) updateHUD(); }

  // npcs
  for (const n of npcs) {
    drive(n, PED, (a) => a.side * (a.e.w / 2 + 0.9));
    const x = n.x, z = n.z, far = Math.hypot(x - P.pos.x, z - P.pos.z) > 95;
    n.c.group.visible = !far; if (far) continue;
    n.c.group.position.set(x, groundY(x, z), z); n.c.group.rotation.y = n.h;
    animChar(n.c, n.spd, dt);
  }

  // coins
  const reach = P.onBike ? 2.2 : 1.4;
  for (const c of coins) {
    if (!c.m.visible) { c.t -= dt; if (c.t <= 0) c.m.visible = true; continue; }
    c.m.rotation.y += dt * 3;
    if (Math.hypot(c.m.position.x - P.pos.x, c.m.position.z - P.pos.z) < reach && Math.abs(c.m.position.y - 1 - P.pos.y) < 2) {
      c.m.visible = false; c.t = CONFIG.COIN_RESPAWN;
      const got = earn(CONFIG.COIN_PICKUP);
      if (got) sfx('buy', 0.35); else if (!capWarned) { capWarned = true; toast(`Batas ${dailyCap()} koin dari main game hari ini tercapai. Tukar nota Texture untuk koin lebih banyak!`, 4200); }
    }
  }

  // mission markers
  if (!active) {
    let inside = null;
    for (const [id, m] of Object.entries(MISSIONS)) {
      m.icon.position.y = 2.6 + Math.sin(clock.elapsedTime * 3) * 0.15;
      if (Math.hypot(m.pos[0] - P.pos.x, m.pos[1] - P.pos.z) < 1.4) inside = id;
    }
    if (inside && inside !== suppress && !promptFor) {
      promptFor = inside; const m = MISSIONS[inside];
      $('pTitle').textContent = m.name;
      $('pDesc').textContent = `${m.desc} Hadiah: ${CONFIG.REWARD[inside]} koin OOT.`;
      $('prompt').classList.remove('hidden');
      if (P.onBike) bike.speed = 0;
    }
    if (!inside) suppress = null;
  }
  updatePlaces();
  updateMission(dt);

  // clock
  gameMin = (gameMin + dt) % 1440;
  $('clock').textContent = `${String(Math.floor(gameMin / 60)).padStart(2, '0')}:${String(Math.floor(gameMin % 60)).padStart(2, '0')}`;
}

function place(dt) {
  // player visuals
  player.group.position.copy(P.pos);
  playerMarker.visible = !arrow.visible;
  updatePosterNear();
  playerMarker.position.y = 2.55 + Math.sin(performance.now() * 0.004) * 0.08;
  playerMarker.rotation.y += dt * 2;
  if (P.onBike) {
    player.group.position.y = bike.pos.y + 0.02;
    player.group.position.x -= Math.sin(bike.heading) * 0.25; player.group.position.z -= Math.cos(bike.heading) * 0.25;
    player.group.rotation.set(0, bike.heading, 0); player.group.rotateZ(bike.lean);
    animChar(player, 0, dt, 'ride');
  } else {
    P.fall = lerp(P.fall, P.down > 0 ? 1 : 0, Math.min(1, (P.down > 0 ? 9 : 5) * dt));
    player.group.rotation.set(-P.fall * 1.45, P.heading, 0);
    player.group.position.y += P.fall * 0.12;
    animChar(player, P.grounded && P.down <= 0 ? P.speed : 0, dt);
    if (!P.grounded && P.down <= 0) { const pp = player.parts; pp.legL.rotation.x = -0.6; pp.legR.rotation.x = 0.3; pp.kneeL.rotation.x = 0.9; pp.kneeR.rotation.x = 0.4; pp.armL.rotation.x = pp.armR.rotation.x = -2.4; pp.elbowL.rotation.x = pp.elbowR.rotation.x = -0.3; }
  }
  for (const b of bikes) { b.group.position.copy(b.pos); b.group.rotation.set(0, b.heading, 0); b.group.rotateZ(b.lean); }

  // camera
  const dist = P.onBike ? 8 : cam.dist;
  const target = tmpV.set(P.pos.x, P.pos.y + 1.55, P.pos.z);
  const cp = Math.cos(cam.pitch);
  const want = new THREE.Vector3(target.x - Math.sin(cam.yaw) * dist * cp, target.y + Math.sin(cam.pitch) * dist, target.z - Math.cos(cam.yaw) * dist * cp);
  const dirv = want.clone().sub(target); const len = dirv.length(); dirv.divideScalar(len);
  ray.set(target, dirv); ray.far = len;
  const hits = ray.intersectObjects(occluders, false);
  let lim = hits.length ? Math.max(1.2, hits[0].distance - 0.4) : len;
  for (let st = 0.5; st < lim; st += 0.5) { if (heightAt(target.x + dirv.x * st, target.z + dirv.z * st) > target.y + dirv.y * st - 0.3) { lim = Math.max(1.2, st - 0.5); break; } }
  want.copy(target).addScaledVector(dirv, lim);
  camera.position.lerp(want, Math.min(1, 14 * dt));
  camera.lookAt(target);
}

let areaT = 0, areaLast = '';
function areaName() {
  const x = P.pos.x, z = P.pos.z;
  if (Math.hypot(x - CAFE.x, z - CAFE.z) < 18) return 'TEXTURE COFFEE';
  let best = null, bd = 1e9;
  for (const l of MAP.lm) { if (l.id === 'texture') continue; const d = Math.hypot(l.x - x, l.z - z); if (d < l.r && d < bd) { bd = d; best = l; } }
  if (best) return best.id === 'plaza' ? 'PLAZA' : best.name;
  return `${(roadAt(x, z, 20) || 'GANG KAMPUNG').toUpperCase()} · ${districtAt(x, z)}`;
}
function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  if (!paused()) update(dt);
  place(paused() ? 0 : dt);
  riverTex.offset.y -= dt * 0.05; // Brantas flows north
  skyGroup.position.set(camera.position.x, 0, camera.position.z);
  if (mapOpen()) drawMap();
  if ((areaT -= dt) < 0) { areaT = 0.4; const a = areaName(); if (a !== areaLast) { areaLast = a; $('areaName').textContent = a; } }
  renderer.render(scene, camera);
  if (started) drawRadar();
  requestAnimationFrame(loop);
}
// initial camera
camera.position.set(20, 4, -2); camera.lookAt(20, 2, 10);
updateHUD();
loop();
// debug handle (handy for QA in a background tab)
window.__oot = { MAP, PLACES, toGame, toOsm, heightAt, freeAt, openMap, cars, coins, areaName, roadNameAt, boards, openPoster, get nearBoard() { return nearBoard; }, P, get bike() { return bike; }, bikes, riders, npcs, hitPlayer, cam, save, keys, startMission, toggleBike, applyOutfit, player, get active() { return active; }, get thief() { return thief; },
  step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { if (!paused()) update(dt); place(dt); } renderer.render(scene, camera); drawRadar(); } };
