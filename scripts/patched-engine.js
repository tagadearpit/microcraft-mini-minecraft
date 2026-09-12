const STORAGE_KEY = 'microcraft-showcase-v3';
const LEGACY_STORAGE_KEY = 'microcraft-world-v1';
const WORLD_RADIUS = 72;
const MAX_BUILD_HEIGHT = 26;

// === Chunk streaming / performance patch (loader-injected) ===
const CHUNK_SIZE = 12;
const WORLD_HEIGHT = 26;
const CHUNK_X_MIN = Math.floor(-WORLD_RADIUS / CHUNK_SIZE);
const CHUNK_X_MAX = Math.floor(WORLD_RADIUS / CHUNK_SIZE);
const CHUNK_Z_MIN = CHUNK_X_MIN;
const CHUNK_Z_MAX = CHUNK_X_MAX;
const RD_HIGH = 3;
const RD_LOW = 2;
const UNLOAD_DIST_HIGH = 4;
const UNLOAD_DIST_LOW = 3;
const STREAM_HIGH = 3;
const STREAM_LOW = 1;
function mcRenderDistance() { return qualityHigh ? RD_HIGH : RD_LOW; }
function mcUnloadDistance() { return qualityHigh ? UNLOAD_DIST_HIGH : UNLOAD_DIST_LOW; }
function mcStreamBudget() { return qualityHigh ? STREAM_HIGH : STREAM_LOW; }
const TYPE_IDS = { grass: 1, dirt: 2, stone: 3, sand: 4, wood: 5, leaves: 6, planks: 7, crystal: 8, bedrock: 9, brick: 10, torch: 11 };
const IDS_TYPE = [null, 'grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'planks', 'crystal', 'bedrock', 'brick', 'torch'];
const _im = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const chunkMap = new Map();
const chunkGroups = [];
const _toRemove = [];
let chunkStreamTimer = 0.99;
let chunkFrameCount = 0;
let _worker = null;
let _workerFailed = false;
const _workerPending = new Map();

function chunkKeyOf(cx, cz) { return cx + '|' + cz; }

// All generation math lives in ./world-terrain.js (globalThis.MCTerrain),
// prepended verbatim to this engine blob by boot() and importScripts-ed by
// the worker. This file only calls into it — no duplicate implementation.
function generateBaseChunkInto(heights, cx, cz) {
  const modsForChunk = {};
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  for (const key in modifications) {
    const p = key.split(',');
    const mx = Number(p[0]);
    const mz = Number(p[2]);
    if (mx >= x0 && mx < x0 + CHUNK_SIZE && mz >= z0 && mz < z0 + CHUNK_SIZE) {
      modsForChunk[key] = modifications[key] ? (TYPE_IDS[modifications[key]] || 0) : 0;
    }
  }
  MCTerrain.generateChunkHeights(heights, cx, cz, {
    chunk: CHUNK_SIZE, worldHeight: WORLD_HEIGHT, radius: WORLD_RADIUS,
    seaLevel: SEA_LEVEL, seed: worldSeed, mods: modsForChunk
  });
}

function generateChunkData(cx, cz) {
  const heights = new Float32Array((CHUNK_SIZE + 8) * (CHUNK_SIZE + 8) * (WORLD_HEIGHT + 1));
  generateBaseChunkInto(heights, cx, cz);
  return heights;
}

// Analytic surface used by collisionLookup for chunks that haven't been
// generated yet, so physics/mobs/minimap never see holes at the frontier.
// Mirrors the surface choice in MCTerrain.surfaceFor for the top block.
function fallbackSurfaceType(x, z) {
  const rv = MCTerrain.riverInfo(x, z, worldSeed);
  const h = MCTerrain.terrainHeight(x, z, worldSeed, SEA_LEVEL);
  const surf = MCTerrain.surfaceFor(h, rv, x, z, worldSeed, SEA_LEVEL);
  return { h, top: surf.top };
}

// Mesher: emits one InstancedMesh per block type per chunk, skipping any
// block whose 6 neighbours are all solid (hidden internal faces). Margins
// make cross-chunk borders cull correctly. Reuses the module-level _im
// matrix instead of allocating per instance.
function buildChunkMeshFromData(entry) {
  const heights = entry.heights;
  const size = CHUNK_SIZE + 8;
  const H1 = WORLD_HEIGHT + 1;
  const x0 = entry.cx * CHUNK_SIZE;
  const z0 = entry.cz * CHUNK_SIZE;
  function cget(lx, y, lz) {
    if (lx < 0 || lz < 0 || lx >= size || lz >= size || y < 0 || y > WORLD_HEIGHT) return 0;
    return heights[(lz * size + lx) * H1 + y];
  }
  const buckets = new Map();
  for (let lx = 4; lx < size - 4; lx += 1) {
    for (let lz = 4; lz < size - 4; lz += 1) {
      const base = (lz * size + lx) * H1;
      for (let y = 0; y <= WORLD_HEIGHT; y += 1) {
        const t = heights[base + y];
        if (!t) continue;
        if (cget(lx + 1, y, lz) && cget(lx - 1, y, lz) && cget(lx, y + 1, lz) && cget(lx, y - 1, lz) && cget(lx, y, lz + 1) && cget(lx, y, lz - 1)) continue;
        const wx = x0 + lx - 4;
        const wz = z0 + lz - 4;
        if (Math.abs(wx) > WORLD_RADIUS || Math.abs(wz) > WORLD_RADIUS) continue;
        let arr = buckets.get(t);
        if (!arr) { arr = []; buckets.set(t, arr); }
        arr.push(wx, y, wz);
      }
    }
  }
  const group = new THREE.Group();
  group.userData.chunkKey = entry.key;
  let visibleCount = 0;
  for (const [t, arr] of buckets) {
    const type = IDS_TYPE[t];
    const def = blockTypes[type];
    if (!def || arr.length === 0) continue;
    const mesh = new THREE.InstancedMesh(blockGeometry, def.materials, arr.length / 3);
    mesh.castShadow = qualityHigh && type !== 'leaves' && type !== 'torch';
    mesh.receiveShadow = qualityHigh;
    mesh.userData.type = type;
    mesh.userData.positions = new Array(arr.length / 3);
    for (let i = 0, j = 0; i < arr.length; i += 3, j += 1) {
      _im.makeTranslation(arr[i], arr[i + 1], arr[i + 2]);
      mesh.setMatrixAt(j, _im);
      mesh.userData.positions[j] = { x: arr[i], y: arr[i + 1], z: arr[i + 2] };
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    visibleCount += arr.length / 3;
  }
  entry.visibleCount = visibleCount;
  return group;
}

// Geometry is the shared blockGeometry and materials are shared per block
// type, so disposal means detaching from the scene + our registries only.
function disposeChunkGroup(group) {
  scene.remove(group);
  const gi = chunkGroups.indexOf(group);
  if (gi >= 0) chunkGroups.splice(gi, 1);
}
function dropChunk(cx, cz) {
  const key = chunkKeyOf(cx, cz);
  _workerPending.delete(key);
  const e = chunkMap.get(key);
  if (e && e.group) disposeChunkGroup(e.group);
  chunkMap.delete(key);
}

// Terrain worker (./world-worker.js, classic worker — no bundler needed).
// Falls back to synchronous on-thread generation if construction fails.
function getWorldWorker() {
  if (_worker || _workerFailed) return _worker;
  try {
    _worker = new Worker('./world-worker.js');
    _worker.onmessage = (event) => {
      const d = event.data;
      if (!d || d.type !== 'chunk') return;
      const entry = chunkMap.get(d.key);
      _workerPending.delete(d.key);
      if (!entry || entry.group) return; // superseded (edit re-meshed it)
      entry.heights = d.heights;
      entry.group = buildChunkMeshFromData(entry);
      scene.add(entry.group);
      chunkGroups.push(entry.group);
    };
    _worker.onerror = () => {
      _workerFailed = true;
      if (_worker) { _worker.terminate(); _worker = null; }
      _workerPending.clear();
    };
  } catch (err) {
    _workerFailed = true;
  }
  return _worker;
}

// Block lookup against the chunked store (block id, 0 = air/unknown).
// Ungenerated chunks fall back to the analytic terrain height so physics,
// mob spawning, and the minimap never see holes at the stream frontier.
function collisionLookup(x, y, z) {
  if (y < 0 || y > WORLD_HEIGHT) return 0;
  if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS) return 0;
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const e = chunkMap.get(chunkKeyOf(cx, cz));
  if (!e) return 0;
  if (!e.heights) {
    const s = fallbackSurfaceType(x, z);
    if (y > s.h) return 0;
    return y === s.h ? s.top : (y >= s.h - 2 ? (s.top === 1 ? 2 : s.top) : 3);
  }
  const size = CHUNK_SIZE + 8;
  return e.heights[((z - cz * CHUNK_SIZE + 4) * size + (x - cx * CHUNK_SIZE + 4)) * (WORLD_HEIGHT + 1) + y];
}

// Synchronous initial fill around spawn (replaces the old full-world
// rebuild; now bounded by render distance instead of WORLD_RADIUS).
function mcPrimeChunks() {
  const pcx = Math.floor(camera.position.x / CHUNK_SIZE);
  const pcz = Math.floor(camera.position.z / CHUNK_SIZE);
  const rd = mcRenderDistance();
  for (let dx = -rd; dx <= rd; dx += 1) {
    for (let dz = -rd; dz <= rd; dz += 1) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      if (cx < CHUNK_X_MIN || cx > CHUNK_X_MAX || cz < CHUNK_Z_MIN || cz > CHUNK_Z_MAX) continue;
      const key = chunkKeyOf(cx, cz);
      if (chunkMap.has(key)) continue;
      const entry = { key, cx, cz, heights: generateChunkData(cx, cz), group: null, visibleCount: 0 };
      entry.group = buildChunkMeshFromData(entry);
      chunkMap.set(key, entry);
      scene.add(entry.group);
      chunkGroups.push(entry.group);
    }
  }
  refreshChunkVisibility();
}

// Frustum + fog-distance culling, evaluated at chunk granularity. Reuses
// module-level matrix/sphere temporaries (no per-frame allocation).
function refreshChunkVisibility() {
  camera.updateMatrixWorld();
  _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreen);
  const fogFar = scene.fog ? scene.fog.far : 130;
  const maxD = fogFar + CHUNK_SIZE * 1.5;
  for (const g of chunkGroups) {
    const e = chunkMap.get(g.userData.chunkKey);
    if (!e) { g.visible = false; continue; }
    const midX = (e.cx + 0.5) * CHUNK_SIZE - 0.5;
    const midZ = (e.cz + 0.5) * CHUNK_SIZE - 0.5;
    _sphere.center.set(midX, WORLD_HEIGHT / 2, midZ);
    _sphere.radius = Math.hypot(CHUNK_SIZE, WORLD_HEIGHT + 2, CHUNK_SIZE) / 2;
    const ddx = midX - camera.position.x;
    const ddz = midZ - camera.position.z;
    g.visible = (ddx * ddx + ddz * ddz <= maxD * maxD) && _frustum.intersectsSphere(_sphere);
  }
}

// Per-frame streaming: request missing chunks inside render distance
// (nearest-first on the fallback path, budgeted per tick and gated by the
// quality toggle) and dispose chunks beyond the unload radius.
function streamChunks(delta) {
  chunkStreamTimer += delta;
  if (chunkStreamTimer < 0.12) return;
  chunkStreamTimer = 0;
  const pcx = Math.floor(camera.position.x / CHUNK_SIZE);
  const pcz = Math.floor(camera.position.z / CHUNK_SIZE);
  const rd = mcRenderDistance();
  const w = getWorldWorker();
  let budget = mcStreamBudget();
  let bestDx = 0;
  let bestDz = 0;
  let bestD2 = Infinity;
  for (let dx = -rd; dx <= rd && budget > 0; dx += 1) {
    for (let dz = -rd; dz <= rd && budget > 0; dz += 1) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      if (cx < CHUNK_X_MIN || cx > CHUNK_X_MAX || cz < CHUNK_Z_MIN || cz > CHUNK_Z_MAX) continue;
      const key = chunkKeyOf(cx, cz);
      if (chunkMap.has(key) || _workerPending.has(key)) continue;
      if (w) {
        const mods = [];
        const x0 = cx * CHUNK_SIZE;
        const z0 = cz * CHUNK_SIZE;
        for (const k in modifications) {
          const p = k.split(',');
          const mx = Number(p[0]);
          const mz = Number(p[2]);
          if (mx >= x0 && mx < x0 + CHUNK_SIZE && mz >= z0 && mz < z0 + CHUNK_SIZE) {
            mods.push(mx, Number(p[1]), mz, modifications[k] ? (TYPE_IDS[modifications[k]] || 0) : 0);
          }
        }
        // (worker data layout matches generateChunkData: 4-wide margins)
        const entry = { key, cx, cz, heights: null, group: null, visibleCount: 0 };
        chunkMap.set(key, entry);
        _workerPending.set(key, true);
        w.postMessage({ type: 'generate', key, cx, cz, chunk: CHUNK_SIZE, worldHeight: WORLD_HEIGHT, radius: WORLD_RADIUS, seaLevel: SEA_LEVEL, seed: worldSeed, mods });
        budget -= 1;
      } else {
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestDx = dx; bestDz = dz; }
      }
    }
  }
  if (!w && bestD2 < Infinity) {
    const cx = pcx + bestDx;
    const cz = pcz + bestDz;
    const key = chunkKeyOf(cx, cz);
    const entry = { key, cx, cz, heights: generateChunkData(cx, cz), group: null, visibleCount: 0 };
    entry.group = buildChunkMeshFromData(entry);
    chunkMap.set(key, entry);
    scene.add(entry.group);
    chunkGroups.push(entry.group);
  }
  const ud = mcUnloadDistance();
  _toRemove.length = 0;
  for (const e of chunkMap.values()) {
    if (Math.abs(e.cx - pcx) > ud || Math.abs(e.cz - pcz) > ud) _toRemove.push(e);
  }
  for (const e of _toRemove) dropChunk(e.cx, e.cz);
}

