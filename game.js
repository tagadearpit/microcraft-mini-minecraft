/**
 * MicroCraft — self-contained voxel sandbox engine.
 * No runtime fetching or string-patching: everything needed to run ships in this file,
 * so GitHub Pages (and any static host) can serve it reliably with no third-party
 * repo/CDN dependency beyond the pinned Three.js build declared in index.html's import map.
 */
import * as THREE from 'three';

/* ======================================================================================
 * DOM REFERENCES
 * ==================================================================================== */
const el = (id) => document.getElementById(id);
const gameRoot = el('game');
const loadingEl = el('loading');
const menuEl = el('menu');
const hudEl = el('hud');
const damageFlashEl = el('damage-flash');
const statsEl = el('stats');
const pauseButton = el('pause-button');
const questTitleEl = el('quest-title');
const questProgressEl = el('quest-progress');
const questDetailEl = el('quest-detail');
const timeIconEl = el('time-icon');
const worldClockEl = el('world-clock');
const scoreLabelEl = el('score-label');
const minimapCanvas = el('minimap');
const crosshairEl = el('crosshair');
const interactionHintEl = el('interaction-hint');
const playerHandEl = el('player-hand');
const heldBlockEl = el('held-block');
const heartsEl = el('hearts');
const staminaFillEl = el('stamina-fill');
const selectedLabelEl = el('selected-label');
const hotbarEl = el('hotbar');
const touchControlsEl = el('touch-controls');
const touchLookEl = el('touch-look');
const menuSection = el('menu');
const playButton = el('play-button');
const craftButton = el('craft-button');
const craftPanel = el('craft-panel');
const craftClose = el('craft-close');
const recipeListEl = el('recipe-list');
const saveButton = el('save-button');
const screenshotButton = el('screenshot-button');
const seedButton = el('seed-button');
const qualityButton = el('quality-button');
const soundButton = el('sound-button');
const shareButton = el('share-button');
const resetButton = el('reset-button');
const worldInfoEl = el('world-info');
const deathScreen = el('death-screen');
const deathSummaryEl = el('death-summary');
const respawnButton = el('respawn-button');
const toastEl = el('toast');

/* ======================================================================================
 * CONSTANTS
 * ==================================================================================== */
const WORLD_RADIUS = 30;
const BEDROCK_Y = -8;
const SEA_LEVEL = 0;
const EYE_HEIGHT = 1.62;
const PLAYER_HEIGHT = 1.78;
const PLAYER_RADIUS = 0.3;
const GRAVITY = 22;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 6.6;
const JUMP_SPEED = 7.6;
const REACH = 6.2;
const DAY_LENGTH_SECONDS = 600;
const SAVE_KEY = 'microcraft_save_v3';

const BLOCKS = {
  grass: { id: 'grass', name: 'Grass Block', color: 0x6ea83d, rough: 0.95, metal: 0.0, mineTime: 0.5 },
  dirt: { id: 'dirt', name: 'Dirt', color: 0x7a5636, rough: 1.0, metal: 0.0, mineTime: 0.45 },
  stone: { id: 'stone', name: 'Stone', color: 0x8a8d92, rough: 0.85, metal: 0.05, mineTime: 0.9 },
  sand: { id: 'sand', name: 'Sand', color: 0xd8c179, rough: 0.9, metal: 0.0, mineTime: 0.4 },
  wood: { id: 'wood', name: 'Log', color: 0x6b4a2c, rough: 0.85, metal: 0.0, mineTime: 0.65 },
  leaves: { id: 'leaves', name: 'Leaves', color: 0x4f8a3d, rough: 1.0, metal: 0.0, mineTime: 0.25 },
  crystal: { id: 'crystal', name: 'Crystal Ore', color: 0x6bd6d1, rough: 0.35, metal: 0.15, mineTime: 1.3, emissive: 0x2fe6df, emissiveIntensity: 0.9 },
  plank: { id: 'plank', name: 'Wood Plank', color: 0xb98a52, rough: 0.75, metal: 0.0, mineTime: 0.45, craftedFrom: [['wood', 1]], craftYield: 4 },
  stone_brick: { id: 'stone_brick', name: 'Stone Brick', color: 0x76787c, rough: 0.7, metal: 0.05, mineTime: 0.9, craftedFrom: [['stone', 2]], craftYield: 2 },
  glowing_block: { id: 'glowing_block', name: 'Glowstone', color: 0xffdd88, rough: 0.5, metal: 0.0, mineTime: 0.6, emissive: 0xffcc55, emissiveIntensity: 1.4, craftedFrom: [['crystal', 1], ['stone', 1]], craftYield: 1 }
};
const BLOCK_IDS = Object.keys(BLOCKS);
const TERRAIN_IDS = ['grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'crystal', 'plank', 'stone_brick', 'glowing_block'];

const NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];

/* ======================================================================================
 * STATE
 * ==================================================================================== */
let qualityHigh = true;
let soundOn = true;
let paused = true;
let gameStarted = false;
let isTouch = window.matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
let seed = Math.floor(Math.random() * 1e9);
let worldTime = 0.32;
let lastFrameTime = performance.now();
let grounded = false;
let sprinting = false;
let health = 10;
let maxHealth = 10;
let stamina = 100;
let score = 0;
let crystals = 0;
let totalMined = 0;
let totalPlaced = 0;
let totalCrafted = 0;
let slimesDefeated = 0;
let sawNightSurvival = false;
let nightSeenSinceDawn = false;
let dead = false;
let questIndex = 0;

const QUESTS = [
  { title: 'Getting started', detail: (p) => `Mine ${Math.min(p, 10)} / 10 blocks`, target: 10, get: () => totalMined, reward: { score: 20, crystals: 0 } },
  { title: 'Builder', detail: (p) => `Place ${Math.min(p, 5)} / 5 blocks`, target: 5, get: () => totalPlaced, reward: { score: 25, crystals: 0 } },
  { title: 'Workbench', detail: (p) => `Craft ${Math.min(p, 1)} / 1 item`, target: 1, get: () => totalCrafted, reward: { score: 30, crystals: 1 } },
  { title: 'Slime hunter', detail: (p) => `Defeat ${Math.min(p, 3)} / 3 slimes`, target: 3, get: () => slimesDefeated, reward: { score: 60, crystals: 2 } },
  { title: 'Survivor', detail: () => sawNightSurvival ? 'Survived a full night!' : 'Survive from dusk to dawn', target: 1, get: () => (sawNightSurvival ? 1 : 0), reward: { score: 100, crystals: 3 } }
];
let questsComplete = false;

/* Inventory: 8 hotbar slots => {type, count} | null */
let inventory = new Array(8).fill(null);
let selectedSlot = 0;

/* ======================================================================================
 * TOAST
 * ==================================================================================== */
let toastTimer = null;
function toast(message, duration = 2600) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

/* ======================================================================================
 * AUDIO
 * ==================================================================================== */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
  }
  return audioCtx;
}
function playTone(freq = 320, duration = 0.08, volume = 0.05, type = 'sine') {
  if (!soundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch (e) { /* ignore audio glitches */ }
}

/* ======================================================================================
 * SEEDED RANDOM / NOISE
 * ==================================================================================== */
function hash2(x, y, s) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453123;
  return v - Math.floor(v);
}
function valueNoise2D(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h00 = hash2(xi, yi, s);
  const h10 = hash2(xi + 1, yi, s);
  const h01 = hash2(xi, yi + 1, s);
  const h11 = hash2(xi + 1, yi + 1, s);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const top = h00 + (h10 - h00) * u;
  const bottom = h01 + (h11 - h01) * u;
  return top + (bottom - top) * v;
}
function fbm(x, y, s, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2D(x * freq, y * freq, s + i * 17.13) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
function cellRandom(x, y, z, s) {
  return hash2(x * 12.9898 + z * 3.7, y * 78.233 + z * 5.1, s + 91.7);
}

/* ======================================================================================
 * RENDERER / SCENE / CAMERA
 * ==================================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityHigh ? 2 : 1.3));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
gameRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 400);
const baseFov = 72;
camera.position.set(0, 12, 0);

const cameraRig = { yaw: 0, pitch: 0 };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---- Lighting ---- */
const ambientLight = new THREE.AmbientLight(0xffffff, 0.42);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x9ec8ff, 0x50412c, 1.15);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff2d8, 2.15);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;
sun.shadow.bias = -0.0018;
scene.add(sun);
scene.add(sun.target);

const moonLight = new THREE.DirectionalLight(0x9fb7ff, 0.08);
scene.add(moonLight);
scene.add(moonLight.target);