// Local re-mesh after a block edit: regenerate the affected chunk's data
// (base terrain + current modifications) and rebuild its group. Border
// edits also refresh the neighbour chunk so culling stays correct.
function remeshEditedChunk(x, z) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const key = chunkKeyOf(cx, cz);
  const e = chunkMap.get(key);
  if (!e) return;
  if (!e.heights) e.heights = new Float32Array((CHUNK_SIZE + 8) * (CHUNK_SIZE + 8) * (WORLD_HEIGHT + 1));
  generateBaseChunkInto(e.heights, cx, cz);
  if (e.group) disposeChunkGroup(e.group);
  e.group = buildChunkMeshFromData(e);
  scene.add(e.group);
  chunkGroups.push(e.group);
}
function remeshAroundEdit(x, z) {
  remeshEditedChunk(x, z);
  const lx = x - Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
  const lz = z - Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
  if (lx === 0) remeshEditedChunk(x - 1, z);
  if (lx === CHUNK_SIZE - 1) remeshEditedChunk(x + 1, z);
  if (lz === 0) remeshEditedChunk(x, z - 1);
  if (lz === CHUNK_SIZE - 1) remeshEditedChunk(x, z + 1);
}
const SEA_LEVEL = 4;
const PLAYER_HEIGHT = 1.75;
const EYE_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.3;
const WALK_SPEED = 4.8;
const SPRINT_SPEED = 7.2;
const JUMP_SPEED = 7.1;
const GRAVITY = 20;
const MAX_REACH = 6;
const MAX_STACK = 64;
const MAX_HEALTH = 10;
const MAX_STAMINA = 100;
const DAY_DURATION_SECONDS = 180;
const INITIAL_INVENTORY = Object.freeze({
  grass: 12,
  dirt: 18,
  stone: 12,
  sand: 10,
  wood: 8,
  planks: 0,
  brick: 0,
  torch: 0,
  wood_sword: 1,
  stone_sword: 0,
  apple: 2
});

const gameRoot = document.querySelector('#game');
const menu = document.querySelector('#menu');
const hud = document.querySelector('#hud');
const playButton = document.querySelector('#play-button');
const saveButton = document.querySelector('#save-button');
const resetButton = document.querySelector('#reset-button');
const craftButton = document.querySelector('#craft-button');
const screenshotButton = document.querySelector('#screenshot-button');
const seedButton = document.querySelector('#seed-button');
const qualityButton = document.querySelector('#quality-button');
const soundButton = document.querySelector('#sound-button');
const shareButton = document.querySelector('#share-button');
const hotbar = document.querySelector('#hotbar');
const selectedLabel = document.querySelector('#selected-label');
const statsElement = document.querySelector('#stats');
const worldInfo = document.querySelector('#world-info');
const toastElement = document.querySelector('#toast');
const loading = document.querySelector('#loading');
const playerHand = document.querySelector('#player-hand');
const heldBlock = document.querySelector('#held-block');
const crosshair = document.querySelector('#crosshair');
const interactionHint = document.querySelector('#interaction-hint');
const heartsElement = document.querySelector('#hearts');
const staminaFill = document.querySelector('#stamina-fill');
const questTitle = document.querySelector('#quest-title');
const questProgress = document.querySelector('#quest-progress');
const questDetail = document.querySelector('#quest-detail');
const worldClock = document.querySelector('#world-clock');
const timeIcon = document.querySelector('#time-icon');
const scoreLabel = document.querySelector('#score-label');
const minimap = document.querySelector('#minimap');
const minimapContext = minimap.getContext('2d');
const damageFlash = document.querySelector('#damage-flash');
const craftPanel = document.querySelector('#craft-panel');
const craftClose = document.querySelector('#craft-close');
const recipeList = document.querySelector('#recipe-list');
const deathScreen = document.querySelector('#death-screen');
const deathSummary = document.querySelector('#death-summary');
const respawnButton = document.querySelector('#respawn-button');
const touchControls = document.querySelector('#touch-controls');
const touchLook = document.querySelector('#touch-look');
const touchJump = document.querySelector('#touch-jump');
const touchMine = document.querySelector('#touch-mine');
const touchPlace = document.querySelector('#touch-place');
const touchAttack = document.querySelector('#touch-attack');
const pauseButton = document.querySelector('#pause-button');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7eb8e8);
scene.fog = new THREE.Fog(0x7eb8e8, 22, 62);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 130);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
gameRoot.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
raycaster.far = MAX_REACH;
const centerScreen = new THREE.Vector2(0, 0);

const hemiLight = new THREE.HemisphereLight(0xc8e8ff, 0x5d6841, 1.55);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff0c2, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.00035;
scene.add(sun);

const moon = new THREE.DirectionalLight(0x8fb5ff, 0.25);
scene.add(moon);

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const particleGeometry = new THREE.BoxGeometry(0.11, 0.11, 0.11);
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
);
outline.visible = false;
scene.add(outline);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededRandom2D(x, z, seed) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.017) * 43758.5453123;
  return value - Math.floor(value);
}

function makeTexture(baseHex, options = {}) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const base = new THREE.Color(baseHex);
  context.fillStyle = `#${base.getHexString()}`;
  context.fillRect(0, 0, size, size);

  const pixels = context.getImageData(0, 0, size, size);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const variation = (Math.random() - 0.5) * (options.noise ?? 30);
    pixels.data[i] = clamp(pixels.data[i] + variation, 0, 255);
    pixels.data[i + 1] = clamp(pixels.data[i + 1] + variation, 0, 255);
    pixels.data[i + 2] = clamp(pixels.data[i + 2] + variation, 0, 255);
  }
  context.putImageData(pixels, 0, 0);

  if (options.speckles) {
    for (let i = 0; i < options.speckles; i += 1) {
      context.fillStyle = options.speckleColor ?? 'rgba(0,0,0,.18)';
      context.fillRect(Math.floor(Math.random() * size), Math.floor(Math.random() * size), Math.random() > 0.82 ? 2 : 1, 1);
    }
  }
  if (options.grassSide) {
    context.fillStyle = '#65ad3d';
    context.fillRect(0, 0, size, 4);
    for (let x = 0; x < size; x += 1) context.fillRect(x, 4, 1, Math.floor(Math.random() * 4));
  }
  if (options.wood) {
    context.strokeStyle = 'rgba(55,29,10,.3)';
    for (let x = 2; x < size; x += 4) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + (Math.random() > 0.5 ? 1 : -1), size);
      context.stroke();
    }
  }
  if (options.rings) {
    context.strokeStyle = 'rgba(78,42,18,.42)';
    context.strokeRect(2.5, 2.5, 11, 11);
    context.strokeRect(5.5, 5.5, 5, 5);
  }
  if (options.planks) {
    context.strokeStyle = 'rgba(60,31,14,.45)';
    for (let y = 3; y < size; y += 5) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
    }
    context.fillStyle = 'rgba(55,25,10,.35)';
    context.fillRect(7, 0, 1, 3);
    context.fillRect(3, 8, 1, 5);
    context.fillRect(12, 13, 1, 3);
  }
  if (options.bricks) {
    context.strokeStyle = 'rgba(55,20,16,.55)';
    for (let y = 0; y <= size; y += 5) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
    }
    for (let y = 0; y < size; y += 5) {
      const offset = (Math.floor(y / 5) % 2) * 4;
      for (let x = offset; x < size; x += 8) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, Math.min(size, y + 5));
        context.stroke();
      }
    }
  }
  if (options.crystal) {
    context.fillStyle = 'rgba(210,250,255,.82)';
    for (let i = 0; i < 12; i += 1) {
      const x = Math.floor(Math.random() * 14) + 1;
      const y = Math.floor(Math.random() * 14) + 1;
      context.fillRect(x, y, 1 + (i % 2), 2);
    }
  }
  if (options.torch) {
    context.fillStyle = '#5e361c';
    context.fillRect(6, 5, 4, 11);
    context.fillStyle = '#ffd65c';
    context.fillRect(4, 0, 8, 7);
    context.fillStyle = '#ff7b28';
    context.fillRect(6, 1, 4, 5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function material(texture, extra = {}) {
  return new THREE.MeshLambertMaterial({ map: texture, ...extra });
}

const textures = {
  grassTop: makeTexture(0x67b642, { noise: 38, speckles: 24, speckleColor: 'rgba(30,80,15,.18)' }),
  grassSide: makeTexture(0x8b6137, { noise: 26, speckles: 16, grassSide: true }),
  dirt: makeTexture(0x8b6137, { noise: 30, speckles: 24 }),
  stone: makeTexture(0x85888d, { noise: 38, speckles: 20 }),
  sand: makeTexture(0xd8c27d, { noise: 18, speckles: 18, speckleColor: 'rgba(110,92,42,.18)' }),
  woodSide: makeTexture(0x8c5d32, { noise: 24, wood: true }),
  woodTop: makeTexture(0xa37341, { noise: 18, rings: true }),
  leaves: makeTexture(0x3f8e3d, { noise: 48, speckles: 34, speckleColor: 'rgba(15,65,20,.32)' }),
  bedrock: makeTexture(0x34363a, { noise: 52, speckles: 28 }),
  planks: makeTexture(0xb77a43, { noise: 16, planks: true }),
  brick: makeTexture(0xa64f42, { noise: 18, bricks: true }),
  crystal: makeTexture(0x405e75, { noise: 20, crystal: true }),
  torch: makeTexture(0x7c4d26, { noise: 10, torch: true })
};

const simpleMaterials = {
  dirt: material(textures.dirt),
  stone: material(textures.stone),
  sand: material(textures.sand),
  leaves: material(textures.leaves),
  bedrock: material(textures.bedrock),
  planks: material(textures.planks),
  brick: material(textures.brick),
  crystal: new THREE.MeshLambertMaterial({ map: textures.crystal, emissive: 0x17394d, emissiveIntensity: 0.75 }),
  torch: new THREE.MeshLambertMaterial({ map: textures.torch, emissive: 0xff7b22, emissiveIntensity: 1.1 })
};

const blockTypes = {
  grass: {
    label: 'Grass Block', color: '#67b642', hardness: 0.5,
    materials: [
      material(textures.grassSide), material(textures.grassSide),
      material(textures.grassTop), material(textures.dirt),
      material(textures.grassSide), material(textures.grassSide)
    ]
  },
  dirt: { label: 'Dirt', color: '#8b6137', hardness: 0.48, materials: simpleMaterials.dirt },
  stone: { label: 'Stone', color: '#85888d', hardness: 1.15, materials: simpleMaterials.stone },
  sand: { label: 'Sand', color: '#d8c27d', hardness: 0.34, materials: simpleMaterials.sand },
  wood: {
    label: 'Wood', color: '#8c5d32', hardness: 0.82,
    materials: [
      material(textures.woodSide), material(textures.woodSide),
      material(textures.woodTop), material(textures.woodTop),
      material(textures.woodSide), material(textures.woodSide)
    ]
  },
  leaves: { label: 'Leaves', color: '#3f8e3d', hardness: 0.22, materials: simpleMaterials.leaves },
  planks: { label: 'Wood Planks', color: '#b77a43', hardness: 0.62, materials: simpleMaterials.planks },
  brick: { label: 'Stone Bricks', color: '#a64f42', hardness: 1.3, materials: simpleMaterials.brick },
  torch: { label: 'Glow Block', color: '#ffad35', hardness: 0.24, materials: simpleMaterials.torch },
  crystal: { label: 'Crystal Ore', color: '#70dcff', hardness: 1.45, materials: simpleMaterials.crystal },
  bedrock: { label: 'Bedrock', color: '#34363a', hardness: Infinity, materials: simpleMaterials.bedrock, unbreakable: true },
  wood_sword: { label: 'Wood Sword', color: '#c4a574', hardness: 0.01, materials: simpleMaterials.planks, isWeapon: true, damage: 2, cooldown: 0.28, knockback: 4.2, reach: 5.1 },
  stone_sword: { label: 'Stone Sword', color: '#9aa3ad', hardness: 0.01, materials: simpleMaterials.stone, isWeapon: true, damage: 3, cooldown: 0.22, knockback: 5.2, reach: 5.3 },
  apple: { label: 'Apple', color: '#e85d4c', hardness: 0.01, materials: simpleMaterials.dirt, isConsumable: true, heal: 2 }
};

const hotbarTypes = ['grass', 'dirt', 'stone', 'sand', 'wood', 'planks', 'brick', 'torch', 'wood_sword', 'stone_sword', 'apple'];
const recipes = [
  { id: 'planks', output: { type: 'planks', count: 4 }, ingredients: { wood: 1 }, description: 'Turn one log into four building planks.' },
  { id: 'brick', output: { type: 'brick', count: 4 }, ingredients: { stone: 2, dirt: 1 }, description: 'Combine stone and clay-rich dirt into bricks.' },
  { id: 'torch', output: { type: 'torch', count: 4 }, ingredients: { wood: 1, stone: 1 }, description: 'Create glowing blocks for night builds.' },
  { id: 'wood_sword', output: { type: 'wood_sword', count: 1 }, ingredients: { wood: 2, planks: 1 }, description: 'A basic wooden blade. Deals 2 damage to slimes.' },
  { id: 'stone_sword', output: { type: 'stone_sword', count: 1 }, ingredients: { stone: 2, wood: 1 }, description: 'A sturdy stone blade. Deals 3 damage to slimes.' },
  { id: 'apple', output: { type: 'apple', count: 2 }, ingredients: { leaves: 2, wood: 1 }, description: 'Snack that restores 2 hearts. Right-click or press F while selected.' }
];
const challenges = [
  { stat: 'mined', target: 10, title: 'Resource Collector', label: 'Mine blocks' },
  { stat: 'placed', target: 10, title: 'First Shelter', label: 'Place blocks' },
  { stat: 'crafted', target: 3, title: 'Workbench Apprentice', label: 'Craft recipes' },
  { stat: 'kills', target: 3, title: 'Night Defender', label: 'Defeat mobs at night' },
  { stat: 'crystals', target: 3, title: 'Crystal Hunter', label: 'Mine crystals' },
  { stat: 'kills', target: 8, title: 'Mob Hunter', label: 'Defeat hostile mobs' }
];

let selectedIndex = 0;
let worldSeed = 0;
let worldTime = 0.32;
let dayCount = 1;
let modifications = {};
let inventory = { ...INITIAL_INVENTORY };
let playerState = { health: MAX_HEALTH, stamina: MAX_STAMINA, score: 0, crystals: 0 };
let gameStats = { mined: 0, placed: 0, crafted: 0, kills: 0, crystals: 0 };
let challengeIndex = 0;
let qualityHigh = true;
let soundEnabled = true;
let isDead = false;
let touchActive = false;
let modalOpen = false;
let currentNightFactor = 0;

const blocks = new Map();
const blockMeshes = [];
const particles = [];
const blockAnimations = [];
const mobs = [];
const mobHitMeshes = [];
const keys = new Set();
const velocity = new THREE.Vector3();
let grounded = false;
let fallDistance = 0;
let currentTarget = null;
let currentMobTarget = null;
let saveTimer = null;
let toastTimer = null;
let audioContext = null;
let leftMouseDown = false;
let miningTargetKey = null;
let miningProgress = 0;
let miningCooldown = 0;
let handSwingCooldown = 0;
let attackCooldown = 0;
let meshRebuildCountdown = null;
let mobSpawnTimer = 4;
let minimapTimer = 0;
let saveIndicatorTimer = 0;
let lastWorldTime = worldTime;
let isUnderwater = false;
let wasInWater = false;
let waterRippleTime = 0;
let combatTimer = 0;
let killStreak = 0;
const splashParticles = [];
const bubbleParticles = [];
let underwaterOverlay = null;
let waterBase = null;
let bubbleSpawnTimer = 0;
let underwaterFogBlend = 0;
const surfaceFogNear = qualityHigh ? 30 : 16;
const surfaceFogFar = qualityHigh ? 85 : 40;
const splashGeometry = new THREE.SphereGeometry(0.055, 6, 6);
const bubbleGeometry = new THREE.SphereGeometry(1, 8, 8);

const FIST = { damage: 1, cooldown: 0.34, knockback: 3.2, reach: 4.6, label: 'Fist' };

function getSelectedDef() {
  const type = hotbarTypes[selectedIndex];
  return blockTypes[type] || null;
}

function getActiveWeapon() {
  const def = getSelectedDef();
  if (def?.isWeapon && (inventory[hotbarTypes[selectedIndex]] ?? 0) > 0) {
    return {
      type: hotbarTypes[selectedIndex],
      damage: def.damage ?? 1,
      cooldown: def.cooldown ?? 0.3,
      knockback: def.knockback ?? 3.2,
      reach: def.reach ?? 4.6,
      label: def.label ?? 'Weapon'
    };
  }
  return { type: 'fist', ...FIST };
}

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

function spawnSplash(x, y, z, intensity = 1) {
  const count = Math.floor((qualityHigh ? 14 : 8) * intensity);
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xb6ecff, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(splashGeometry, mat);
    mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.1, z + (Math.random() - 0.5) * 0.5);
    mesh.scale.setScalar(0.5 + Math.random() * 0.9);
    scene.add(mesh);
    splashParticles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2.2 * intensity, (2 + Math.random() * 3.2) * intensity, (Math.random() - 0.5) * 2.2 * intensity),
      life: 0.4 + Math.random() * 0.3,
      maxLife: 0.75
    });
  }
  try { playTone(210 + Math.random() * 40, 0.04, 0.016, 'sine'); } catch (e) {}
}

function spawnBubble(x, y, z, sizeScale = 1) {
  const radius = (0.04 + Math.random() * 0.08) * sizeScale;
  const mat = new THREE.MeshPhongMaterial({ color: 0xd8f6ff, transparent: true, opacity: 0.5, shininess: 120, specular: 0xffffff, depthWrite: false });
  const mesh = new THREE.Mesh(bubbleGeometry, mat);
  mesh.scale.setScalar(radius);
  mesh.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
  mesh.renderOrder = 3;
  scene.add(mesh);
  bubbleParticles.push({
    mesh,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.55 + Math.random() * 0.8, (Math.random() - 0.5) * 0.25),
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 2 + Math.random() * 2.5,
    life: 1.4 + Math.random() * 1.6,
    maxLife: 3,
    baseScale: radius
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
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      splashParticles.splice(i, 1);
    }
  }
}

function updateBubbleParticles(delta) {
  if (isUnderwater) {
    bubbleSpawnTimer -= delta;
    if (bubbleSpawnTimer <= 0) {
      bubbleSpawnTimer = qualityHigh ? 0.14 + Math.random() * 0.16 : 0.24 + Math.random() * 0.25;
      const feetY = camera.position.y - EYE_HEIGHT;
      spawnBubble(camera.position.x + (Math.random() - 0.5) * 1.2, feetY + 0.2 + Math.random() * 0.5, camera.position.z + (Math.random() - 0.5) * 1.2, 0.85);
    }
  } else bubbleSpawnTimer = 0;
  for (let i = bubbleParticles.length - 1; i >= 0; i -= 1) {
    const b = bubbleParticles[i];
    b.life -= delta;
    b.wobble += b.wobbleSpeed * delta;
    b.mesh.position.x += Math.sin(b.wobble) * 0.35 * delta + b.velocity.x * delta;
    b.mesh.position.z += Math.cos(b.wobble * 0.85) * 0.28 * delta + b.velocity.z * delta;
    b.mesh.position.y += b.velocity.y * delta;
    b.mesh.scale.setScalar(b.baseScale * (1 + Math.sin(b.wobble * 1.4) * 0.08));
    b.mesh.material.opacity = Math.min(0.7, 0.25 + Math.max(0, b.life / (b.maxLife || 3)) * 0.45);
    if (b.mesh.position.y >= SEA_LEVEL + 0.35 || b.life <= 0) {
      if (b.mesh.position.y >= SEA_LEVEL + 0.2) spawnSplash(b.mesh.position.x, SEA_LEVEL + 0.45, b.mesh.position.z, 0.15);
      scene.remove(b.mesh);
      b.mesh.material.dispose();
      bubbleParticles.splice(i, 1);
    }
  }
}

function updateUnderwaterFog(delta, daylight) {
  const depthBelow = Math.max(0, (SEA_LEVEL + 0.35) - camera.position.y);
  const targetBlend = depthBelow > 0 ? Math.min(1, 0.35 + depthBelow / 2.2) : 0;
  underwaterFogBlend += (targetBlend - underwaterFogBlend) * Math.min(1, delta * (targetBlend > underwaterFogBlend ? 5.5 : 3.2));
  if (underwaterFogBlend < 0.001) underwaterFogBlend = 0;
  const overlay = ensureUnderwaterOverlay();
  if (underwaterFogBlend > 0) {
    const fogColor = new THREE.Color(0x1a6b7e).lerp(new THREE.Color(0x0c4558), Math.min(1, underwaterFogBlend * 1.2));
    fogColor.lerp(new THREE.Color(0x031820), Math.max(0, underwaterFogBlend - 0.45) / 0.55);
    if (daylight < 0.35) fogColor.lerp(new THREE.Color(0x01080e), ((0.35 - daylight) / 0.35) * 0.45);
    const near = 0.4 + (1 - underwaterFogBlend) * 2.8;
    const far = 5.5 + (1 - underwaterFogBlend) * 14;
    if (!scene.fog) scene.fog = new THREE.Fog(fogColor.getHex(), near, far);
    else { scene.fog.color.copy(fogColor); scene.fog.near = near; scene.fog.far = far; }
    scene.background.copy(fogColor);
    hemiLight.intensity = (0.22 + daylight * 1.35) * (1 - underwaterFogBlend * 0.72);
    sun.intensity = (0.12 + daylight * 2.25) * (1 - underwaterFogBlend * 0.8);
    overlay.style.opacity = String(0.35 + underwaterFogBlend * 0.65);
    overlay.classList.add('active');
  } else {
    if (scene.fog) { scene.fog.near = surfaceFogNear; scene.fog.far = surfaceFogFar; }
    overlay.style.opacity = '';
    overlay.classList.remove('active');
  }
}

function tryConsumeApple() {
  const type = hotbarTypes[selectedIndex];
  const def = blockTypes[type];
  if (!def?.isConsumable || (inventory[type] ?? 0) <= 0) return false;
  if (playerState.health >= MAX_HEALTH) {
    showToast('Health is already full');
    return true;
  }
  inventory[type] -= 1;
  playerState.health = Math.min(MAX_HEALTH, playerState.health + (def.heal ?? 2));
  buildHotbar();
  updateHealthUI();
  playTone(520, 0.06, 0.03, 'sine');
  showToast('Ate apple · +' + (def.heal ?? 2) + ' health');
  queueSave();
  return true;
}

function keyOf(x, y, z) {
  return `${x},${y},${z}`;
}

function parseKey(key) {
  return key.split(',').map(Number);
}

function setBlockRaw(x, y, z, type) {
  const key = keyOf(x, y, z);
  if (type) blocks.set(key, type);
  else blocks.delete(key);
}

function getBlock(x, y, z) {
  const id = collisionLookup(x, y, z);
  return id ? IDS_TYPE[id] : undefined;
}

function terrainHeight(x, z) {
  const broad = Math.sin((x + worldSeed * 0.001) * 0.18) * 1.45 + Math.cos((z - worldSeed * 0.001) * 0.16) * 1.3;
  const detail = (seededRandom2D(x, z, worldSeed) - 0.5) * 2.2;
  const ridge = Math.sin((x + z) * 0.08) * 0.85;
  return clamp(Math.floor(5.5 + broad + detail + ridge), 3, 10);
}