/* ---- Sky dome (gradient shader) ---- */
const skyUniforms = {
  topColor: { value: new THREE.Color(0x2f6fb8) },
  bottomColor: { value: new THREE.Color(0xbfe0f5) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunVisibility: { value: 1 }
};
const skyGeo = new THREE.SphereGeometry(300, 24, 16);
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform vec3 sunDir;
    uniform float sunVisibility;
    varying vec3 vWorldPos;
    void main() {
      float h = normalize(vWorldPos).y;
      float t = smoothstep(-0.15, 0.65, h);
      vec3 col = mix(bottomColor, topColor, t);
      float sunDot = max(dot(normalize(vWorldPos), normalize(sunDir)), 0.0);
      float glow = pow(sunDot, 24.0) * sunVisibility;
      col += vec3(1.0, 0.85, 0.55) * glow * 0.9;
      gl_FragColor = vec4(col, 1.0);
    }
  `
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyDome);

scene.fog = new THREE.Fog(0xbfe0f5, 32, 96);
let surfaceFogNear = 32, surfaceFogFar = 96;

/* ---- Sun / moon glow sprites ---- */
function makeGlowTexture(inner, outer) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(255,248,220,1)', 'rgba(255,210,110,0.55)'), transparent: true, depthWrite: false }));
sunSprite.scale.set(38, 38, 1);
scene.add(sunSprite);
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(230,238,255,1)', 'rgba(160,180,255,0.4)'), transparent: true, depthWrite: false }));
moonSprite.scale.set(24, 24, 1);
scene.add(moonSprite);

/* ---- Stars ---- */
const starCount = 480;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i += 1) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 0.85);
  const r = 280;
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi));
  starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

/* ---- Clouds ---- */
const cloudTexture = (() => {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 7; i += 1) {
    const cx = size * (0.25 + Math.random() * 0.5);
    const cy = size * (0.35 + Math.random() * 0.3);
    const r = size * (0.18 + Math.random() * 0.14);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  return tex;
})();
const clouds = new THREE.Group();
for (let i = 0; i < 14; i += 1) {
  const mat = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, opacity: 0.75, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const scaleV = 14 + Math.random() * 16;
  sprite.scale.set(scaleV * 1.6, scaleV, 1);
  sprite.position.set((Math.random() - 0.5) * 90, 34 + Math.random() * 10, (Math.random() - 0.5) * 90);
  sprite.userData.speed = 0.35 + Math.random() * 0.5;
  clouds.add(sprite);
}
scene.add(clouds);

/* ---- Ambient dust / fireflies (cheap GPU particles) ---- */
const moteCount = 220;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(moteCount * 3);
const moteSeed = new Float32Array(moteCount);
for (let i = 0; i < moteCount; i += 1) {
  motePos[i * 3] = (Math.random() - 0.5) * 34;
  motePos[i * 3 + 1] = 1 + Math.random() * 13;
  motePos[i * 3 + 2] = (Math.random() - 0.5) * 34;
  moteSeed[i] = Math.random() * Math.PI * 2;
}
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
moteGeo.setAttribute('seed', new THREE.BufferAttribute(moteSeed, 1));
const moteMat = new THREE.PointsMaterial({
  color: 0xe8f2c8, size: 0.045, transparent: true, opacity: 0.18,
  depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
});
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false;
scene.add(motes);

function updateAmbientMotes(delta, t) {
  const pos = moteGeo.attributes.position;
  const seeds = moteGeo.attributes.seed;
  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  for (let i = 0; i < moteCount; i += 1) {
    const ix = i * 3;
    let x = pos.array[ix], y = pos.array[ix + 1], z = pos.array[ix + 2];
    x += Math.sin(t * 0.34 + seeds.array[i]) * delta * 0.22;
    z += Math.cos(t * 0.27 + seeds.array[i] * 1.7) * delta * 0.16;
    y += (0.06 + Math.sin(t * 0.8 + seeds.array[i]) * 0.035) * delta;
    if (x < px - 18) x += 36; if (x > px + 18) x -= 36;
    if (z < pz - 18) z += 36; if (z > pz + 18) z -= 36;
    if (y < py - 5) y = py + 12; if (y > py + 14) y = py - 4;
    pos.array[ix] = x; pos.array[ix + 1] = y; pos.array[ix + 2] = z;
  }
  pos.needsUpdate = true;
  const night = Math.max(0, 1 - (hemiLight.intensity - 0.25) / 0.75);
  moteMat.opacity = qualityHigh ? 0.12 + night * 0.3 : 0.07;
  moteMat.color.setHex(night > 0.45 ? 0xd7f7a8 : 0xe8f2c8);
}

/* ======================================================================================
 * BLOCK TEXTURES (procedural, canvas-based, tiled for realism over flat color blocks)
 * ==================================================================================== */
function makeCanvas(size = 48) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, Math.max(0, c.r + amt));
  c.g = Math.min(1, Math.max(0, c.g + amt));
  c.b = Math.min(1, Math.max(0, c.b + amt));
  return `#${c.getHexString()}`;
}
function speckle(ctx, size, base, variants, count, minR, maxR) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = variants[Math.floor(Math.random() * variants.length)];
    const x = Math.random() * size, y = Math.random() * size, r = minR + Math.random() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
function buildBlockTexture(type) {
  const size = 48;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const base = `#${new THREE.Color(BLOCKS[type].color).getHexString()}`;
  switch (type) {
    case 'grass':
      speckle(ctx, size, base, [shade(BLOCKS.grass.color, 0.08), shade(BLOCKS.grass.color, -0.09), shade(BLOCKS.grass.color, 0.15)], 130, 0.6, 2.2);
      ctx.fillStyle = shade(BLOCKS.grass.color, -0.22);
      ctx.fillRect(0, size - 6, size, 6);
      break;
    case 'dirt':
      speckle(ctx, size, base, [shade(BLOCKS.dirt.color, 0.09), shade(BLOCKS.dirt.color, -0.1)], 110, 0.6, 2.4);
      break;
    case 'stone':
      speckle(ctx, size, base, [shade(BLOCKS.stone.color, 0.07), shade(BLOCKS.stone.color, -0.08), shade(BLOCKS.stone.color, -0.16)], 140, 0.5, 2.6);
      break;
    case 'sand':
      speckle(ctx, size, base, [shade(BLOCKS.sand.color, 0.06), shade(BLOCKS.sand.color, -0.07)], 150, 0.4, 1.6);
      break;
    case 'wood': {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = shade(BLOCKS.wood.color, -0.16);
      ctx.lineWidth = 2;
      for (let x = 3; x < size; x += 7) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 1.5, size);
        ctx.stroke();
      }
      break;
    }
    case 'leaves':
      speckle(ctx, size, base, [shade(BLOCKS.leaves.color, 0.13), shade(BLOCKS.leaves.color, -0.14), shade(BLOCKS.leaves.color, 0.22)], 170, 0.8, 2.8);
      break;
    case 'crystal':
      ctx.fillStyle = shade(BLOCKS.stone.color, -0.12);
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 10; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? '#7fe9e3' : '#38b6b0';
        const x = Math.random() * size, y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 3, y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'plank':
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = shade(BLOCKS.plank.color, -0.18);
      ctx.lineWidth = 2;
      for (let y = 6; y < size; y += 12) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    case 'stone_brick':
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = shade(BLOCKS.stone_brick.color, -0.28);
      ctx.lineWidth = 2;
      for (let row = 0; row < 4; row += 1) {
        const y = row * 12;
        const offset = row % 2 === 0 ? 0 : 8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
        for (let x = -offset; x < size; x += 16) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 12);
          ctx.stroke();
        }
      }
      break;
    case 'glowing_block':
      speckle(ctx, size, base, [shade(BLOCKS.glowing_block.color, 0.12), '#fff3c8'], 60, 1, 3.2);
      break;
    default:
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/* ======================================================================================
 * INSTANCED BLOCK LAYERS (dynamic add/remove, per-instance AO color)
 * ==================================================================================== */
const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const layers = {};
class InstancedBlockLayer {
  constructor(type, capacity) {
    const def = BLOCKS[type];
    this.type = type;
    this.capacity = capacity;
    const mat = new THREE.MeshStandardMaterial({
      map: buildBlockTexture(type),
      roughness: def.rough,
      metalness: def.metal,
      vertexColors: true,
      envMapIntensity: 0.45
    });
    if (def.emissive) {
      mat.emissive = new THREE.Color(def.emissive);
      mat.emissiveIntensity = def.emissiveIntensity || 1;
    }
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(blockGeometry, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.count = 0;
    this.keyToIndex = new Map();
    this.indexToKey = new Map();
    scene.add(this.mesh);
  }
  grow() {
    const newCap = this.capacity * 2;
    const newMesh = new THREE.InstancedMesh(blockGeometry, this.material, newCap);
    newMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    newMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 3).fill(1), 3);
    newMesh.instanceMatrix.array.set(this.mesh.instanceMatrix.array);
    newMesh.instanceColor.array.set(this.mesh.instanceColor.array);
    newMesh.count = this.count;
    scene.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = newMesh;
    this.capacity = newCap;
    scene.add(this.mesh);
  }
  add(x, y, z, ao) {
    if (this.count >= this.capacity) this.grow();
    const idx = this.count;
    this.count += 1;
    this.mesh.count = this.count;
    const m = new THREE.Matrix4().makeTranslation(x + 0.5, y + 0.5, z + 0.5);
    this.mesh.setMatrixAt(idx, m);
    this.mesh.setColorAt(idx, new THREE.Color(ao, ao, ao));
    const key = `${x},${y},${z}`;
    this.keyToIndex.set(key, idx);
    this.indexToKey.set(idx, key);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return idx;
  }
  remove(x, y, z) {
    const key = `${x},${y},${z}`;
    const idx = this.keyToIndex.get(key);
    if (idx === undefined) return;
    const lastIdx = this.count - 1;
    if (idx !== lastIdx) {
      const lastKey = this.indexToKey.get(lastIdx);
      const m = new THREE.Matrix4();
      this.mesh.getMatrixAt(lastIdx, m);
      this.mesh.setMatrixAt(idx, m);
      const col = new THREE.Color();
      if (this.mesh.instanceColor) {
        col.fromArray(this.mesh.instanceColor.array, lastIdx * 3);
        this.mesh.setColorAt(idx, col);
      }
      this.keyToIndex.set(lastKey, idx);
      this.indexToKey.set(idx, lastKey);
    }
    this.keyToIndex.delete(key);
    this.indexToKey.delete(lastIdx);
    this.count -= 1;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  has(x, y, z) {
    return this.keyToIndex.has(`${x},${y},${z}`);
  }
}
TERRAIN_IDS.forEach((type) => {
  layers[type] = new InstancedBlockLayer(type, 4200);
});

/* ======================================================================================
 * WORLD DATA (logical block map, independent from render instances)
 * ==================================================================================== */
const blockMap = new Map(); // key "x,y,z" -> type
const overrides = new Map(); // saved diff vs procedural base: type string or '__air__'
function keyOf(x, y, z) { return `${x},${y},${z}`; }
function inBounds(x, y, z) {
  return x >= -WORLD_RADIUS && x <= WORLD_RADIUS && z >= -WORLD_RADIUS && z <= WORLD_RADIUS && y >= BEDROCK_Y && y <= 24;
}
function isSolidAt(x, y, z) {
  if (!inBounds(x, y, z)) return false;
  return blockMap.has(keyOf(x, y, z));
}
function getBlockAt(x, y, z) { return blockMap.get(keyOf(x, y, z)); }

function surfaceHeight(x, z) {
  const n = fbm(x * 0.045, z * 0.045, seed, 4);
  return Math.round(n * 8 - 3.2);
}

function proceduralBlockAt(x, y, z, hKnown) {
  const h = hKnown !== undefined ? hKnown : surfaceHeight(x, z);
  if (y > h) return null;
  if (y === h) {
    if (h <= SEA_LEVEL) return 'sand';
    return 'grass';
  }
  if (y > h - 3) return h <= SEA_LEVEL + 1 ? 'sand' : 'dirt';
  if (y > BEDROCK_Y && cellRandom(x, y, z, seed) > 0.975) return 'crystal';
  return 'stone';
}

function computeAO(x, y, z) {
  let solidNeighbors = 0;
  for (const [dx, dy, dz] of NEIGHBORS) {
    if (isSolidAt(x + dx, y + dy, z + dz)) solidNeighbors += 1;
  }
  const openFaces = 6 - solidNeighbors;
  return 0.52 + 0.48 * (openFaces / 6);
}

function isExposed(x, y, z) {
  for (const [dx, dy, dz] of NEIGHBORS) {
    if (!isSolidAt(x + dx, y + dy, z + dz)) return true;
  }
  return false;
}

function setBlockData(x, y, z, type, { record = false } = {}) {
  const key = keyOf(x, y, z);
  if (type) blockMap.set(key, type);
  else blockMap.delete(key);
  if (record) overrides.set(key, type || '__air__');
}

function refreshInstanceAt(x, y, z) {
  const key = keyOf(x, y, z);
  const type = blockMap.get(key);
  // remove any stale instance of any type at this position first
  for (const t of TERRAIN_IDS) {
    if (layers[t].has(x, y, z) && t !== type) layers[t].remove(x, y, z);
  }
  if (!type) return;
  const layer = layers[type];
  const exposed = isExposed(x, y, z);
  const has = layer.has(x, y, z);
  if (exposed && !has) {
    layer.add(x, y, z, computeAO(x, y, z));
  } else if (!exposed && has) {
    layer.remove(x, y, z);
  } else if (exposed && has) {
    // refresh AO color
    const idx = layer.keyToIndex.get(key);
    layer.mesh.setColorAt(idx, new THREE.Color().setScalar(computeAO(x, y, z)));
    if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
  }
}

/* ======================================================================================
 * WORLD GENERATION
 * ==================================================================================== */
const treeColumns = new Set();
function generateWorld() {
  blockMap.clear();
  Object.values(layers).forEach((l) => {
    l.count = 0;
    l.mesh.count = 0;
    l.keyToIndex.clear();
    l.indexToKey.clear();
  });
  treeColumns.clear();

  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const h = surfaceHeight(x, z);
      for (let y = BEDROCK_Y; y <= h; y += 1) {
        const t = proceduralBlockAt(x, y, z, h);
        if (t) blockMap.set(keyOf(x, y, z), t);
      }
      if (h > SEA_LEVEL + 1 && cellRandom(x, 0, z, seed) > 0.965 && Math.abs(x) < WORLD_RADIUS - 3 && Math.abs(z) < WORLD_RADIUS - 3) {
        treeColumns.add(`${x},${z}`);
      }
    }
  }

  treeColumns.forEach((k) => {
    const [x, z] = k.split(',').map(Number);
    const h = surfaceHeight(x, z);
    const trunkH = 3 + Math.floor(cellRandom(x, 1, z, seed) * 2);
    for (let i = 1; i <= trunkH; i += 1) blockMap.set(keyOf(x, h + i, z), 'wood');
    const topY = h + trunkH;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const dist = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
          if (dist <= 3 && cellRandom(x + dx, topY + dy, z + dz, seed + 3) > 0.22) {
            const key = keyOf(x + dx, topY + dy, z + dz);
            if (!blockMap.has(key)) blockMap.set(key, 'leaves');
          }
        }
      }
    }
  });

  // apply saved overrides on top of procedural base
  overrides.forEach((val, key) => {
    if (val === '__air__') blockMap.delete(key);
    else blockMap.set(key, val);
  });

  // build render instances for exposed blocks only
  blockMap.forEach((type, key) => {
    const [x, y, z] = key.split(',').map(Number);
    if (isExposed(x, y, z)) {
      layers[type].add(x, y, z, computeAO(x, y, z));
    }
  });
}

function findSpawnPoint() {
  for (let r = 0; r < 8; r += 1) {
    const h = surfaceHeight(r, -r);
    if (h > SEA_LEVEL) return new THREE.Vector3(r + 0.5, h + EYE_HEIGHT + 1.2, -r + 0.5);
  }
  return new THREE.Vector3(0.5, 10 + EYE_HEIGHT, 0.5);
}

/* ======================================================================================
 * VOXEL RAYCAST (DDA) — used for both mining target and placement face
 * ==================================================================================== */
function voxelRaycast(origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((stepX > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDeltaX) : Infinity;
  let tMaxY = dir.y !== 0 ? ((stepY > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDeltaY) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDeltaZ) : Infinity;
  let lastNormal = [0, 0, 0];
  let travelled = 0;
  for (let i = 0; i < 128; i += 1) {
    if (isSolidAt(x, y, z)) {
      return { x, y, z, normal: lastNormal, place: [x + lastNormal[0], y + lastNormal[1], z + lastNormal[2]] };
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) { x += stepX; travelled = tMaxX; tMaxX += tDeltaX; lastNormal = [-stepX, 0, 0]; }
      else { z += stepZ; travelled = tMaxZ; tMaxZ += tDeltaZ; lastNormal = [0, 0, -stepZ]; }
    } else if (tMaxY < tMaxZ) { y += stepY; travelled = tMaxY; tMaxY += tDeltaY; lastNormal = [0, -stepY, 0]; }
    else { z += stepZ; travelled = tMaxZ; tMaxZ += tDeltaZ; lastNormal = [0, 0, -stepZ]; }
    if (travelled > maxDist) return null;
  }
  return null;
}

/* ======================================================================================
 * WATER (animated surface + underwater immersion, splash & bubble particles)
 * ==================================================================================== */
const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 48, 48);
const waterMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x1a7ab8,
  transparent: true,
  opacity: 0.62,
  roughness: 0.18,
  metalness: 0.02,
  clearcoat: 0.6,
  clearcoatRoughness: 0.25,
  side: THREE.DoubleSide,
  depthWrite: false
});
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI / 2;
water.position.y = SEA_LEVEL + 0.42;
water.renderOrder = 2;
water.receiveShadow = true;
scene.add(water);
const waterBase = new Float32Array(water.geometry.attributes.position.array.length);
waterBase.set(water.geometry.attributes.position.array);
let waterRippleTime = 0;

let underwaterOverlay = null;
function ensureUnderwaterOverlay() {
  if (underwaterOverlay) return underwaterOverlay;
  underwaterOverlay = document.getElementById('underwater-overlay');
  if (!underwaterOverlay) {
    underwaterOverlay = document.createElement('div');
    underwaterOverlay.id = 'underwater-overlay';
    underwaterOverlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(underwaterOverlay);
  }
  return underwaterOverlay;
}
ensureUnderwaterOverlay();

let isUnderwater = false;
let wasInWater = false;
let underwaterFogBlend = 0;
const splashParticles = [];
const bubbleParticles = [];
let bubbleSpawnTimer = 0;
const splashGeometry = new THREE.SphereGeometry(0.055, 6, 6);
const bubbleGeometry = new THREE.SphereGeometry(1, 8, 8);