function generateBaseWorld() {
  blocks.clear();
  for (const key of [...chunkMap.keys()]) {
    const p = key.split('|');
    dropChunk(Number(p[0]), Number(p[1]));
  }
  _workerPending.clear();
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const height = terrainHeight(x, z);
      for (let y = 0; y <= height; y += 1) {
        let type = 'stone';
        if (y === 0) type = 'bedrock';
        else if (y === height) type = height <= SEA_LEVEL ? 'sand' : 'grass';
        else if (y >= height - 2) type = height <= SEA_LEVEL ? 'sand' : 'dirt';
        else if (y > 1 && seededRandom2D(x * 9 + y * 13, z * 11 - y * 5, worldSeed) > 0.982) type = 'crystal';
        setBlockRaw(x, y, z, type);
      }
    }
  }

  for (let x = -WORLD_RADIUS + 2; x <= WORLD_RADIUS - 2; x += 1) {
    for (let z = -WORLD_RADIUS + 2; z <= WORLD_RADIUS - 2; z += 1) {
      const height = terrainHeight(x, z);
      const treeChance = seededRandom2D(x * 3 + 17, z * 5 - 11, worldSeed);
      const nearSpawn = Math.abs(x) < 3 && Math.abs(z) < 3;
      if (height > SEA_LEVEL && treeChance > 0.965 && !nearSpawn && getBlock(x, height, z) === 'grass') {
        const trunkHeight = treeChance > 0.988 ? 4 : 3;
        for (let y = 1; y <= trunkHeight; y += 1) setBlockRaw(x, height + y, z, 'wood');
        const crownY = height + trunkHeight;
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dz = -2; dz <= 2; dz += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
              if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 4) continue;
              const bx = x + dx;
              const by = crownY + dy;
              const bz = z + dz;
              if (!getBlock(bx, by, bz)) setBlockRaw(bx, by, bz, 'leaves');
            }
          }
        }
        if (!getBlock(x, crownY + 2, z)) setBlockRaw(x, crownY + 2, z, 'leaves');
      }
    }
  }

  for (const [key, type] of Object.entries(modifications)) {
    const [x, y, z] = parseKey(key);
    setBlockRaw(x, y, z, type);
  }
}

function isExposed(x, y, z) {
  return !getBlock(x + 1, y, z)
    || !getBlock(x - 1, y, z)
    || !getBlock(x, y + 1, z)
    || !getBlock(x, y - 1, z)
    || !getBlock(x, y, z + 1)
    || !getBlock(x, y, z - 1);
}

function rebuildWorldMeshes() {
  mcPrimeChunks();
  blockMeshes.length = 0;
}

function makeCrackTexture(stage, totalStages) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.strokeStyle = 'rgba(20,15,12,.94)';
  context.lineWidth = 2.2;
  const branches = [
    [[32,31],[24,20],[17,15],[12,7]], [[31,32],[40,24],[49,22],[58,15]],
    [[32,32],[39,41],[44,51],[52,59]], [[31,33],[23,42],[16,50],[6,55]],
    [[27,26],[19,28],[12,34]], [[38,28],[45,34],[56,36]],
    [[35,40],[30,49],[31,61]], [[24,39],[13,40],[4,35]], [[40,23],[42,13],[49,5]]
  ];
  const visible = Math.ceil(((stage + 1) / totalStages) * branches.length);
  branches.slice(0, visible).forEach((points, branchIndex) => {
    context.beginPath();
    points.forEach(([x, y], pointIndex) => {
      const jitter = ((stage + branchIndex + pointIndex) % 3) - 1;
      if (pointIndex === 0) context.moveTo(x + jitter, y - jitter);
      else context.lineTo(x + jitter, y - jitter);
    });
    context.stroke();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

const CRACK_STAGE_COUNT = 7;
const crackTextures = Array.from({ length: CRACK_STAGE_COUNT }, (_, index) => makeCrackTexture(index, CRACK_STAGE_COUNT));
const crackMaterial = new THREE.MeshBasicMaterial({ map: crackTextures[0], transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.016, 1.016, 1.016), crackMaterial);
crackMesh.visible = false;
crackMesh.renderOrder = 4;
scene.add(crackMesh);

function createClouds() {
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 });
  const cloudGroup = new THREE.Group();
  for (let i = 0; i < 14; i += 1) {
    const cloud = new THREE.Group();
    const pieces = 3 + Math.floor(Math.random() * 4);
    for (let p = 0; p < pieces; p += 1) {
      const cube = new THREE.Mesh(blockGeometry, cloudMaterial);
      cube.scale.set(2 + Math.random() * 2.5, 0.45 + Math.random() * 0.35, 1.2 + Math.random() * 1.5);
      cube.position.set(p * 1.4, Math.random() * 0.4, (Math.random() - 0.5) * 1.6);
      cloud.add(cube);
    }
    cloud.position.set((Math.random() - 0.5) * 70, 17 + Math.random() * 7, (Math.random() - 0.5) * 70);
    cloud.userData.speed = 0.28 + Math.random() * 0.22;
    cloudGroup.add(cloud);
  }
  scene.add(cloudGroup);
  return cloudGroup;
}

function createStars() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  for (let i = 0; i < 420; i += 1) {
    const radius = 54 + Math.random() * 42;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.08 + Math.random() * 0.82);
    positions.push(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius + 18,
      Math.sin(phi) * Math.sin(theta) * radius
    );
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.34, transparent: true, opacity: 0, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return points;
}

const clouds = createClouds();
const stars = createStars();
const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 64, 64);
const waterMaterial = new THREE.MeshPhongMaterial({ color: 0x1a7ab8, transparent: true, opacity: 0.62, shininess: 140, specular: 0xa8d8ff, depthWrite: false, side: THREE.DoubleSide });
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI / 2;
water.position.y = SEA_LEVEL + 0.42;
water.renderOrder = 2;
water.receiveShadow = true;
scene.add(water);
waterBase = new Float32Array(water.geometry.attributes.position.array.length);
waterBase.set(water.geometry.attributes.position.array);
ensureUnderwaterOverlay();

function sanitizeInventory(candidate) {
  const clean = { ...INITIAL_INVENTORY };
  if (!candidate || typeof candidate !== 'object') return clean;
  for (const type of hotbarTypes) {
    const value = Number(candidate[type]);
    if (Number.isFinite(value)) clean[type] = clamp(Math.floor(value), 0, MAX_STACK);
  }
  return clean;
}

function loadWorldState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const saved = JSON.parse(raw);
    if (saved && Number.isFinite(saved.seed) && saved.modifications && typeof saved.modifications === 'object') {
      worldSeed = saved.seed;
      modifications = saved.modifications;
      inventory = sanitizeInventory(saved.inventory);
      worldTime = Number.isFinite(saved.worldTime) ? saved.worldTime : 0.32;
      dayCount = Number.isFinite(saved.dayCount) ? Math.max(1, Math.floor(saved.dayCount)) : 1;
      playerState = { ...playerState, ...(saved.playerState ?? {}) };
      playerState.health = MAX_HEALTH;
      playerState.stamina = MAX_STAMINA;
      gameStats = { ...gameStats, ...(saved.gameStats ?? {}) };
      challengeIndex = clamp(Number(saved.challengeIndex) || 0, 0, challenges.length);
      qualityHigh = saved.settings?.qualityHigh ?? true;
      soundEnabled = saved.settings?.soundEnabled ?? true;
      return;
    }
  } catch (error) {
    console.warn('Ignoring invalid saved world:', error);
  }
  worldSeed = Math.floor(Math.random() * 1_000_000_000);
  modifications = {};
  inventory = { ...INITIAL_INVENTORY };
}

function saveWorld(showConfirmation = false) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 3,
      seed: worldSeed,
      worldTime,
      dayCount,
      modifications,
      inventory,
      playerState: { score: playerState.score, crystals: playerState.crystals },
      gameStats,
      challengeIndex,
      settings: { qualityHigh, soundEnabled }
    }));
    saveIndicatorTimer = 1.6;
    if (showConfirmation) showToast('World saved locally');
    updateWorldInfo();
  } catch (error) {
    console.error(error);
    showToast('Unable to save: browser storage is unavailable');
  }
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveWorld(false), 350);
}

function updateWorldInfo() {
  const totalInventory = hotbarTypes.reduce((total, type) => total + (inventory[type] ?? 0), 0);
  worldInfo.textContent = `Seed ${worldSeed} · Day ${dayCount} · ${Object.keys(modifications).length} edited blocks · ${totalInventory} inventory blocks`;
}

function buildHotbar() {
  hotbar.replaceChildren();
  hotbarTypes.forEach((type, index) => {
    const definition = blockTypes[type];
    const count = inventory[type] ?? 0;
    const slot = document.createElement('div');
    slot.className = `hotbar-slot${index === selectedIndex ? ' selected' : ''}${count === 0 ? ' empty' : ''}`;
    slot.title = `${definition.label}: ${count}/${MAX_STACK}`;
    const isSword = Boolean(definition.isWeapon);
    const swatchClass = isSword ? 'block-swatch sword-icon' : 'block-swatch';
    const swatchStyle = isSword ? `--blade-color:${definition.color};color:${definition.color}` : `background:${definition.color}`;
    slot.innerHTML = `<span class="slot-number">${index + 1}</span><span class="${swatchClass}" style="${swatchStyle}">${isSword ? window.__mcSwordSVG : ''}</span><span class="slot-count">${count}</span>`;
    slot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      selectSlot(index);
    });
    hotbar.appendChild(slot);
  });
  const selectedType = hotbarTypes[selectedIndex];
  selectedLabel.textContent = `${blockTypes[selectedType].label} · ${inventory[selectedType]}/${MAX_STACK}`;
  const heldDef = blockTypes[selectedType];
  heldBlock.classList.toggle('sword-icon', Boolean(heldDef.isWeapon));
  if (heldDef.isWeapon) {
    heldBlock.style.background = '';
    heldBlock.style.setProperty('--blade-color', heldDef.color);
    heldBlock.style.color = heldDef.color;
    heldBlock.innerHTML = window.__mcSwordSVG;
  } else {
    heldBlock.style.removeProperty('--blade-color');
    heldBlock.style.color = '';
    heldBlock.innerHTML = '';
    heldBlock.style.background = heldDef.color;
  }
}

function selectSlot(index) {
  if (index < 0 || index >= hotbarTypes.length) return;
  selectedIndex = index;
  buildHotbar();
  playTone(320 + index * 32, 0.025, 0.025);
}

function showToast(message, duration = 1800) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), duration);
}

function playTone(frequency, duration = 0.04, gain = 0.035, type = 'square') {
  if (!soundEnabled) return;
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(gain, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {
    // Audio is optional.
  }
}

function applyQualitySettings() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityHigh ? 2 : 0.75));
  renderer.shadowMap.enabled = qualityHigh;
  sun.castShadow = qualityHigh;
  const shadowSize = qualityHigh ? 3072 : 1024;
  if (sun.shadow.mapSize.width !== shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  renderer.toneMappingExposure = qualityHigh ? 1.08 : 0.98;
  if (scene.fog) {
    scene.fog.near = qualityHigh ? 30 : 16;
    scene.fog.far = qualityHigh ? 85 : 40;
  }
  qualityButton.textContent = `Quality: ${qualityHigh ? 'High' : 'Performance'}`;
  rebuildWorldMeshes();
}

function updateSoundButton() {
  soundButton.textContent = `Sound: ${soundEnabled ? 'On' : 'Off'}`;
}

function updateHealthUI() {
  heartsElement.innerHTML = Array.from({ length: MAX_HEALTH }, (_, index) => `<span class="${index < playerState.health ? '' : 'lost'}">♥</span>`).join('');
  staminaFill.style.width = `${clamp(playerState.stamina, 0, MAX_STAMINA)}%`;
  scoreLabel.textContent = `Score ${Math.floor(playerState.score)} · Crystals ${playerState.crystals}`;
}

function updateStaminaUI() {
  staminaFill.style.width = `${clamp(playerState.stamina, 0, MAX_STAMINA)}%`;
}

function updateChallengeUI() {
  if (challengeIndex >= challenges.length) {
    questTitle.textContent = 'World Master';
    questDetail.textContent = 'All showcase challenges completed';
    questProgress.style.width = '100%';
    return;
  }
  const challenge = challenges[challengeIndex];
  const current = gameStats[challenge.stat] ?? 0;
  questTitle.textContent = challenge.title;
  questDetail.textContent = `${challenge.label} ${Math.min(current, challenge.target)} / ${challenge.target}`;
  questProgress.style.width = `${clamp((current / challenge.target) * 100, 0, 100)}%`;
}

function checkChallenges() {
  let completed = false;
  while (challengeIndex < challenges.length) {
    const challenge = challenges[challengeIndex];
    if ((gameStats[challenge.stat] ?? 0) < challenge.target) break;
    challengeIndex += 1;
    playerState.score += 100;
    completed = true;
    playTone(660, 0.08, 0.04, 'sine');
    window.setTimeout(() => playTone(880, 0.12, 0.04, 'sine'), 80);
  }
  if (completed) showToast(challengeIndex >= challenges.length ? 'All challenges completed · +100 score' : 'Challenge completed · +100 score', 2400);
  updateChallengeUI();
  updateHealthUI();
  queueSave();
}

function formatIngredients(ingredients) {
  return Object.entries(ingredients).map(([type, count]) => `${count} ${blockTypes[type].label}`).join(' + ');
}

function canCraft(recipe) {
  const outputCount = inventory[recipe.output.type] ?? 0;
  if (outputCount + recipe.output.count > MAX_STACK) return false;
  return Object.entries(recipe.ingredients).every(([type, count]) => (inventory[type] ?? 0) >= count);
}

function buildRecipes() {
  recipeList.replaceChildren();
  for (const recipe of recipes) {
    const row = document.createElement('div');
    row.className = 'recipe';
    const available = canCraft(recipe);
    row.innerHTML = `<div><strong>${recipe.output.count} × ${blockTypes[recipe.output.type].label}</strong><small>${recipe.description}<br>${formatIngredients(recipe.ingredients)}</small></div><button ${available ? '' : 'disabled'}>Craft</button>`;
    row.querySelector('button').addEventListener('click', () => craftRecipe(recipe));
    recipeList.appendChild(row);
  }
}

function craftRecipe(recipe) {
  if (!canCraft(recipe)) {
    showToast('Not enough materials or output stack is full');
    return;
  }
  for (const [type, count] of Object.entries(recipe.ingredients)) inventory[type] -= count;
  inventory[recipe.output.type] += recipe.output.count;
  gameStats.crafted += 1;
  playerState.score += 15;
  buildHotbar();
  buildRecipes();
  updateWorldInfo();
  updateHealthUI();
  playTone(520, 0.05, 0.035, 'triangle');
  window.setTimeout(() => playTone(720, 0.08, 0.03, 'triangle'), 50);
  showToast(`Crafted ${recipe.output.count} ${blockTypes[recipe.output.type].label}`);
  checkChallenges();
}

function setOverlayVisible(element, visible) {
  element.classList.toggle('visible', visible);
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function openCrafting() {
  modalOpen = true;
  buildRecipes();
  setOverlayVisible(craftPanel, true);
  keys.clear();
  leftMouseDown = false;
  resetMining();
  if (controls.isLocked) controls.unlock();
}

function closeCrafting() {
  modalOpen = false;
  setOverlayVisible(craftPanel, false);
  if (!controls.isLocked && !touchActive && !isDead) {
    menu.classList.add('visible');
    hud.classList.add('hidden');
    hud.setAttribute('aria-hidden', 'true');
  }
}

function getSpawnPoint() {
  const y = findGroundBlockY(0, 0) + EYE_HEIGHT + 1.2;
  return new THREE.Vector3(0.5, y, 0.5);
}

function respawn() {
  camera.position.copy(getSpawnPoint());
  velocity.set(0, 0, 0);
  grounded = false;
  fallDistance = 0;
  playerState.health = MAX_HEALTH;
  playerState.stamina = MAX_STAMINA;
  isDead = false;
  setOverlayVisible(deathScreen, false);
  updateHealthUI();
}

function gameActive() {
  return !isDead && !modalOpen && (controls.isLocked || touchActive);
}

function playerCollidesAt(position) {
  const feetY = position.y - EYE_HEIGHT;
  const playerMinX = position.x - PLAYER_RADIUS;
  const playerMaxX = position.x + PLAYER_RADIUS;
  const playerMinY = feetY + 0.001;
  const playerMaxY = feetY + PLAYER_HEIGHT - 0.001;
  const playerMinZ = position.z - PLAYER_RADIUS;
  const playerMaxZ = position.z + PLAYER_RADIUS;
  const minX = Math.ceil(playerMinX - 0.5);
  const maxX = Math.floor(playerMaxX + 0.5);
  const minY = Math.ceil(playerMinY - 0.5);
  const maxY = Math.floor(playerMaxY + 0.5);
  const minZ = Math.ceil(playerMinZ - 0.5);
  const maxZ = Math.floor(playerMaxZ + 0.5);

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (!getBlock(x, y, z)) continue;
        const overlaps = playerMinX < x + 0.5 && playerMaxX > x - 0.5
          && playerMinY < y + 0.5 && playerMaxY > y - 0.5
          && playerMinZ < z + 0.5 && playerMaxZ > z - 0.5;
        if (overlaps) return true;
      }
    }
  }
  return false;
}

function moveAxis(axis, amount) {
  if (amount === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.05));
  const increment = amount / steps;
  for (let i = 0; i < steps; i += 1) {
    camera.position[axis] += increment;
    if (playerCollidesAt(camera.position)) {
      camera.position[axis] -= increment;
      velocity[axis] = 0;
      return true;
    }
  }
  return false;
}

function damagePlayer(amount, reason = 'damage') {
  if (isDead) return;
  combatTimer = 6;
  killStreak = 0;
  playerState.health = clamp(playerState.health - amount, 0, MAX_HEALTH);
  updateHealthUI();
  damageFlash.classList.add('active');
  window.setTimeout(() => damageFlash.classList.remove('active'), 110);
  playTone(92, 0.12, 0.055, 'sawtooth');
  if (playerState.health <= 0) {
    isDead = true;
    touchActive = false;
    if (controls.isLocked) controls.unlock();
    deathSummary.textContent = `Defeated by ${reason}. Score: ${Math.floor(playerState.score)} · Day ${dayCount}. Your world and inventory remain saved.`;
    setOverlayVisible(deathScreen, true);
    saveWorld(false);
  }
}

function resolveStuckPlayer() {
  if (!playerCollidesAt(camera.position)) return;
  const nudge = 0.06;
  const directions = [
    [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]
  ];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!playerCollidesAt(camera.position)) return;
    let escaped = false;
    for (const [dx, dy, dz] of directions) {
      const testPos = camera.position.clone();
      testPos.x += dx * nudge;
      testPos.y += dy * nudge;
      testPos.z += dz * nudge;
      if (!playerCollidesAt(testPos)) {
        camera.position.copy(testPos);
        escaped = true;
        break;
      }
    }
    if (!escaped) camera.position.y += nudge;
  }
}

function updatePlayer(delta) {
  if (!gameActive()) return;
  const joyVec = window.__mcJoystickVector || { x: 0, y: 0 };
  const forwardInput = clamp((keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + joyVec.y, -1, 1);
  const rightInput = clamp((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + joyVec.x, -1, 1);
  const direction = new THREE.Vector3();
  controls.getDirection(direction);
  direction.y = 0;
  if (direction.lengthSq() < 0.001) direction.set(0, 0, -1);
  direction.normalize();
  const right = direction.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const movement = direction.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput));
  if (movement.lengthSq() > 1) movement.normalize();

  const wantsSprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const sprinting = wantsSprint && movement.lengthSq() > 0 && playerState.stamina > 2;
  if (sprinting) playerState.stamina = Math.max(0, playerState.stamina - 26 * delta);
  else playerState.stamina = Math.min(MAX_STAMINA, playerState.stamina + 18 * delta);
  const feetY = camera.position.y - EYE_HEIGHT;
  const inWater = feetY < SEA_LEVEL + 0.55;
  const fullySubmerged = camera.position.y < SEA_LEVEL + 0.35;
  isUnderwater = fullySubmerged;
  if (inWater && !wasInWater) spawnSplash(camera.position.x, SEA_LEVEL + 0.5, camera.position.z, Math.max(0.4, Math.min(1.4, Math.abs(velocity.y) / 8)));
  if (inWater && movement.lengthSq() > 0.12 && Math.random() < delta * 5) spawnSplash(camera.position.x, SEA_LEVEL + 0.48, camera.position.z, 0.28);
  if (fullySubmerged && movement.lengthSq() > 0.2 && Math.random() < delta * 7) spawnBubble(camera.position.x, feetY + 0.4, camera.position.z, 0.75);
  wasInWater = inWater;
  let speedMul = 1, gravityMul = 1;
  if (fullySubmerged) { speedMul = 0.5; gravityMul = 0.25; velocity.y += 3.8 * delta; }
  else if (inWater) { speedMul = 0.6; gravityMul = 0.58; velocity.y += 1.4 * delta; }
  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * speedMul;
  velocity.x = movement.x * speed;
  velocity.z = movement.z * speed;
  velocity.y -= GRAVITY * gravityMul * delta;
  // Out-of-combat health regen
  combatTimer = Math.max(0, combatTimer - delta);
  if (combatTimer <= 0 && playerState.health < MAX_HEALTH && gameActive()) {
    playerState._regenAcc = (playerState._regenAcc || 0) + delta;
    if (playerState._regenAcc >= 4) {
      playerState._regenAcc = 0;
      playerState.health = Math.min(MAX_HEALTH, playerState.health + 1);
      updateHealthUI();
    }
  }

  moveAxis('x', velocity.x * delta);
  moveAxis('z', velocity.z * delta);
  const fallingBefore = velocity.y < 0;
  const verticalCollision = moveAxis('y', velocity.y * delta);
  if (fallingBefore && !verticalCollision) fallDistance += Math.abs(velocity.y * delta);
  if (verticalCollision && fallingBefore) {
    grounded = true;
    if (fallDistance > 4.5) damagePlayer(Math.min(6, Math.floor(fallDistance - 3.5)), 'a hard fall');
    fallDistance = 0;
  } else if (!verticalCollision) grounded = false;

  camera.position.x = clamp(camera.position.x, -WORLD_RADIUS + 0.4, WORLD_RADIUS - 0.4);
  camera.position.z = clamp(camera.position.z, -WORLD_RADIUS + 0.4, WORLD_RADIUS - 0.4);
  if (camera.position.y < -8) damagePlayer(MAX_HEALTH, 'falling out of the world');
  resolveStuckPlayer();
  updateStaminaUI();
}

function blockIntersectsPlayer(x, y, z) {
  const feetY = camera.position.y - EYE_HEIGHT;
  return camera.position.x - PLAYER_RADIUS < x + 0.5
    && camera.position.x + PLAYER_RADIUS > x - 0.5
    && feetY < y + 0.5
    && feetY + PLAYER_HEIGHT > y - 0.5
    && camera.position.z - PLAYER_RADIUS < z + 0.5
    && camera.position.z + PLAYER_RADIUS > z - 0.5;
}

function updateTarget() {
  if (!gameActive()) {
    outline.visible = false;
    currentTarget = null;
    currentMobTarget = null;
    interactionHint.textContent = '';
    return;
  }
  raycaster.far = MAX_REACH;
  raycaster.setFromCamera(centerScreen, camera);
  const intersections = raycaster.intersectObjects(chunkGroups, true);
  const hit = intersections[0];
  if (hit) {
    const mesh = hit.object;
    const position = mesh.userData.positions?.[hit.instanceId];
    if (position) {
      currentTarget = { ...position, point: hit.point.clone(), faceNormal: hit.face?.normal?.clone() };
      outline.position.set(position.x, position.y, position.z);
      outline.visible = true;
    }
  } else {
    currentTarget = null;
    outline.visible = false;
  }

  raycaster.far = getActiveWeapon().reach;
  const mobHits = raycaster.intersectObjects(mobHitMeshes, false);
  const nearestMobHit = mobHits[0];
  currentMobTarget = nearestMobHit && nearestMobHit.distance < (hit?.distance ?? Infinity) + 0.08
    ? nearestMobHit.object?.userData?.mob ?? null
    : null;
  crosshair.classList.toggle('combat', Boolean(currentMobTarget));
  if (currentMobTarget) interactionHint.textContent = `Click / F · Attack ${currentMobTarget.def ? currentMobTarget.def.label : 'mob'} with ${getActiveWeapon().label} (${currentMobTarget.hp} HP)`;
  else if (getSelectedDef()?.isConsumable) interactionHint.textContent = 'F · Eat apple (+2 health)';
  else if (getSelectedDef()?.isWeapon) interactionHint.textContent = `${getActiveWeapon().label} ready · click or F to attack`;
  else if (currentTarget) interactionHint.textContent = `${blockTypes[getBlock(currentTarget.x, currentTarget.y, currentTarget.z)]?.label ?? 'Block'} · Hold click to mine`;
  else interactionHint.textContent = '';
}

function placementNormal(target) {
  if (target.faceNormal) return target.faceNormal.clone().round();
  const relative = target.point.clone().sub(new THREE.Vector3(target.x, target.y, target.z));
  const ax = Math.abs(relative.x);
  const ay = Math.abs(relative.y);
  const az = Math.abs(relative.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(relative.x), 0, 0);
  if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(relative.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(relative.z));
}