function spawnSplash(x, y, z, intensity = 1) {
  const count = Math.floor((qualityHigh ? 14 : 7) * intensity);
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xb6ecff, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(splashGeometry, mat);
    mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.1, z + (Math.random() - 0.5) * 0.5);
    mesh.scale.setScalar(0.5 + Math.random() * 0.9);
    scene.add(mesh);
    splashParticles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2.2 * intensity, (2 + Math.random() * 3.4) * intensity, (Math.random() - 0.5) * 2.2 * intensity),
      life: 0.4 + Math.random() * 0.35, maxLife: 0.75
    });
  }
  playTone(210 + Math.random() * 50, 0.04, 0.02, 'sine');
}
function spawnBubble(x, y, z, sizeScale = 1) {
  const radius = (0.04 + Math.random() * 0.09) * sizeScale;
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8f6ff, transparent: true, opacity: 0.45 + Math.random() * 0.25, roughness: 0.1, depthWrite: false });
  const mesh = new THREE.Mesh(bubbleGeometry, mat);
  mesh.scale.setScalar(radius);
  mesh.position.set(x + (Math.random() - 0.5) * 0.35, y, z + (Math.random() - 0.5) * 0.35);
  mesh.renderOrder = 3;
  scene.add(mesh);
  bubbleParticles.push({
    mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.55 + Math.random() * 0.85, (Math.random() - 0.5) * 0.25),
    wobble: Math.random() * Math.PI * 2, wobbleSpeed: 2.2 + Math.random() * 2.5, life: 1.4 + Math.random() * 1.8, maxLife: 3.2, baseScale: radius
  });
}
function updateSplashParticles(delta) {
  for (let i = splashParticles.length - 1; i >= 0; i -= 1) {
    const p = splashParticles[i];
    p.life -= delta;
    p.velocity.y -= 13 * delta;
    p.mesh.position.addScaledVector(p.velocity, delta);
    const t = Math.max(0, p.life / (p.maxLife || 0.75));
    p.mesh.material.opacity = t * 0.9;
    p.mesh.scale.setScalar(Math.max(0.04, t * 1.05));
    if (p.life <= 0) { scene.remove(p.mesh); p.mesh.material.dispose(); splashParticles.splice(i, 1); }
  }
}
function updateBubbleParticles(delta) {
  if (isUnderwater) {
    bubbleSpawnTimer -= delta;
    if (bubbleSpawnTimer <= 0) {
      bubbleSpawnTimer = qualityHigh ? (0.12 + Math.random() * 0.18) : (0.25 + Math.random() * 0.3);
      const feetY = camera.position.y - EYE_HEIGHT;
      spawnBubble(camera.position.x + (Math.random() - 0.5) * 1.2, feetY + 0.2 + Math.random() * 0.6, camera.position.z + (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.6);
    }
  } else bubbleSpawnTimer = 0;
  for (let i = bubbleParticles.length - 1; i >= 0; i -= 1) {
    const b = bubbleParticles[i];
    b.life -= delta;
    b.wobble += b.wobbleSpeed * delta;
    b.mesh.position.x += Math.sin(b.wobble) * 0.35 * delta + b.velocity.x * delta;
    b.mesh.position.z += Math.cos(b.wobble * 0.85) * 0.28 * delta + b.velocity.z * delta;
    b.mesh.position.y += b.velocity.y * delta;
    const pulse = 1 + Math.sin(b.wobble * 1.4) * 0.08;
    b.mesh.scale.setScalar(b.baseScale * pulse);
    const t = Math.max(0, b.life / (b.maxLife || 3));
    b.mesh.material.opacity = Math.min(0.7, 0.25 + t * 0.45);
    if (b.mesh.position.y >= SEA_LEVEL + 0.35 || b.life <= 0) {
      if (b.mesh.position.y >= SEA_LEVEL + 0.2) spawnSplash(b.mesh.position.x, SEA_LEVEL + 0.45, b.mesh.position.z, 0.18);
      scene.remove(b.mesh); b.mesh.material.dispose(); bubbleParticles.splice(i, 1);
    }
  }
}
function updateUnderwaterFog(delta, daylight) {
  const eyeY = camera.position.y;
  const surfaceY = SEA_LEVEL + 0.35;
  const depthBelow = Math.max(0, surfaceY - eyeY);
  const targetBlend = depthBelow > 0 ? Math.min(1, 0.35 + depthBelow / 2.2) : 0;
  const lerpSpeed = targetBlend > underwaterFogBlend ? 5.5 : 3.2;
  underwaterFogBlend += (targetBlend - underwaterFogBlend) * Math.min(1, delta * lerpSpeed);
  if (underwaterFogBlend < 0.001) underwaterFogBlend = 0;
  const overlay = ensureUnderwaterOverlay();
  if (underwaterFogBlend > 0) {
    const shallow = new THREE.Color(0x1a6b7e), mid = new THREE.Color(0x0c4558), deep = new THREE.Color(0x031820);
    const fogColor = shallow.clone().lerp(mid, Math.min(1, underwaterFogBlend * 1.2));
    fogColor.lerp(deep, Math.max(0, underwaterFogBlend - 0.45) / 0.55);
    if (daylight < 0.35) fogColor.lerp(new THREE.Color(0x01080e), ((0.35 - daylight) / 0.35) * 0.45);
    const near = 0.4 + (1 - underwaterFogBlend) * 2.8;
    const far = 5.5 + (1 - underwaterFogBlend) * 14;
    scene.fog.color.copy(fogColor);
    scene.fog.near = near;
    scene.fog.far = far;
    skyMat.uniforms.sunVisibility.value = 0;
    const lightMul = 1 - underwaterFogBlend * 0.72;
    hemiLight.intensity = (0.2 + daylight * 1.1) * lightMul;
    sun.intensity = (0.25 + daylight * 2.05) * (1 - underwaterFogBlend * 0.72);
    overlay.style.opacity = String(0.35 + underwaterFogBlend * 0.65);
    overlay.classList.add('active');
  } else {
    scene.fog.near = surfaceFogNear;
    scene.fog.far = surfaceFogFar;
    skyMat.uniforms.sunVisibility.value = 1;
    overlay.style.opacity = '';
    overlay.classList.remove('active');
  }
}
function updateWater(delta) {
  waterRippleTime += delta;
  const pos = water.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const ix = i * 3;
    const x = waterBase[ix], y = waterBase[ix + 1];
    const wave1 = Math.sin(x * 0.55 + waterRippleTime * 1.6) * 0.045;
    const wave2 = Math.cos(y * 0.48 + waterRippleTime * 1.15) * 0.03;
    pos.array[ix + 2] = waterBase[ix + 2] + wave1 + wave2;
  }
  pos.needsUpdate = true;
  water.geometry.computeVertexNormals();
  waterMaterial.opacity = isUnderwater ? 0.3 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);
}

/* ======================================================================================
 * LOCAL GRASS BILLBOARDS (dynamic, near player, lightweight sway)
 * ==================================================================================== */
const grassTexture = (() => {
  const size = 32;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = shade(BLOCKS.grass.color, 0.12);
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i += 1) {
    const x = 5 + i * 5 + (Math.random() - 0.5) * 3;
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 4, size * 0.4, x + (Math.random() - 0.5) * 3, 2);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
})();
const grassBladeGeo = new THREE.PlaneGeometry(0.9, 0.9);
const grassBladeMat = new THREE.MeshBasicMaterial({ map: grassTexture, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true });
const GRASS_CAP = 500;
const grassMesh = new THREE.InstancedMesh(grassBladeGeo, grassBladeMat, GRASS_CAP);
grassMesh.count = 0;
scene.add(grassMesh);
let grassSlots = []; // {x,z,y,phase,rotB}
function rebuildGrassNear(px, pz) {
  grassSlots = [];
  const radius = 13;
  blockMap.forEach((type, key) => {
    if (type !== 'grass' || grassSlots.length >= GRASS_CAP) return;
    const [x, y, z] = key.split(',').map(Number);
    if (!layers.grass.has(x, y, z)) return;
    const dx = x - px, dz = z - pz;
    if (dx * dx + dz * dz > radius * radius) return;
    if (cellRandom(x, y, z, seed + 51) > 0.55) return;
    grassSlots.push({ x: x + 0.5, y: y + 1.0, z: z + 0.5, phase: cellRandom(x, y, z, seed + 5) * 10, rotB: cellRandom(x, y, z, seed + 6) * Math.PI });
  });
  grassMesh.count = grassSlots.length;
}
let grassRebuildTimer = 0;
function updateGrass(delta, t) {
  if (!qualityHigh) { grassMesh.count = 0; return; }
  grassRebuildTimer -= delta;
  if (grassRebuildTimer <= 0) {
    grassRebuildTimer = 1.4;
    rebuildGrassNear(Math.round(camera.position.x), Math.round(camera.position.z));
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < grassSlots.length; i += 1) {
    const g = grassSlots[i];
    const sway = Math.sin(t * 1.6 + g.phase) * 0.12;
    q.setFromEuler(new THREE.Euler(sway * 0.3, g.rotB, sway));
    m.compose(new THREE.Vector3(g.x, g.y, g.z), q, s);
    grassMesh.setMatrixAt(i, m);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
}

/* ======================================================================================
 * DYNAMIC POINT LIGHTS FOR EMISSIVE BLOCKS (pooled)
 * ==================================================================================== */
const emissiveTypes = new Set(['crystal', 'glowing_block']);
const POOL_SIZE = 6;
const lightPool = [];
for (let i = 0; i < POOL_SIZE; i += 1) {
  const light = new THREE.PointLight(0x8ff0ea, 0, 7, 2);
  scene.add(light);
  lightPool.push(light);
}
let lightAssignTimer = 0;
function updateEmissiveLights(delta) {
  lightAssignTimer -= delta;
  if (lightAssignTimer > 0) return;
  lightAssignTimer = 0.5;
  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  const candidates = [];
  emissiveTypes.forEach((type) => {
    const layer = layers[type];
    layer.keyToIndex.forEach((idx, key) => {
      const [x, y, z] = key.split(',').map(Number);
      const dx = x - px, dy = y - py, dz = z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 100) candidates.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, d2, color: type === 'crystal' ? 0x6ff0e8 : 0xffcc66 });
    });
  });
  candidates.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < POOL_SIZE; i += 1) {
    const light = lightPool[i];
    const c = candidates[i];
    if (c) {
      light.position.set(c.x, c.y, c.z);
      light.color.setHex(c.color);
      light.intensity = 1.1;
    } else {
      light.intensity = 0;
    }
  }
}

/* ======================================================================================
 * MINING PARTICLES / FOOTSTEP DUST
 * ==================================================================================== */
const debrisPool = [];
function spawnDebris(x, y, z, color, count = 8) {
  for (let i = 0; i < count; i += 1) {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + 0.5 + (Math.random() - 0.5) * 0.6, y + 0.5 + (Math.random() - 0.5) * 0.6, z + 0.5 + (Math.random() - 0.5) * 0.6);
    scene.add(mesh);
    debrisPool.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 3, (Math.random() - 0.5) * 2.4), life: 0.5 + Math.random() * 0.4 });
  }
}
function spawnDust(x, y, z, count = 4) {
  for (let i = 0; i < count; i += 1) {
    const geo = new THREE.SphereGeometry(0.05, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcbb98a, transparent: true, opacity: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (Math.random() - 0.5) * 0.3, y + 0.05, z + (Math.random() - 0.5) * 0.3);
    scene.add(mesh);
    debrisPool.push({ mesh, velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4), life: 0.4, isDust: true });
  }
}
function updateDebris(delta) {
  for (let i = debrisPool.length - 1; i >= 0; i -= 1) {
    const d = debrisPool[i];
    d.life -= delta;
    d.velocity.y -= (d.isDust ? 1.2 : 9) * delta;
    d.mesh.position.addScaledVector(d.velocity, delta);
    if (d.mesh.material.opacity !== undefined) d.mesh.material.opacity = Math.max(0, d.life / 0.5);
    d.mesh.rotation.x += delta * 3;
    d.mesh.rotation.y += delta * 2;
    if (d.life <= 0) { scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); debrisPool.splice(i, 1); }
  }
}

/* ======================================================================================
 * SLIMES
 * ==================================================================================== */
const slimes = [];
const slimeGeo = new THREE.SphereGeometry(0.42, 12, 10);
function spawnSlime(x, z) {
  const h = surfaceHeight(Math.round(x), Math.round(z));
  const y = Math.max(h + 0.5, SEA_LEVEL + 0.5);
  const mat = new THREE.MeshStandardMaterial({ color: 0x59c96a, transparent: true, opacity: 0.88, roughness: 0.35, emissive: 0x0e4a1c, emissiveIntensity: 0.35 });
  const mesh = new THREE.Mesh(slimeGeo, mat);
  mesh.castShadow = true;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  slimes.push({ mesh, hp: 3, hopPhase: Math.random() * Math.PI * 2, wanderAngle: Math.random() * Math.PI * 2, retarget: 0, hitCooldown: 0 });
}
function removeSlime(s, awardPoints = true) {
  scene.remove(s.mesh);
  s.mesh.geometry = null;
  s.mesh.material.dispose();
  const i = slimes.indexOf(s);
  if (i >= 0) slimes.splice(i, 1);
  if (awardPoints) {
    slimesDefeated += 1;
    score += 10;
    crystals += 1;
    playTone(180, 0.16, 0.05, 'square');
    toast('Slime defeated! +10 score, +1 crystal');
  }
}
let slimeSpawnTimer = 3;
function updateSlimes(delta, daylight) {
  const isNight = daylight < 0.28;
  slimeSpawnTimer -= delta;
  if (isNight && slimes.length < 6 && slimeSpawnTimer <= 0) {
    slimeSpawnTimer = 3 + Math.random() * 4;
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 10;
    const sx = Math.round(camera.position.x + Math.cos(angle) * dist);
    const sz = Math.round(camera.position.z + Math.sin(angle) * dist);
    if (Math.abs(sx) < WORLD_RADIUS - 2 && Math.abs(sz) < WORLD_RADIUS - 2) spawnSlime(sx, sz);
  }
  for (let i = slimes.length - 1; i >= 0; i -= 1) {
    const s = slimes[i];
    if (!isNight) {
      s.mesh.material.opacity -= delta * 0.6;
      if (s.mesh.material.opacity <= 0) { removeSlime(s, false); continue; }
    }
    s.hopPhase += delta * 4.5;
    const bounce = Math.max(0, Math.sin(s.hopPhase));
    const dx = camera.position.x - s.mesh.position.x;
    const dz = camera.position.z - s.mesh.position.z;
    const distToPlayer = Math.hypot(dx, dz);
    let moveAngle = s.wanderAngle;
    if (distToPlayer < 11 && isNight) moveAngle = Math.atan2(dz, dx);
    else {
      s.retarget -= delta;
      if (s.retarget <= 0) { s.wanderAngle = Math.random() * Math.PI * 2; s.retarget = 2 + Math.random() * 2; }
    }
    const speed = (distToPlayer < 11 && isNight) ? 1.9 : 0.7;
    if (bounce > 0.02) {
      s.mesh.position.x += Math.cos(moveAngle) * speed * delta * bounce;
      s.mesh.position.z += Math.sin(moveAngle) * speed * delta * bounce;
    }
    const groundH = surfaceHeight(Math.round(s.mesh.position.x), Math.round(s.mesh.position.z));
    const baseY = Math.max(groundH + 0.5, SEA_LEVEL + 0.5);
    s.mesh.position.y = baseY + bounce * 0.28;
    s.mesh.scale.set(1 - bounce * 0.12, 1 + bounce * 0.18, 1 - bounce * 0.12);
    s.hitCooldown -= delta;
    if (distToPlayer < 1.15 && isNight && s.hitCooldown <= 0 && !dead) {
      s.hitCooldown = 1.0;
      damagePlayer(1, `${s.mesh.position.x.toFixed(0)},${s.mesh.position.z.toFixed(0)}`);
    }
  }
}
function attackNearestSlime() {
  let best = null, bestD = 3.2;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  for (const s of slimes) {
    const toSlime = s.mesh.position.clone().sub(camera.position);
    const dist = toSlime.length();
    if (dist > bestD) continue;
    toSlime.normalize();
    if (toSlime.dot(camDir) < 0.45) continue;
    best = s; bestD = dist;
  }
  if (best) {
    best.hp -= 1;
    playTone(420, 0.06, 0.05, 'triangle');
    spawnDebris(best.mesh.position.x - 0.5, best.mesh.position.y - 0.5, best.mesh.position.z - 0.5, 0x59c96a, 4);
    if (best.hp <= 0) removeSlime(best, true);
    swingHand('hit');
  }
}

/* ======================================================================================
 * PLAYER STATE / INPUT
 * ==================================================================================== */
const player = { position: findSpawnPoint(), velocity: new THREE.Vector3() };
camera.position.copy(player.position);

const keys = new Set();
let mouseDown = { left: false, right: false };
let mineProgress = 0;
let mineTarget = null;
let cameraBobT = 0;
let sprintFovT = 0;

window.addEventListener('keydown', (e) => {
  if (!gameStarted) return;
  keys.add(e.code);
  if (e.code >= 'Digit1' && e.code <= 'Digit8') selectSlot(parseInt(e.code.slice(-1), 10) - 1);
  if (e.code === 'KeyF') attackNearestSlime();
  if (e.code === 'KeyC') toggleCraftPanel();
  if (e.code === 'KeyP') takeScreenshot();
  if (e.code === 'KeyR' && dead) respawn();
  if (e.code === 'Escape') setPaused(true);
  if (e.code === 'Space' && !e.repeat && (grounded || isUnderwater || camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.55)) {
    player.velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED;
    if (!grounded) spawnSplash(camera.position.x, Math.min(camera.position.y, SEA_LEVEL + 0.5), camera.position.z, 0.5);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('wheel', (e) => {
  if (!gameStarted || paused) return;
  selectSlot((selectedSlot + (e.deltaY > 0 ? 1 : -1) + 8) % 8);
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!gameStarted) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) mouseDown.left = true;
  if (e.button === 2) { mouseDown.right = true; tryPlaceBlock(); }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown.left = false;
  if (e.button === 2) mouseDown.right = false;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  cameraRig.yaw -= e.movementX * 0.0022;
  cameraRig.pitch -= e.movementY * 0.0022;
  cameraRig.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, cameraRig.pitch));
});

document.addEventListener('pointerlockchange', () => {
  const craftOpen = craftPanel && craftPanel.classList.contains('visible');
  if (document.pointerLockElement !== renderer.domElement && gameStarted && !dead && !craftOpen) setPaused(true);
});

/* ---- Touch look/move ---- */
let touchLookId = null, touchLookLast = null;
if (touchLookEl) {
  touchLookEl.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchLookId = t.identifier;
    touchLookLast = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  touchLookEl.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== touchLookId || !touchLookLast) continue;
      const dx = t.clientX - touchLookLast.x, dy = t.clientY - touchLookLast.y;
      cameraRig.yaw -= dx * 0.0032;
      cameraRig.pitch -= dy * 0.0032;
      cameraRig.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, cameraRig.pitch));
      touchLookLast = { x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  touchLookEl.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === touchLookId) { touchLookId = null; touchLookLast = null; }
  }, { passive: true });
}
document.querySelectorAll('[data-key]').forEach((btn) => {
  const code = btn.getAttribute('data-key');
  const press = (ev) => { ev.preventDefault(); keys.add(code); };
  const release = (ev) => { ev.preventDefault(); keys.delete(code); };
  btn.addEventListener('touchstart', press, { passive: false });
  btn.addEventListener('touchend', release, { passive: false });
  btn.addEventListener('touchcancel', release, { passive: false });
});
function wireTouchAction(btnId, onDown, onUp) {
  const btn = el(btnId);
  if (!btn) return;
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); onDown && onDown(); }, { passive: false });
  if (onUp) btn.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
}
wireTouchAction('touch-jump', () => {
  if (grounded || isUnderwater) { player.velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED; }
});
wireTouchAction('touch-mine', () => { mouseDown.left = true; }, () => { mouseDown.left = false; });
wireTouchAction('touch-place', () => { tryPlaceBlock(); });
wireTouchAction('touch-attack', () => { attackNearestSlime(); });

/* ======================================================================================
 * MOVEMENT / COLLISION
 * ==================================================================================== */