function editBlock(x, y, z, type, { rebuild = true } = {}) {
  const key = keyOf(x, y, z);
  modifications[key] = type;
  setBlockRaw(x, y, z, type);
  if (rebuild) remeshAroundEdit(x, z);
  queueSave();
  updateWorldInfo();
}

function scheduleWorldMeshRebuild(delay = 0) {
  meshRebuildCountdown = meshRebuildCountdown === null ? delay : Math.max(meshRebuildCountdown, delay);
}

function animateHand(kind) {
  const className = kind === 'place' ? 'swing-place' : kind === 'hit' ? 'swing-hit' : 'swing-mine';
  playerHand.classList.remove('swing-mine', 'swing-place', 'swing-hit');
  void playerHand.offsetWidth;
  playerHand.classList.add(className);
}

function spawnParticles(x, y, z, type, options = {}) {
  const count = qualityHigh ? Math.ceil((options.count ?? 12) * 1.25) : Math.ceil((options.count ?? 12) * 0.35);
  for (let i = 0; i < count; i += 1) {
    const particleMaterial = new THREE.MeshBasicMaterial({ color: blockTypes[type]?.color ?? '#ffffff' });
    const mesh = new THREE.Mesh(particleGeometry, particleMaterial);
    mesh.position.set(x + (Math.random() - 0.5) * 0.72, y + (Math.random() - 0.5) * 0.72, z + (Math.random() - 0.5) * 0.72);
    scene.add(mesh);
    const outward = options.inward ? -0.75 : 1;
    particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2.8 * outward, (0.7 + Math.random() * 2.7) * (options.inward ? 0.45 : 1), (Math.random() - 0.5) * 2.8 * outward),
      life: (options.life ?? 0.5) + Math.random() * 0.22
    });
  }
}

function createBlockAnimation(x, y, z, type, kind) {
  const definition = blockTypes[type];
  if (!definition) return;
  const mesh = new THREE.Mesh(blockGeometry, definition.materials);
  mesh.position.set(x, y, z);
  mesh.castShadow = qualityHigh;
  scene.add(mesh);
  blockAnimations.push({ mesh, kind, elapsed: 0, duration: kind === 'place' ? 0.18 : 0.22, baseY: y, spin: (Math.random() - 0.5) * 1.2 });
}

function updateBlockAnimations(delta) {
  for (let i = blockAnimations.length - 1; i >= 0; i -= 1) {
    const animation = blockAnimations[i];
    animation.elapsed += delta;
    const t = Math.min(1, animation.elapsed / animation.duration);
    if (animation.kind === 'place') {
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = Math.max(0.08, eased + Math.sin(t * Math.PI) * 0.09);
      animation.mesh.scale.setScalar(scale);
      animation.mesh.rotation.y = (1 - t) * 0.22;
    } else {
      const scale = Math.max(0.05, 1 - t * t * t * 0.92);
      animation.mesh.scale.setScalar(scale);
      animation.mesh.rotation.x += delta * 4.5;
      animation.mesh.rotation.y += delta * (5.5 + animation.spin);
      animation.mesh.position.y = animation.baseY + Math.sin(t * Math.PI) * 0.16;
    }
    if (t >= 1) {
      scene.remove(animation.mesh);
      blockAnimations.splice(i, 1);
    }
  }
  if (meshRebuildCountdown !== null) {
    meshRebuildCountdown -= delta;
    if (meshRebuildCountdown <= 0) {
      meshRebuildCountdown = null;
      rebuildWorldMeshes();
    }
  }
}

function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= delta;
    particle.velocity.y -= 8 * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.rotation.x += delta * 5;
    particle.mesh.rotation.y += delta * 6;
    particle.mesh.scale.setScalar(Math.max(0.01, particle.life * 1.5));
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      particle.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
}

function resetMining() {
  miningTargetKey = null;
  miningProgress = 0;
  crackMesh.visible = false;
  crosshair.classList.remove('mining');
}

function collectMinedBlock(type) {
  if (type === 'crystal') {
    playerState.crystals += 1;
    gameStats.crystals += 1;
    playerState.score += 40;
    showToast('Crystal collected · +40 score');
    checkChallenges();
    return;
  }
  if (!hotbarTypes.includes(type)) return;
  if (inventory[type] >= MAX_STACK) {
    showToast(`${blockTypes[type].label} stack is full`);
    return;
  }
  inventory[type] += 1;
  buildHotbar();
  updateWorldInfo();
}

function completeBreak(x, y, z, type) {
  createBlockAnimation(x, y, z, type, 'break');
  spawnParticles(x, y, z, type, { count: type === 'crystal' ? 22 : 15, life: 0.48 });
  editBlock(x, y, z, null);
  collectMinedBlock(type);
  gameStats.mined += 1;
  playerState.score += type === 'crystal' ? 0 : 2;
  animateHand('mine');
  playTone(type === 'stone' || type === 'crystal' ? 118 : 142, 0.07, 0.045);
  miningCooldown = 0.12;
  checkChallenges();
}

function updateMining(delta) {
  miningCooldown = Math.max(0, miningCooldown - delta);
  handSwingCooldown = Math.max(0, handSwingCooldown - delta);
  if (gameActive() && leftMouseDown && currentMobTarget) {
    attackMob();
    resetMining();
    return;
  }
  if (!gameActive() || !leftMouseDown || !currentTarget || miningCooldown > 0) {
    if (!leftMouseDown || !currentTarget || !gameActive()) resetMining();
    return;
  }
  const { x, y, z } = currentTarget;
  const type = getBlock(x, y, z);
  if (!type) return resetMining();
  if (blockTypes[type]?.unbreakable) {
    if (miningTargetKey !== keyOf(x, y, z)) playTone(90, 0.07, 0.025);
    miningTargetKey = keyOf(x, y, z);
    crackMesh.visible = false;
    return;
  }
  const targetKey = keyOf(x, y, z);
  if (miningTargetKey !== targetKey) {
    miningTargetKey = targetKey;
    miningProgress = 0;
  }
  if (handSwingCooldown <= 0) {
    animateHand('mine');
    playTone(type === 'stone' || type === 'crystal' ? 105 : 122, 0.025, 0.018);
    handSwingCooldown = 0.24;
  }
  miningProgress += delta / (blockTypes[type].hardness ?? 0.55);
  const stage = Math.min(crackTextures.length - 1, Math.floor(miningProgress * crackTextures.length));
  crackMaterial.map = crackTextures[stage];
  crackMaterial.needsUpdate = true;
  crackMesh.position.set(x, y, z);
  crackMesh.visible = true;
  crosshair.classList.add('mining');
  if (miningProgress >= 1) {
    resetMining();
    completeBreak(x, y, z, type);
  }
}

function placeSelectedBlock() {
  if (!gameActive()) return;
  const type = hotbarTypes[selectedIndex];
  const def = blockTypes[type];
  if (def?.isConsumable) { tryConsumeApple(); return; }
  if (def?.isWeapon) { showToast(def.label + ' equipped · left-click or F to attack'); return; }
  if (!currentTarget) return;
  if ((inventory[type] ?? 0) <= 0) {
    showToast(`No ${blockTypes[type].label.toLowerCase()} blocks left`);
    playTone(88, 0.07, 0.025);
    return;
  }
  const normal = placementNormal(currentTarget);
  const x = currentTarget.x + normal.x;
  const y = currentTarget.y + normal.y;
  const z = currentTarget.z + normal.z;
  if (y < 1 || y > MAX_BUILD_HEIGHT || Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS || getBlock(x, y, z) || blockIntersectsPlayer(x, y, z)) {
    playTone(95, 0.045, 0.02);
    return;
  }
  inventory[type] -= 1;
  editBlock(x, y, z, type, { rebuild: false });
  createBlockAnimation(x, y, z, type, 'place');
  spawnParticles(x, y, z, type, { count: 7, life: 0.28, inward: true });
  remeshAroundEdit(x, z);
  gameStats.placed += 1;
  playerState.score += 1;
  buildHotbar();
  animateHand('place');
  playTone(215, 0.05, 0.04);
  checkChallenges();
}

function findGroundBlockY(x, z) {
  const bx = Math.round(x);
  const bz = Math.round(z);
  for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
    if (getBlock(bx, y, bz)) return y;
  }
  return 0;
}

const MC_MOB_TYPES = {
  slime:    { key: 'slime',    label: 'Slime',    baseHp: 3, hpPerTwoDays: 1, hpCap: 3, dmg: 1, speed: 1.4, aggro: 18, reach: 1.25, attackEvery: 1.15, nightOnly: false, flying: false, spawnWeight: 4 },
  zombie:   { key: 'zombie',   label: 'Zombie',   baseHp: 5, hpPerTwoDays: 1, hpCap: 3, dmg: 2, speed: 1.1, aggro: 20, reach: 1.35, attackEvery: 1.30, nightOnly: false, flying: false, spawnWeight: 3 },
  skeleton: { key: 'skeleton', label: 'Skeleton', baseHp: 4, hpPerTwoDays: 1, hpCap: 3, dmg: 2, speed: 1.2, aggro: 22, reach: 1.45, attackEvery: 1.45, nightOnly: false, flying: false, spawnWeight: 2 },
  phantom:  { key: 'phantom',  label: 'Phantom',  baseHp: 3, hpPerTwoDays: 1, hpCap: 2, dmg: 1, speed: 3.2, aggro: 26, reach: 1.70, attackEvery: 1.60, nightOnly: true,  flying: true,  spawnWeight: 2 }
};
const MC_MOB_LIST = [MC_MOB_TYPES.slime, MC_MOB_TYPES.zombie, MC_MOB_TYPES.skeleton, MC_MOB_TYPES.phantom];
const mcBoxGeoCache = new Map();
function mcBoxGeo(w, h, d) {
  const key = w + ',' + h + ',' + d;
  if (!mcBoxGeoCache.has(key)) mcBoxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return mcBoxGeoCache.get(key);
}
function mcLambert(color, opts) { return new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {})); }
const MC_MOB_MATS = {
  zombieSkin: mcLambert(0x3fae5a), zombieShirt: mcLambert(0x2a7d8c), zombiePants: mcLambert(0x3b3b6e),
  bone: mcLambert(0xd8d8cf), boneDark: mcLambert(0xbfbfb4),
  phantomWing: mcLambert(0x6b5f8a, { transparent: true, opacity: 0.92 }), phantomBody: mcLambert(0x8d84b8),
  eyeDark: new THREE.MeshBasicMaterial({ color: 0x101820 }),
  eyeGlow: new THREE.MeshBasicMaterial({ color: 0x0b0b12 })
};
// Every part registers in userData.hitMeshes so removal/combat stay generic.
function mcAddPart(group, geo, mat, x, y, z, hits) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = qualityHigh;
  group.add(mesh);
  hits.push(mesh);
  return mesh;
}
// Builds a blocky humanoid at foot origin; returns { body, hitMeshes, parts }.
function mcBuildHumanoid(group, skin, shirt, pants) {
  const hits = [];
  const legL = mcAddPart(group, mcBoxGeo(0.22, 0.75, 0.22), pants, -0.13, 0.375, 0, hits);
  const legR = mcAddPart(group, mcBoxGeo(0.22, 0.75, 0.22), pants, 0.13, 0.375, 0, hits);
  const body = mcAddPart(group, mcBoxGeo(0.5, 0.7, 0.28), shirt, 0, 1.1, 0, hits);
  const armL = mcAddPart(group, mcBoxGeo(0.16, 0.68, 0.16), skin, -0.33, 1.12, 0, hits);
  const armR = mcAddPart(group, mcBoxGeo(0.16, 0.68, 0.16), skin, 0.33, 1.12, 0, hits);
  const head = mcAddPart(group, mcBoxGeo(0.5, 0.5, 0.5), skin, 0, 1.7, 0, hits);
  const eyeL = mcAddPart(group, mcBoxGeo(0.09, 0.07, 0.03), MC_MOB_MATS.eyeDark, -0.12, 1.74, 0.26, hits);
  const eyeR = mcAddPart(group, mcBoxGeo(0.09, 0.07, 0.03), MC_MOB_MATS.eyeDark, 0.12, 1.74, 0.26, hits);
  eyeL.castShadow = eyeR.castShadow = false;
  return { body, hitMeshes: hits, parts: { legL, legR, armL, armR, head } };
}
// Blocky phantom: flat winged body, glowing eyes, origin at body centre.
function mcBuildPhantom(group) {
  const hits = [];
  const body = mcAddPart(group, mcBoxGeo(0.9, 0.3, 0.5), MC_MOB_MATS.phantomBody, 0, 0, 0, hits);
  const wingL = mcAddPart(group, mcBoxGeo(0.9, 0.06, 0.34), MC_MOB_MATS.phantomWing, -0.8, 0.08, 0, hits);
  const wingR = mcAddPart(group, mcBoxGeo(0.9, 0.06, 0.34), MC_MOB_MATS.phantomWing, 0.8, 0.08, 0, hits);
  const eyeL = mcAddPart(group, mcBoxGeo(0.1, 0.08, 0.03), MC_MOB_MATS.eyeGlow, -0.18, 0.06, 0.26, hits);
  const eyeR = mcAddPart(group, mcBoxGeo(0.1, 0.08, 0.03), MC_MOB_MATS.eyeGlow, 0.18, 0.06, 0.26, hits);
  eyeL.castShadow = eyeR.castShadow = false;
  wingL.castShadow = wingR.castShadow = false;
  return { body, hitMeshes: hits, parts: { wingL, wingR } };
}
function mcBuildMobMesh(typeKey, group) {
  if (typeKey === 'zombie') return mcBuildHumanoid(group, MC_MOB_MATS.zombieSkin, MC_MOB_MATS.zombieShirt, MC_MOB_MATS.zombiePants);
  if (typeKey === 'skeleton') return mcBuildHumanoid(group, MC_MOB_MATS.bone, MC_MOB_MATS.boneDark, MC_MOB_MATS.bone);
  if (typeKey === 'phantom') return mcBuildPhantom(group);
  return null; // slime keeps the core's own body+eyes construction
}