function collidesAt(px, py, pz) {
  const r = PLAYER_RADIUS;
  const points = [
    [px - r, pz - r], [px + r, pz - r], [px - r, pz + r], [px + r, pz + r]
  ];
  for (const [x, z] of points) {
    for (let dy = 0.05; dy < PLAYER_HEIGHT; dy += 0.5) {
      if (isSolidAt(Math.floor(x), Math.floor(py - EYE_HEIGHT + dy), Math.floor(z))) return true;
    }
    if (isSolidAt(Math.floor(x), Math.floor(py - EYE_HEIGHT + PLAYER_HEIGHT - 0.05), Math.floor(z))) return true;
  }
  return false;
}
let fallStartY = null;
function updatePlayer(delta) {
  const forward = new THREE.Vector3(Math.sin(cameraRig.yaw), 0, Math.cos(cameraRig.yaw));
  const right = new THREE.Vector3(Math.cos(cameraRig.yaw), 0, -Math.sin(cameraRig.yaw));
  const movement = new THREE.Vector3();
  if (keys.has('KeyW')) movement.add(forward);
  if (keys.has('KeyS')) movement.sub(forward);
  if (keys.has('KeyD')) movement.add(right);
  if (keys.has('KeyA')) movement.sub(right);
  if (movement.lengthSq() > 0) movement.normalize();

  const feetY = camera.position.y - EYE_HEIGHT;
  const eyeY = camera.position.y;
  const inWater = feetY < SEA_LEVEL + 0.55;
  const fullySubmerged = eyeY < SEA_LEVEL + 0.35;
  isUnderwater = fullySubmerged;

  if (inWater && !wasInWater) {
    const impact = Math.max(0.4, Math.min(1.5, Math.abs(player.velocity.y) / 8));
    spawnSplash(camera.position.x, SEA_LEVEL + 0.5, camera.position.z, impact);
  }
  if (inWater && movement.lengthSq() > 0.1 && Math.random() < delta * 5) spawnSplash(camera.position.x, SEA_LEVEL + 0.48, camera.position.z, 0.3);
  if (fullySubmerged && movement.lengthSq() > 0.1 && Math.random() < delta * 8) spawnBubble(camera.position.x, feetY + 0.4, camera.position.z, 0.7 + Math.random() * 0.5);
  wasInWater = inWater;

  sprinting = keys.has('ShiftLeft') && movement.lengthSq() > 0 && stamina > 2 && !fullySubmerged;
  if (sprinting) stamina = Math.max(0, stamina - delta * 26);
  else stamina = Math.min(100, stamina + delta * 14);
  if (staminaFillEl) staminaFillEl.style.width = `${stamina}%`;

  let speedMul = 1, gravityMul = 1;
  if (fullySubmerged) { speedMul = 0.5; gravityMul = 0.25; player.velocity.y += 3.8 * delta; }
  else if (inWater) { speedMul = 0.6; gravityMul = 0.58; player.velocity.y += 1.4 * delta; }

  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * speedMul;
  const vx = movement.x * speed, vz = movement.z * speed;
  player.velocity.y -= GRAVITY * gravityMul * delta;
  player.velocity.y = Math.max(player.velocity.y, -30);

  let newY = camera.position.y + player.velocity.y * delta;
  if (!collidesAt(camera.position.x, newY, camera.position.z)) {
    camera.position.y = newY;
    grounded = false;
  } else {
    if (player.velocity.y < 0) {
      grounded = true;
      if (fallStartY !== null) {
        const fallDist = fallStartY - camera.position.y;
        if (fallDist > 4.2) damagePlayer(Math.min(6, Math.floor((fallDist - 4) * 1.1)), null, true);
        fallStartY = null;
      }
    }
    player.velocity.y = 0;
  }
  if (grounded && fallStartY === null) fallStartY = camera.position.y;
  if (!grounded && fallStartY !== null) fallStartY = Math.max(fallStartY, camera.position.y);

  const newX = camera.position.x + vx * delta;
  if (!collidesAt(newX, camera.position.y, camera.position.z)) camera.position.x = newX;
  const newZ = camera.position.z + vz * delta;
  if (!collidesAt(camera.position.x, camera.position.y, newZ)) camera.position.z = newZ;

  if (camera.position.y < BEDROCK_Y - 4) respawn();

  // camera bob + sprint FOV kick
  const moving = movement.lengthSq() > 0 && grounded;
  if (moving) cameraBobT += delta * (sprinting ? 11 : 7.4);
  const bobY = moving ? Math.sin(cameraBobT) * (sprinting ? 0.065 : 0.045) : 0;
  const bobX = moving ? Math.cos(cameraBobT * 0.5) * 0.03 : 0;
  camera.position.y += bobY - (camera.userData.lastBobY || 0);
  camera.userData.lastBobY = bobY;
  camera.position.x += 0; // (bobX kept subtle via rotation instead to avoid drift)

  sprintFovT += ((sprinting ? 10 : 0) - sprintFovT) * Math.min(1, delta * 6);
  camera.fov = baseFov + sprintFovT;
  camera.updateProjectionMatrix();

  const euler = new THREE.Euler(cameraRig.pitch, cameraRig.yaw, bobX * 0.3, 'YXZ');
  camera.quaternion.setFromEuler(euler);

  if (moving && grounded && Math.random() < delta * (sprinting ? 7 : 4)) spawnDust(camera.position.x, feetY + 0.02, camera.position.z, 2);
}

/* ======================================================================================
 * MINING / PLACING
 * ==================================================================================== */
function swingHand(kind) {
  if (!playerHandEl) return;
  playerHandEl.classList.remove('swing-mine', 'swing-place', 'swing-hit');
  void playerHandEl.offsetWidth;
  playerHandEl.classList.add(`swing-${kind}`);
  setTimeout(() => playerHandEl.classList.remove(`swing-${kind}`), 260);
}
function handleMining(delta) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const hit = voxelRaycast(camera.position, dir, REACH);
  if (hit) {
    interactionHintEl.textContent = `${BLOCKS[getBlockAt(hit.x, hit.y, hit.z)]?.name || ''} (hold to mine)`;
    crosshairEl.classList.toggle('mining', mouseDown.left);
  } else {
    interactionHintEl.textContent = '';
    crosshairEl.classList.remove('mining');
  }
  if (!mouseDown.left || !hit) { mineProgress = 0; mineTarget = null; return; }
  const key = keyOf(hit.x, hit.y, hit.z);
  if (mineTarget !== key) { mineTarget = key; mineProgress = 0; }
  const type = getBlockAt(hit.x, hit.y, hit.z);
  const def = BLOCKS[type];
  if (!def) return;
  mineProgress += delta;
  if (mineProgress >= def.mineTime) {
    mineProgress = 0;
    mineTarget = null;
    breakBlock(hit.x, hit.y, hit.z, type);
    swingHand('mine');
  }
}
function breakBlock(x, y, z, type) {
  setBlockData(x, y, z, null, { record: true });
  refreshInstanceAt(x, y, z);
  for (const [dx, dy, dz] of NEIGHBORS) refreshInstanceAt(x + dx, y + dy, z + dz);
  spawnDebris(x, y, z, BLOCKS[type].color, 8);
  playTone(180 + Math.random() * 60, 0.07, 0.045, 'square');
  addToInventory(type, 1);
  totalMined += 1;
  score += 1;
  if (type === 'crystal') crystals += 1;
  checkQuestProgress();
  refreshStatsHud();
}
function tryPlaceBlock() {
  if (!gameStarted || paused || dead) return;
  const slot = inventory[selectedSlot];
  if (!slot || slot.count <= 0) { toast('No block selected'); return; }
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const hit = voxelRaycast(camera.position, dir, REACH);
  if (!hit) return;
  const [px, py, pz] = hit.place;
  if (!inBounds(px, py, pz)) return;
  if (isSolidAt(px, py, pz)) return;
  const feetBlock = { x: Math.floor(camera.position.x), y: Math.floor(camera.position.y - EYE_HEIGHT), z: Math.floor(camera.position.z) };
  const headBlock = { x: feetBlock.x, y: Math.floor(camera.position.y - EYE_HEIGHT + PLAYER_HEIGHT - 0.05), z: feetBlock.z };
  if ((px === feetBlock.x && py === feetBlock.y && pz === feetBlock.z) || (px === headBlock.x && py === headBlock.y && pz === headBlock.z)) return;
  setBlockData(px, py, pz, slot.type, { record: true });
  refreshInstanceAt(px, py, pz);
  for (const [dx, dy, dz] of NEIGHBORS) refreshInstanceAt(px + dx, py + dy, pz + dz);
  slot.count -= 1;
  if (slot.count <= 0) inventory[selectedSlot] = null;
  renderHotbar();
  playTone(140, 0.06, 0.04, 'triangle');
  swingHand('place');
  totalPlaced += 1;
  checkQuestProgress();
}

/* ======================================================================================
 * INVENTORY / HOTBAR
 * ==================================================================================== */
function addToInventory(type, amount) {
  for (const slot of inventory) {
    if (slot && slot.type === type && slot.count < 64) {
      const room = 64 - slot.count;
      const add = Math.min(room, amount);
      slot.count += add;
      amount -= add;
      if (amount <= 0) { renderHotbar(); return true; }
    }
  }
  for (let i = 0; i < inventory.length; i += 1) {
    if (!inventory[i]) {
      const add = Math.min(64, amount);
      inventory[i] = { type, count: add };
      amount -= add;
      if (amount <= 0) { renderHotbar(); return true; }
    }
  }
  renderHotbar();
  if (amount > 0) toast('Inventory full!');
  return amount <= 0;
}
function removeFromInventory(type, amount) {
  let remaining = amount;
  for (const slot of inventory) {
    if (remaining <= 0) break;
    if (slot && slot.type === type) {
      const take = Math.min(slot.count, remaining);
      slot.count -= take;
      remaining -= take;
    }
  }
  for (let i = 0; i < inventory.length; i += 1) if (inventory[i] && inventory[i].count <= 0) inventory[i] = null;
  renderHotbar();
  return remaining <= 0;
}
function countInInventory(type) {
  return inventory.reduce((sum, s) => sum + (s && s.type === type ? s.count : 0), 0);
}
function selectSlot(i) {
  selectedSlot = i;
  renderHotbar();
}
function renderHotbar() {
  if (!hotbarEl) return;
  hotbarEl.innerHTML = '';
  inventory.forEach((slot, i) => {
    const div = document.createElement('div');
    div.className = `hotbar-slot${i === selectedSlot ? ' selected' : ''}${!slot ? ' empty' : ''}`;
    const swatch = document.createElement('div');
    swatch.className = 'block-swatch';
    if (slot) swatch.style.background = `#${new THREE.Color(BLOCKS[slot.type].color).getHexString()}`;
    div.appendChild(swatch);
    const num = document.createElement('span');
    num.className = 'slot-number';
    num.textContent = String(i + 1);
    div.appendChild(num);
    if (slot) {
      const cnt = document.createElement('span');
      cnt.className = 'slot-count';
      cnt.textContent = String(slot.count);
      div.appendChild(cnt);
    }
    div.addEventListener('click', () => selectSlot(i));
    hotbarEl.appendChild(div);
  });
  const sel = inventory[selectedSlot];
  if (selectedLabelEl) selectedLabelEl.textContent = sel ? BLOCKS[sel.type].name : 'Empty hand';
  if (heldBlockEl) heldBlockEl.style.background = sel ? `#${new THREE.Color(BLOCKS[sel.type].color).getHexString()}` : 'transparent';
}

/* ======================================================================================
 * CRAFTING
 * ==================================================================================== */
function renderRecipes() {
  if (!recipeListEl) return;
  recipeListEl.innerHTML = '';
  Object.values(BLOCKS).filter((b) => b.craftedFrom).forEach((b) => {
    const row = document.createElement('div');
    row.className = 'recipe';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${b.name} × ${b.craftYield}`;
    const small = document.createElement('small');
    small.textContent = `Needs ${b.craftedFrom.map(([t, n]) => `${n} ${BLOCKS[t].name}`).join(' + ')}`;
    info.appendChild(title);
    info.appendChild(small);
    const btn = document.createElement('button');
    const canCraft = b.craftedFrom.every(([t, n]) => countInInventory(t) >= n);
    btn.textContent = 'Craft';
    btn.disabled = !canCraft;
    btn.addEventListener('click', () => craftItem(b));
    row.appendChild(info);
    row.appendChild(btn);
    recipeListEl.appendChild(row);
  });
}
function craftItem(def) {
  const canCraft = def.craftedFrom.every(([t, n]) => countInInventory(t) >= n);
  if (!canCraft) return;
  def.craftedFrom.forEach(([t, n]) => removeFromInventory(t, n));
  addToInventory(def.id, def.craftYield);
  totalCrafted += 1;
  score += 8;
  playTone(520, 0.1, 0.05, 'sine');
  toast(`Crafted ${def.craftYield} × ${def.name}`);
  renderRecipes();
  checkQuestProgress();
}
function toggleCraftPanel() {
  if (!craftPanel) return;
  const show = !craftPanel.classList.contains('visible');
  if (show) {
    renderRecipes();
    craftPanel.classList.add('visible');
    craftPanel.setAttribute('aria-hidden', 'false');
    if (gameStarted) { paused = true; document.exitPointerLock && document.exitPointerLock(); }
  } else {
    craftPanel.classList.remove('visible');
    craftPanel.setAttribute('aria-hidden', 'true');
    if (gameStarted && !dead && !menuSection.classList.contains('visible')) {
      paused = false;
      if (!isTouch) renderer.domElement.requestPointerLock();
    }
  }
}
if (craftButton) craftButton.addEventListener('click', () => toggleCraftPanel());
if (craftClose) craftClose.addEventListener('click', () => toggleCraftPanel());

/* ======================================================================================
 * HEALTH / DAMAGE / DEATH
 * ==================================================================================== */
let damageFlashTimer = 0;
function damagePlayer(amount, sourceKey, isFall = false) {
  if (dead) return;
  health = Math.max(0, health - amount);
  damageFlashEl.classList.add('active');
  damageFlashTimer = 0.18;
  playTone(isFall ? 90 : 130, 0.12, 0.06, 'sawtooth');
  renderHearts();
  if (health <= 0) killPlayer();
}
function renderHearts() {
  if (!heartsEl) return;
  heartsEl.innerHTML = '';
  const totalHearts = maxHealth / 2;
  for (let i = 0; i < totalHearts; i += 1) {
    const span = document.createElement('span');
    span.textContent = '❤';
    if (i * 2 + 1 >= health) span.classList.add('lost');
    heartsEl.appendChild(span);
  }
}
function killPlayer() {
  dead = true;
  deathSummaryEl.textContent = `Score ${score} · Crystals ${crystals} · Blocks mined ${totalMined}`;
  deathScreen.classList.add('visible');
  deathScreen.setAttribute('aria-hidden', 'false');
  document.exitPointerLock && document.exitPointerLock();
}
function respawn() {
  dead = false;
  health = maxHealth;
  const spawn = findSpawnPoint();
  camera.position.copy(spawn);
  player.velocity.set(0, 0, 0);
  renderHearts();
  deathScreen.classList.remove('visible');
  deathScreen.setAttribute('aria-hidden', 'true');
  setPaused(false);
}
if (respawnButton) respawnButton.addEventListener('click', respawn);

/* ======================================================================================
 * QUESTS / HUD
 * ==================================================================================== */
function checkQuestProgress() {
  if (questsComplete) return;
  const q = QUESTS[questIndex];
  const progress = q.get();
  if (progress >= q.target) {
    score += q.reward.score;
    crystals += q.reward.crystals;
    toast(`Challenge complete: ${q.title}! +${q.reward.score} score${q.reward.crystals ? `, +${q.reward.crystals} crystals` : ''}`);
    playTone(660, 0.14, 0.05, 'sine');
    questIndex += 1;
    if (questIndex >= QUESTS.length) {
      questsComplete = true;
      toast('All challenges complete! You are a MicroCraft champion.', 4200);
    }
  }
  refreshQuestHud();
  refreshStatsHud();
}
function refreshQuestHud() {
  if (questsComplete) {
    questTitleEl.textContent = 'All challenges complete!';
    questProgressEl.style.width = '100%';
    questDetailEl.textContent = `Final score ${score}`;
    return;
  }
  const q = QUESTS[questIndex];
  const progress = Math.min(q.target, q.get());
  questTitleEl.textContent = q.title;
  questProgressEl.style.width = `${(progress / q.target) * 100}%`;
  questDetailEl.textContent = q.detail(progress);
}
function refreshStatsHud() {
  if (scoreLabelEl) scoreLabelEl.textContent = `Score ${score} · Crystals ${crystals}`;
}

/* ======================================================================================
 * DAY / NIGHT CYCLE
 * ==================================================================================== */
function updateDayNight(delta) {
  worldTime = (worldTime + delta / DAY_LENGTH_SECONDS) % 1;
  const angle = (worldTime - 0.5) * Math.PI * 2;
  const sunDir = new THREE.Vector3(Math.sin(angle) * 0.7, Math.cos(angle), 0.35).normalize();
  const daylight = Math.max(0, sunDir.y);
  const nightAmt = Math.max(0, -sunDir.y);

  if (daylight < 0.22 && !nightSeenSinceDawn) nightSeenSinceDawn = true;
  if (daylight > 0.5 && nightSeenSinceDawn) { sawNightSurvival = true; nightSeenSinceDawn = false; checkQuestProgress(); }

  sun.position.copy(camera.position).addScaledVector(sunDir, 120);
  sun.target.position.copy(camera.position);
  sun.target.updateMatrixWorld();
  sun.intensity = 0.35 + daylight * 2.15;
  sun.color.setHSL(0.11 - daylight * 0.02, 0.55, 0.55 + daylight * 0.25);

  const moonDir = sunDir.clone().negate();
  moonLight.position.copy(camera.position).addScaledVector(moonDir, 120);
  moonLight.target.position.copy(camera.position);
  moonLight.target.updateMatrixWorld();
  moonLight.intensity = nightAmt * 0.48;

  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 260);
  sunSprite.material.opacity = Math.max(0, sunDir.y + 0.1);
  moonSprite.position.copy(camera.position).addScaledVector(moonDir, 260);
  moonSprite.material.opacity = Math.max(0, -sunDir.y + 0.1);

  hemiLight.intensity = 0.55 + daylight * 0.65;
  ambientLight.intensity = 0.18 + daylight * 0.34;
  hemiLight.color.setHSL(0.58, 0.5, 0.55 + daylight * 0.25);

  const dayTop = new THREE.Color(0x2f6fb8), dayBottom = new THREE.Color(0xbfe0f5);
  const nightTop = new THREE.Color(0x03060f), nightBottom = new THREE.Color(0x0c1730);
  const duskTint = new THREE.Color(0xe58b68);
  const dawnBlend = Math.min(1, Math.max(0, 1 - Math.abs(sunDir.y) * 3.2));
  const top = nightTop.clone().lerp(dayTop, daylight).lerp(duskTint, dawnBlend * 0.35);
  const bottom = nightBottom.clone().lerp(dayBottom, daylight).lerp(duskTint, dawnBlend * 0.55);
  skyMat.uniforms.topColor.value.copy(top);
  skyMat.uniforms.bottomColor.value.copy(bottom);
  skyMat.uniforms.sunDir.value.copy(sunDir);
  if (underwaterFogBlend <= 0) scene.fog.color.copy(bottom);
  starMat.opacity = nightAmt * 0.85;

  if (daylight > 0.35) waterMaterial.color.setHex(0x1a7ab8);
  else if (daylight > 0.12) waterMaterial.color.setHex(0x2a5f8a);
  else waterMaterial.color.setHex(0x0c2a48);

  updateUnderwaterFog(delta, daylight);

  const totalMinutes = Math.floor(worldTime * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  if (worldClockEl) worldClockEl.textContent = `Day 1 · ${hh}:${mm}`;
  if (timeIconEl) timeIconEl.textContent = daylight > 0.15 ? '☀' : '☾';

  return { daylight, nightAmt };
}
function updateClouds(delta) {
  clouds.children.forEach((c) => {
    c.position.x += c.userData.speed * delta;
    if (c.position.x > 60) c.position.x = -60;
  });
}

/* ======================================================================================
 * MINIMAP
 * ==================================================================================== */
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
let minimapTimer = 0;
function drawMinimap() {
  if (!minimapCtx) return;
  const size = minimapCanvas.width;
  minimapCtx.clearRect(0, 0, size, size);
  minimapCtx.fillStyle = 'rgba(10,16,24,0.5)';
  minimapCtx.fillRect(0, 0, size, size);
  const range = 26;
  const px = Math.round(camera.position.x), pz = Math.round(camera.position.z);
  const scale = size / (range * 2);
  for (let dx = -range; dx <= range; dx += 1) {
    for (let dz = -range; dz <= range; dz += 2) {
      const wx = px + dx, wz = pz + dz;
      if (!inBounds(wx, 0, wz)) continue;
      const h = surfaceHeight(wx, wz);
      let color = h <= SEA_LEVEL ? '#1a5f8a' : (h <= SEA_LEVEL + 1 ? '#d8c179' : '#4c8a3a');
      minimapCtx.fillStyle = color;
      const sx = (dx + range) * scale, sy = (dz + range) * scale;
      minimapCtx.fillRect(sx, sy, scale, scale * 2);
    }
  }
  slimes.forEach((s) => {
    const dx = s.mesh.position.x - px, dz = s.mesh.position.z - pz;
    if (Math.abs(dx) > range || Math.abs(dz) > range) return;
    minimapCtx.fillStyle = '#ff5f67';
    minimapCtx.beginPath();
    minimapCtx.arc((dx + range) * scale, (dz + range) * scale, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  });
  minimapCtx.save();
  minimapCtx.translate(size / 2, size / 2);
  minimapCtx.rotate(cameraRig.yaw);
  minimapCtx.fillStyle = '#66b9ff';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -6);
  minimapCtx.lineTo(4, 5);
  minimapCtx.lineTo(-4, 5);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

/* ======================================================================================
 * SAVE / LOAD
 * ==================================================================================== */
function serializeSave() {
  const ov = {};
  overrides.forEach((v, k) => { ov[k] = v; });
  return {
    version: 2,
    seed,
    overrides: ov,
    inventory,
    selectedSlot,
    health,
    score,
    crystals,
    totalMined,
    totalPlaced,
    totalCrafted,
    slimesDefeated,
    questIndex,
    questsComplete,
    worldTime,
    playerPos: [camera.position.x, camera.position.y, camera.position.z],
    yaw: cameraRig.yaw
  };
}
function saveGame(silent = false) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeSave()));
    if (!silent) toast('World saved locally');
  } catch (e) {
    if (!silent) toast('Could not save (storage unavailable)');
  }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function applySave(data) {
  seed = data.seed;
  overrides.clear();
  Object.entries(data.overrides || {}).forEach(([k, v]) => overrides.set(k, v));
  inventory = data.inventory || new Array(8).fill(null);
  selectedSlot = data.selectedSlot || 0;
  health = data.health ?? maxHealth;
  score = data.score || 0;
  crystals = data.crystals || 0;
  totalMined = data.totalMined || 0;
  totalPlaced = data.totalPlaced || 0;
  totalCrafted = data.totalCrafted || 0;
  slimesDefeated = data.slimesDefeated || 0;
  questIndex = data.questIndex || 0;
  questsComplete = !!data.questsComplete;
  worldTime = data.worldTime ?? 0.32;
  generateWorld();
  if (data.playerPos) camera.position.set(data.playerPos[0], data.playerPos[1], data.playerPos[2]);
  else camera.position.copy(findSpawnPoint());
  cameraRig.yaw = data.yaw || 0;
}

/* ======================================================================================
 * UI WIRING
 * ==================================================================================== */
function setPaused(state, keepMenuHidden = false) {
  paused = state;
  if (state) {
    document.exitPointerLock && document.exitPointerLock();
    if (!keepMenuHidden) {
      menuSection.classList.add('visible');
      menuSection.setAttribute('aria-hidden', 'false');
    }
  } else {
    menuSection.classList.remove('visible');
    menuSection.setAttribute('aria-hidden', 'true');
    if (!isTouch) renderer.domElement.requestPointerLock();
  }
}
function startGame() {
  ensureAudio();
  if (!gameStarted) {
    gameStarted = true;
    hudEl.classList.remove('hidden');
    hudEl.setAttribute('aria-hidden', 'false');
    if (isTouch) touchControlsEl.setAttribute('aria-hidden', 'false');
  }
  setPaused(false);
}
if (playButton) playButton.addEventListener('click', startGame);
if (pauseButton) pauseButton.addEventListener('click', () => setPaused(!paused));
if (saveButton) saveButton.addEventListener('click', () => saveGame(false));
if (screenshotButton) screenshotButton.addEventListener('click', takeScreenshot);
if (seedButton) seedButton.addEventListener('click', copySeed);
if (qualityButton) qualityButton.addEventListener('click', toggleQuality);
if (soundButton) soundButton.addEventListener('click', toggleSound);
if (shareButton) shareButton.addEventListener('click', shareGame);
if (resetButton) resetButton.addEventListener('click', resetWorld);

function takeScreenshot() {
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `microcraft-${Date.now()}.png`;
  a.click();
  toast('Screenshot saved');
}
function copySeed() {
  const text = String(seed);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(`Seed copied: ${text}`)).catch(() => toast(`Seed: ${text}`));
  } else toast(`Seed: ${text}`);
}
function toggleQuality() {
  qualityHigh = !qualityHigh;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityHigh ? 2 : 1.3));
  renderer.shadowMap.enabled = qualityHigh;
  sun.castShadow = qualityHigh;
  if (qualityButton) qualityButton.textContent = `Quality: ${qualityHigh ? 'High' : 'Low'}`;
}
function toggleSound() {
  soundOn = !soundOn;
  if (soundButton) soundButton.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
}
function shareGame() {
  const shareData = { title: 'MicroCraft', text: 'Check out MicroCraft — a browser voxel sandbox!', url: window.location.href };
  if (navigator.share) navigator.share(shareData).catch(() => {});
  else if (navigator.clipboard) { navigator.clipboard.writeText(window.location.href).then(() => toast('Link copied to clipboard')); }
  else toast(window.location.href);
}
function resetWorld() {
  seed = Math.floor(Math.random() * 1e9);
  overrides.clear();
  health = maxHealth;
  score = 0;
  crystals = 0;
  totalMined = 0;
  totalPlaced = 0;
  totalCrafted = 0;
  slimesDefeated = 0;
  questIndex = 0;
  questsComplete = false;
  worldTime = 0.32;
  inventory = new Array(8).fill(null);
  slimes.slice().forEach((s) => removeSlime(s, false));
  generateWorld();
  camera.position.copy(findSpawnPoint());
  cameraRig.yaw = 0; cameraRig.pitch = 0;
  renderHearts();
  renderHotbar();
  refreshQuestHud();
  refreshStatsHud();
  saveGame(true);
  toast('New world generated');
  worldInfoEl.textContent = `World ready — seed ${seed}`;
}

/* ======================================================================================
 * MAIN LOOP
 * ==================================================================================== */
function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  if (damageFlashTimer > 0) {
    damageFlashTimer -= delta;
    if (damageFlashTimer <= 0) damageFlashEl.classList.remove('active');
  }

  if (gameStarted && !paused && !dead) {
    updatePlayer(delta);
    handleMining(delta);
    const { daylight } = updateDayNight(delta);
    updateWater(delta);
    updateSplashParticles(delta);
    updateBubbleParticles(delta);
    updateDebris(delta);
    updateClouds(delta);
    updateAmbientMotes(delta, now / 1000);
    updateGrass(delta, now / 1000);
    updateEmissiveLights(delta);
    updateSlimes(delta, daylight);
    minimapTimer -= delta;
    if (minimapTimer <= 0) { minimapTimer = 0.2; drawMinimap(); }
    if (statsEl) {
      const fps = Math.round(1 / Math.max(delta, 0.0001));
      statsEl.textContent = `FPS: ${fps} · XYZ: ${camera.position.x.toFixed(0)}, ${camera.position.y.toFixed(0)}, ${camera.position.z.toFixed(0)}`;
    }
  } else {
    // keep ambient systems alive while paused/menu is open for a living background
    updateWater(delta * 0.4);
    updateClouds(delta * 0.4);
    updateAmbientMotes(delta * 0.4, now / 1000);
  }

  renderer.render(scene, camera);
}

/* ======================================================================================
 * BOOT
 * ==================================================================================== */
function boot() {
  try {
    const existing = loadSave();
    if (existing && existing.seed) {
      applySave(existing);
      worldInfoEl.textContent = `Loaded saved world — seed ${seed}`;
    } else {
      generateWorld();
      camera.position.copy(findSpawnPoint());
      worldInfoEl.textContent = `World ready — seed ${seed}`;
      saveGame(true);
    }
    renderHearts();
    renderHotbar();
    refreshQuestHud();
    refreshStatsHud();
    if (qualityButton) qualityButton.textContent = `Quality: ${qualityHigh ? 'High' : 'Low'}`;
    if (soundButton) soundButton.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
    if (isTouch && touchControlsEl) touchControlsEl.removeAttribute('aria-hidden');

    loadingEl.classList.remove('visible');
    window.addEventListener('beforeunload', () => { if (gameStarted) saveGame(true); });
    setInterval(() => { if (gameStarted && !dead) saveGame(true); }, 20000);
    requestAnimationFrame(animate);
  } catch (error) {
    console.error('MicroCraft boot failed:', error);
    loadingEl.classList.add('visible');
    loadingEl.innerHTML = '<span>Unable to start world</span><small>Hard-refresh (Ctrl+Shift+R) and check the browser console.</small>';
  }
}

boot();