const slimeBodyGeometry = new THREE.BoxGeometry(0.9, 0.72, 0.9);
const slimeEyeGeometry = new THREE.BoxGeometry(0.13, 0.17, 0.08);
const slimeBodyMaterial = new THREE.MeshLambertMaterial({ color: 0x63df70, transparent: true, opacity: 0.9, emissive: 0x102b14, emissiveIntensity: 0.45 });
const slimeEyeMaterial = new THREE.MeshBasicMaterial({ color: 0x101820 });

function spawnSlime() {
  if (mobs.length >= (qualityHigh ? 8 : 3)) return;
  // Weighted type pick; phantoms only join the pool at night.
  const pool = [];
  for (const t of MC_MOB_LIST) {
    if (t.nightOnly && currentNightFactor < 0.45) continue;
    for (let w = 0; w < t.spawnWeight; w += 1) pool.push(t);
  }
  const type = pool[Math.floor(Math.random() * pool.length)];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 6;
    const x = clamp(camera.position.x + Math.cos(angle) * radius, -WORLD_RADIUS + 2, WORLD_RADIUS - 2);
    const z = clamp(camera.position.z + Math.sin(angle) * radius, -WORLD_RADIUS + 2, WORLD_RADIUS - 2);
    const groundY = findGroundBlockY(x, z);
    if (groundY <= SEA_LEVEL) continue;

    const group = new THREE.Group();
    let body;
    let hitMeshes;
    let parts = null;
    let spawnY;
    if (type.key === 'slime') {
      body = new THREE.Mesh(slimeBodyGeometry, slimeBodyMaterial.clone());
      body.castShadow = qualityHigh;
      group.add(body);
      const leftEye = new THREE.Mesh(slimeEyeGeometry, slimeEyeMaterial);
      const rightEye = new THREE.Mesh(slimeEyeGeometry, slimeEyeMaterial);
      leftEye.position.set(-0.2, 0.1, 0.46);
      rightEye.position.set(0.2, 0.1, 0.46);
      group.add(leftEye, rightEye);
      hitMeshes = [body, leftEye, rightEye];
      spawnY = groundY + 0.87;
    } else {
      const built = mcBuildMobMesh(type.key, group);
      body = built.body;
      hitMeshes = built.hitMeshes;
      parts = built.parts;
      body.material = body.material.clone(); // hit-flash must not tint siblings
      spawnY = type.flying ? groundY + 3.1 : groundY + 1.02;
    }
    group.position.set(x, spawnY, z);
    const hp = type.baseHp + Math.min(type.hpCap, Math.floor(dayCount / 2) * type.hpPerTwoDays);
    // baseEmissive: where the hit-flash reset returns to (slime's green
    // glow, plain black for the Lambert materials of the new types).
    const mob = { group, body, hp, attackTimer: 0, age: 0, phase: Math.random() * Math.PI * 2, knockback: new THREE.Vector3(), type: type.key, def: type, parts, hitMeshes, baseEmissive: type.key === 'slime' ? 0x102b14 : 0x000000 };
    for (const mesh of hitMeshes) { mesh.userData.mob = mob; mobHitMeshes.push(mesh); }
    mobs.push(mob);
    scene.add(group);
    return;
  }
}

function removeSlime(mob) {
  if (!mob || !mob.group) return; // defensive: callers pass valid mobs, but never crash the frame loop
  scene.remove(mob.group);
  const mobIndex = mobs.indexOf(mob);
  if (mobIndex >= 0) mobs.splice(mobIndex, 1);
  const meshes = mob.hitMeshes || [mob.body, ...mob.group.children.filter((child) => child !== mob.body)];
  for (const mesh of meshes) {
    const index = mobHitMeshes.indexOf(mesh);
    if (index >= 0) mobHitMeshes.splice(index, 1);
  }
}

function attackMob() {
  if (!gameActive() || attackCooldown > 0) return;
  // Eating apple when selected
  if (tryConsumeApple()) return;
  const weapon = getActiveWeapon();
  attackCooldown = weapon.cooldown;
  animateHand('hit');
  combatTimer = 6;
  if (!currentMobTarget) {
    playTone(140, 0.04, 0.018);
    return;
  }
  const mob = currentMobTarget;
  const crit = Math.random() < 0.12;
  const dmg = weapon.damage * (crit ? 2 : 1);
  mob.hp -= dmg;
  const direction = mob.group.position.clone().sub(camera.position).setY(0).normalize();
  mob.knockback.add(direction.multiplyScalar(weapon.knockback * (crit ? 1.25 : 1)));
  mob.body.material.emissive.setHex(crit ? 0xffcc33 : 0x7a1717);
  window.setTimeout(() => mob.body?.material?.emissive?.setHex(mob.baseEmissive ?? 0x102b14), crit ? 140 : 90);
  playTone(crit ? 260 : 175, 0.07, 0.045, 'sawtooth');
  spawnParticles(mob.group.position.x, mob.group.position.y, mob.group.position.z, 'leaves', { count: crit ? 16 : 9, life: 0.32 });
  showToast((crit ? 'Critical! ' : '') + weapon.label + ' hit · -' + dmg + ' HP');
  if (mob.hp <= 0) {
    removeSlime(mob);
    gameStats.kills += 1;
    killStreak += 1;
    const bonus = 50 + Math.min(40, killStreak * 5);
    playerState.score += bonus;
    if (Math.random() > 0.45 && inventory.stone < MAX_STACK) inventory.stone += 1;
    if (Math.random() > 0.7 && inventory.apple < MAX_STACK) inventory.apple = (inventory.apple ?? 0) + 1;
    buildHotbar();
    showToast((mob.def ? mob.def.label : 'Slime') + ' defeated · +' + bonus + ' score' + (killStreak > 1 ? ' · streak x' + killStreak : ''));
    checkChallenges();
  }
}

function updateMobs(delta) {
  attackCooldown = Math.max(0, attackCooldown - delta);
  mobSpawnTimer -= delta;
  if (currentNightFactor > 0.58 && mobSpawnTimer <= 0 && gameActive()) {
    spawnSlime();
    mobSpawnTimer = 5.5 + Math.random() * 4;
  }

  for (let i = mobs.length - 1; i >= 0; i -= 1) {
    const mob = mobs[i];
    mob.age += delta;
    mob.attackTimer = Math.max(0, mob.attackTimer - delta);
    const def = mob.def || MC_MOB_TYPES.slime;
    const toPlayer = camera.position.clone().sub(mob.group.position);
    const horizontalDistance = Math.hypot(toPlayer.x, toPlayer.z);
    const direction = toPlayer.setY(0).normalize();
    const activeSpeed = currentNightFactor > 0.45 ? def.speed : def.speed * 0.35;
    if (gameActive() && horizontalDistance < def.aggro && horizontalDistance > 0.01) {
      mob.group.position.addScaledVector(direction, activeSpeed * delta);
    }
    mob.group.position.addScaledVector(mob.knockback, delta);
    mob.knockback.multiplyScalar(Math.pow(0.05, delta));
    mob.group.position.x = clamp(mob.group.position.x, -WORLD_RADIUS + 1, WORLD_RADIUS - 1);
    mob.group.position.z = clamp(mob.group.position.z, -WORLD_RADIUS + 1, WORLD_RADIUS - 1);
    const groundY = findGroundBlockY(mob.group.position.x, mob.group.position.z);
    let targetY;
    if (def.flying) {
      // Phantom: circles at ~head height, gentle bob, dives only to strike.
      targetY = camera.position.y + 0.4 + Math.sin(mob.age * 1.7 + mob.phase) * 0.55;
      targetY = Math.max(targetY, groundY + 1.6); // never clip into terrain
    } else if (def.key === 'slime') {
      targetY = groundY + 0.87 + Math.abs(Math.sin(mob.age * 4 + mob.phase)) * 0.16;
    } else {
      // Humanoids: feet planted, tiny bob while walking.
      targetY = groundY + 1.02 + Math.abs(Math.sin(mob.age * 5 + mob.phase)) * 0.03;
    }
    mob.group.position.y += (targetY - mob.group.position.y) * Math.min(1, delta * (def.flying ? 4 : 9));
    mob.group.lookAt(camera.position.x, mob.group.position.y, camera.position.z);

    // --- Animation (limbs/wings/squash) ---
    if (mob.parts && mob.parts.legL) {
      const swing = Math.sin(mob.age * 6 + mob.phase) * (gameActive() && horizontalDistance < def.aggro ? 0.5 : 0.08);
      mob.parts.legL.rotation.x = swing;
      mob.parts.legR.rotation.x = -swing;
      mob.parts.armL.rotation.x = -swing * 0.8;
      mob.parts.armR.rotation.x = swing * 0.8;
    } else if (mob.parts && mob.parts.wingL) {
      const flap = Math.sin(mob.age * 9 + mob.phase) * 0.55;
      mob.parts.wingL.rotation.z = flap;
      mob.parts.wingR.rotation.z = -flap;
    } else if (def.key === 'slime') {
      const squash = 1 + Math.sin(mob.age * 7 + mob.phase) * 0.08;
      mob.body.scale.set(1 / squash, squash, 1 / squash);
    }

    if (gameActive() && horizontalDistance < def.reach && mob.attackTimer <= 0) {
      mob.attackTimer = def.attackEvery;
      damagePlayer(def.dmg, 'a hostile ' + def.label.toLowerCase());
      const push = camera.position.clone().sub(mob.group.position).setY(0).normalize();
      camera.position.addScaledVector(push, 0.42);
      if (mob.parts && mob.parts.armR) mob.parts.armR.rotation.x = -1.2; // melee swing
    }
    if (currentNightFactor < 0.22 && mob.age > 20 && horizontalDistance > 8) removeSlime(mob);
  }
}

function updateDayNight(delta) {
  if (gameActive()) worldTime += delta / DAY_DURATION_SECONDS;
  if (worldTime >= 1) {
    worldTime -= 1;
    dayCount += 1;
    showToast(`Day ${dayCount} begins`);
    queueSave();
  }
  const angle = worldTime * Math.PI * 2 - Math.PI / 2;
  const sunHeight = Math.sin(angle);
  const daylight = clamp((sunHeight + 0.16) / 0.58, 0, 1);
  currentNightFactor = 1 - daylight;
  sun.position.set(Math.cos(angle) * 38, sunHeight * 42, Math.sin(angle) * 28);
  moon.position.copy(sun.position).multiplyScalar(-1);
  sun.intensity = 0.12 + daylight * 2.25;
  moon.intensity = 0.08 + currentNightFactor * 0.48;
  hemiLight.intensity = 0.22 + daylight * 1.35;
  const nightColor = new THREE.Color(0x060e1a);
  const dayColor = new THREE.Color(0x7eb8e8);
  const duskColor = new THREE.Color(0xd4784a);
  const skyColor = nightColor.clone().lerp(dayColor, daylight);
  if (daylight > 0.08 && daylight < 0.48) skyColor.lerp(duskColor, 0.25 * (1 - Math.abs(daylight - 0.28) / 0.2));
  scene.background.copy(skyColor);
  scene.fog.color.copy(skyColor);
  stars.material.opacity = clamp(currentNightFactor * 1.25 - 0.2, 0, 0.95);
  clouds.children.forEach((cloud) => { cloud.visible = daylight > 0.08; });
  if (daylight > 0.35) waterMaterial.color.setHex(0x1a7ab8);
  else if (daylight > 0.12) waterMaterial.color.setHex(0x2a5f8a);
  else waterMaterial.color.setHex(0x0c2a48);
  updateUnderwaterFog(delta, daylight);
  const totalMinutes = Math.floor(worldTime * 24 * 60);
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  worldClock.textContent = `Day ${dayCount} · ${hours}:${minutes}`;
  timeIcon.textContent = daylight > 0.5 ? '☀' : currentNightFactor > 0.6 ? '☾' : '◐';
  if (Math.abs(worldTime - lastWorldTime) > 0.03) {
    lastWorldTime = worldTime;
    updateWorldInfo();
  }
}

function updateClouds(delta) {
  for (const cloud of clouds.children) {
    cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > 42) cloud.position.x = -42;
  }
  waterRippleTime += delta;
  if (waterBase && water?.geometry) {
    const pos = water.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const ix = i * 3;
      const x = waterBase[ix], y = waterBase[ix + 1];
      pos.array[ix + 2] = waterBase[ix + 2] + Math.sin(x * 0.55 + waterRippleTime * 1.6) * 0.04 + Math.cos(y * 0.48 + waterRippleTime * 1.15) * 0.028;
    }
    pos.needsUpdate = true;
    water.geometry.computeVertexNormals();
  }
  waterMaterial.opacity = isUnderwater ? 0.28 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);
  streamChunks(delta);
  chunkFrameCount += 1;
  if (chunkFrameCount % 6 === 0) refreshChunkVisibility();
}

function drawMinimap(delta) {
  minimapTimer -= delta;
  if (minimapTimer > 0) return;
  minimapTimer = 0.45;
  const context = minimapContext;
  const size = minimap.width;
  const cells = 25;
  const cell = size / cells;
  const centerX = Math.round(camera.position.x);
  const centerZ = Math.round(camera.position.z);
  context.clearRect(0, 0, size, size);
  for (let dx = -12; dx <= 12; dx += 1) {
    for (let dz = -12; dz <= 12; dz += 1) {
      const x = centerX + dx;
      const z = centerZ + dz;
      const screenX = (dx + 12) * cell;
      const screenY = (dz + 12) * cell;
      if (Math.abs(x) > WORLD_RADIUS || Math.abs(z) > WORLD_RADIUS) {
        context.fillStyle = '#07111d';
      } else {
        const y = findGroundBlockY(x, z);
        const type = getBlock(x, y, z);
        const colors = { grass: '#5f9f44', sand: '#cdb976', stone: '#777b82', dirt: '#80603e', wood: '#6f482a', leaves: '#377c38', planks: '#9f6c3e', brick: '#915048', torch: '#ffad35', crystal: '#64c8e8', bedrock: '#34363a' };
        context.fillStyle = y <= SEA_LEVEL ? '#317eb8' : (colors[type] ?? '#4f8650');
      }
      context.fillRect(screenX, screenY, Math.ceil(cell), Math.ceil(cell));
    }
  }
  context.save();
  context.translate(size / 2, size / 2);
  context.rotate(-camera.rotation.y);
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.moveTo(0, -7);
  context.lineTo(5, 6);
  context.lineTo(-5, 6);
  context.closePath();
  context.fill();
  context.restore();
  context.fillStyle = '#ff5f67';
  for (const mob of mobs) {
    const dx = mob.group.position.x - camera.position.x;
    const dz = mob.group.position.z - camera.position.z;
    if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
    context.beginPath();
    context.arc(size / 2 + dx * cell, size / 2 + dz * cell, 2.5, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = 'rgba(255,255,255,.65)';
  context.lineWidth = 2;
  context.strokeRect(1, 1, size - 2, size - 2);
}

let frameCounter = 0;
let fpsElapsed = 0;
let currentFps = 0;
function updateStats(delta) {
  frameCounter += 1;
  fpsElapsed += delta;
  if (fpsElapsed >= 0.5) {
    currentFps = Math.round(frameCounter / fpsElapsed);
    frameCounter = 0;
    fpsElapsed = 0;
  }
  saveIndicatorTimer = Math.max(0, saveIndicatorTimer - delta);
  const saveText = saveIndicatorTimer > 0 ? ' · SAVED' : '';
  statsElement.textContent = `FPS ${currentFps || '--'} · XYZ ${camera.position.x.toFixed(1)}, ${(camera.position.y - EYE_HEIGHT).toFixed(1)}, ${camera.position.z.toFixed(1)}${saveText}`;
}

function takeScreenshot() {
  renderer.render(scene, camera);
  try {
    const link = document.createElement('a');
    link.download = `microcraft-${worldSeed}-day-${dayCount}.png`;
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
    showToast('Screenshot saved');
  } catch (error) {
    console.error(error);
    showToast('Screenshot was blocked by the browser');
  }
}


async function shareGame() {
  const shareData = {
    title: 'MicroCraft Showcase',
    text: `Try my MicroCraft world. Seed: ${worldSeed}`,
    url: window.location.href
  };
  try {
    if (navigator.share && location.protocol.startsWith('http')) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    showToast('Game link copied');
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Use the browser address bar to copy this game link');
  }
}

async function copySeed() {
  try {
    await navigator.clipboard.writeText(String(worldSeed));
    showToast(`Seed ${worldSeed} copied`);
  } catch {
    showToast(`World seed: ${worldSeed}`, 2800);
  }
}

function startGame() {
  closeCrafting();
  setOverlayVisible(deathScreen, false);
  const touchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (touchDevice) {
    touchActive = true;
    menu.classList.remove('visible');
    hud.classList.remove('hidden');
    hud.setAttribute('aria-hidden', 'false');
    touchControls.setAttribute('aria-hidden', 'false');
  } else {
    controls.lock();
  }
}

function resetWorld() {
  const confirmed = window.confirm('Generate a new world? Your current world, score, and inventory will be replaced.');
  if (!confirmed) return;
  worldSeed = Math.floor(Math.random() * 1_000_000_000);
  worldTime = 0.32;
  dayCount = 1;
  modifications = {};
  inventory = { ...INITIAL_INVENTORY };
  playerState = { health: MAX_HEALTH, stamina: MAX_STAMINA, score: 0, crystals: 0 };
  gameStats = { mined: 0, placed: 0, crafted: 0, kills: 0, crystals: 0 };
  challengeIndex = 0;
  for (const mob of [...mobs]) removeSlime(mob);
  resetMining();
  generateBaseWorld();
  rebuildWorldMeshes();
  buildHotbar();
  updateChallengeUI();
  updateHealthUI();
  saveWorld(false);
  respawn();
  showToast('New world generated');
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updateDayNight(delta);
  updatePlayer(delta);
  updateTarget();
  updateMining(delta);
  updateMobs(delta);
  updateParticles(delta);
  updateSplashParticles(delta);
  updateBubbleParticles(delta);
  updateBlockAnimations(delta);
  updateClouds(delta);
  drawMinimap(delta);
  updateStats(delta);
  renderer.render(scene, camera);
}

controls.addEventListener('lock', () => {
  touchActive = false;
  menu.classList.remove('visible');
  hud.classList.remove('hidden');
  hud.setAttribute('aria-hidden', 'false');
});

controls.addEventListener('unlock', () => {
  if (!modalOpen && !isDead) menu.classList.add('visible');
  if (!modalOpen && !isDead) {
    hud.classList.add('hidden');
    hud.setAttribute('aria-hidden', 'true');
  }
  keys.clear();
  leftMouseDown = false;
  resetMining();
  saveWorld(false);
});

playButton.addEventListener('click', startGame);
saveButton.addEventListener('click', () => saveWorld(true));
resetButton.addEventListener('click', resetWorld);
craftButton.addEventListener('click', openCrafting);
craftClose.addEventListener('click', closeCrafting);
screenshotButton.addEventListener('click', takeScreenshot);
seedButton.addEventListener('click', copySeed);
qualityButton.addEventListener('click', () => {
  qualityHigh = !qualityHigh;
  applyQualitySettings();
  queueSave();
  showToast(qualityHigh ? 'High-quality rendering enabled' : 'Performance mode enabled');
});
soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  updateSoundButton();
  queueSave();
});
shareButton.addEventListener('click', shareGame);
respawnButton.addEventListener('click', () => {
  respawn();
  menu.classList.add('visible');
  hud.classList.add('hidden');
  hud.setAttribute('aria-hidden', 'true');
});
function openPauseMenu() {
  if (controls.isLocked) controls.unlock();
  touchActive = false;
  keys.clear();
  leftMouseDown = false;
  resetMining();
  menu.classList.add('visible');
  hud.classList.add('hidden');
  hud.setAttribute('aria-hidden', 'true');
  saveWorld(false);
}
pauseButton.addEventListener('click', openPauseMenu);
craftPanel.addEventListener('pointerdown', (event) => {
  if (event.target === craftPanel) closeCrafting();
});

window.addEventListener('keydown', (event) => {
  if (gameActive()) keys.add(event.code);
  const number = Number(event.key);
  if (number >= 1 && number <= hotbarTypes.length) selectSlot(number - 1);
  if (event.code === 'Space' && !event.repeat && gameActive() && (grounded || isUnderwater || (camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.55))) {
    velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED;
    if (!grounded) spawnSplash(camera.position.x, Math.min(camera.position.y, SEA_LEVEL + 0.5), camera.position.z, 0.45);
    grounded = false;
    playTone(180, 0.035, 0.025);
  }
  if (event.code === 'KeyR' && gameActive()) respawn();
  if (event.code === 'KeyF' && !event.repeat) attackMob();
  if (event.code === 'KeyC' && !event.repeat) openCrafting();
  if (event.code === 'KeyP' && !event.repeat) takeScreenshot();
  if (event.code === 'KeyG' && !event.repeat && gameActive()) openPauseMenu();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('mousedown', (event) => {
  if (!gameActive()) return;
  if (event.button === 0) {
    leftMouseDown = true;
    animateHand('mine');
  }
  if (event.button === 2) placeSelectedBlock();
});
window.addEventListener('mouseup', (event) => {
  if (event.button !== 0) return;
  leftMouseDown = false;
  resetMining();
});
window.addEventListener('blur', () => {
  leftMouseDown = false;
  keys.clear();
  resetMining();
});
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('wheel', (event) => {
  if (!gameActive()) return;
  const direction = Math.sign(event.deltaY);
  selectSlot((selectedIndex + direction + hotbarTypes.length) % hotbarTypes.length);
}, { passive: true });

for (const button of document.querySelectorAll('.touch-move button')) {
  const key = button.dataset.key;
  const press = (event) => { event.preventDefault(); keys.add(key); };
  const release = (event) => { event.preventDefault(); keys.delete(key); };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

let lookPointerId = null;
let lastLookX = 0;
let lastLookY = 0;
touchLook.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  lookPointerId = event.pointerId;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  touchLook.setPointerCapture(event.pointerId);
});
touchLook.addEventListener('pointermove', (event) => {
  if (event.pointerId !== lookPointerId || !touchActive) return;
  const dx = event.clientX - lastLookX;
  const dy = event.clientY - lastLookY;
  lastLookX = event.clientX;
  lastLookY = event.clientY;
  const lookScale = (window.__mcLookSensitivity || 5) / 5;
  camera.rotation.y -= dx * 0.0045 * lookScale;
  camera.rotation.x = clamp(camera.rotation.x - dy * 0.0045 * lookScale, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
});
touchLook.addEventListener('pointerup', () => { lookPointerId = null; });
touchLook.addEventListener('pointercancel', () => { lookPointerId = null; });

touchJump.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (gameActive() && grounded) {
    velocity.y = JUMP_SPEED;
    grounded = false;
  }
});
touchMine.addEventListener('pointerdown', (event) => { event.preventDefault(); leftMouseDown = true; animateHand('mine'); });
touchMine.addEventListener('pointerup', (event) => { event.preventDefault(); leftMouseDown = false; resetMining(); });
touchMine.addEventListener('pointercancel', () => { leftMouseDown = false; resetMining(); });
touchPlace.addEventListener('pointerdown', (event) => { event.preventDefault(); placeSelectedBlock(); });
touchAttack.addEventListener('pointerdown', (event) => { event.preventDefault(); attackMob(); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityHigh ? 1.75 : 1));
});
window.addEventListener('beforeunload', () => saveWorld(false));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveWorld(false);
});

loadWorldState();
generateBaseWorld();
applyQualitySettings();
buildHotbar();
buildRecipes();
updateWorldInfo();
updateHealthUI();
updateChallengeUI();
updateSoundButton();
respawn();
loading.classList.remove('visible');
animate();
