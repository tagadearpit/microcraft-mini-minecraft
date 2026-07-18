import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const STORAGE_KEY = 'microcraft-showcase-v3';
const LEGACY_STORAGE_KEY = 'microcraft-world-v1';
const WORLD_RADIUS = 18;
const MAX_BUILD_HEIGHT = 26;
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
  torch: 0
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
scene.background = new THREE.Color(0x82c7f2);
scene.fog = new THREE.Fog(0x82c7f2, 28, 68);

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
  bedrock: { label: 'Bedrock', color: '#34363a', hardness: Infinity, materials: simpleMaterials.bedrock, unbreakable: true }
};

const hotbarTypes = ['grass', 'dirt', 'stone', 'sand', 'wood', 'planks', 'brick', 'torch'];
const recipes = [
  { id: 'planks', output: { type: 'planks', count: 4 }, ingredients: { wood: 1 }, description: 'Turn one log into four building planks.' },
  { id: 'brick', output: { type: 'brick', count: 4 }, ingredients: { stone: 2, dirt: 1 }, description: 'Combine stone and clay-rich dirt into bricks.' },
  { id: 'torch', output: { type: 'torch', count: 4 }, ingredients: { wood: 1, stone: 1 }, description: 'Create glowing blocks for night builds.' }
];
const challenges = [
  { stat: 'mined', target: 10, title: 'Resource Collector', label: 'Mine blocks' },
  { stat: 'placed', target: 10, title: 'First Shelter', label: 'Place blocks' },
  { stat: 'crafted', target: 3, title: 'Workbench Apprentice', label: 'Craft recipes' },
  { stat: 'kills', target: 3, title: 'Night Defender', label: 'Defeat slimes' },
  { stat: 'crystals', target: 3, title: 'Crystal Hunter', label: 'Mine crystals' }
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
  return blocks.get(keyOf(x, y, z));
}

function terrainHeight(x, z) {
  const broad = Math.sin((x + worldSeed * 0.001) * 0.18) * 1.45 + Math.cos((z - worldSeed * 0.001) * 0.16) * 1.3;
  const detail = (seededRandom2D(x, z, worldSeed) - 0.5) * 2.2;
  const ridge = Math.sin((x + z) * 0.08) * 0.85;
  return clamp(Math.floor(5.5 + broad + detail + ridge), 3, 10);
}

function generateBaseWorld() {
  blocks.clear();
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
  for (const mesh of blockMeshes) scene.remove(mesh);
  blockMeshes.length = 0;
  const grouped = new Map();
  for (const [key, type] of blocks) {
    const [x, y, z] = parseKey(key);
    if (!isExposed(x, y, z)) continue;
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push({ x, y, z });
  }

  const matrix = new THREE.Matrix4();
  for (const [type, positions] of grouped) {
    const definition = blockTypes[type];
    if (!definition || positions.length === 0) continue;
    const mesh = new THREE.InstancedMesh(blockGeometry, definition.materials, positions.length);
    mesh.castShadow = qualityHigh && type !== 'leaves' && type !== 'torch';
    mesh.receiveShadow = qualityHigh;
    mesh.userData.type = type;
    mesh.userData.positions = positions;
    positions.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    blockMeshes.push(mesh);
    scene.add(mesh);
  }
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
const waterMaterial = new THREE.MeshPhongMaterial({ color: 0x3b9ee8, transparent: true, opacity: 0.46, shininess: 90, depthWrite: false });
const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 1.5, WORLD_RADIUS * 2 + 1.5), waterMaterial);
water.rotation.x = -Math.PI / 2;
water.position.y = SEA_LEVEL + 0.46;
water.renderOrder = 2;
scene.add(water);

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
    slot.innerHTML = `<span class="slot-number">${index + 1}</span><span class="block-swatch" style="background:${definition.color}"></span><span class="slot-count">${count}</span>`;
    slot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      selectSlot(index);
    });
    hotbar.appendChild(slot);
  });
  const selectedType = hotbarTypes[selectedIndex];
  selectedLabel.textContent = `${blockTypes[selectedType].label} · ${inventory[selectedType]}/${MAX_STACK}`;
  heldBlock.style.background = blockTypes[selectedType].color;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityHigh ? 1.75 : 1));
  renderer.shadowMap.enabled = qualityHigh;
  sun.castShadow = qualityHigh;
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

function updatePlayer(delta) {
  if (!gameActive()) return;
  const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const rightInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
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
  const inWater = camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.65;
  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (inWater ? 0.62 : 1);
  velocity.x = movement.x * speed;
  velocity.z = movement.z * speed;
  velocity.y -= GRAVITY * delta;

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
  const intersections = raycaster.intersectObjects(blockMeshes, false);
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

  raycaster.far = 4.6;
  const mobHits = raycaster.intersectObjects(mobHitMeshes, false);
  const nearestMobHit = mobHits[0];
  currentMobTarget = nearestMobHit && nearestMobHit.distance < (hit?.distance ?? Infinity) + 0.08
    ? nearestMobHit.object?.userData?.mob ?? null
    : null;
  crosshair.classList.toggle('combat', Boolean(currentMobTarget));
  if (currentMobTarget) interactionHint.textContent = `F · Attack slime (${currentMobTarget.hp} HP)`;
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
  if (rebuild) rebuildWorldMeshes();
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
  const count = qualityHigh ? (options.count ?? 12) : Math.ceil((options.count ?? 12) * 0.55);
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
  if (!gameActive() || !currentTarget) return;
  const type = hotbarTypes[selectedIndex];
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
  scheduleWorldMeshRebuild(0.18);
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

const slimeBodyGeometry = new THREE.BoxGeometry(0.9, 0.72, 0.9);
const slimeEyeGeometry = new THREE.BoxGeometry(0.13, 0.17, 0.08);
const slimeBodyMaterial = new THREE.MeshLambertMaterial({ color: 0x63df70, transparent: true, opacity: 0.9, emissive: 0x102b14, emissiveIntensity: 0.45 });
const slimeEyeMaterial = new THREE.MeshBasicMaterial({ color: 0x101820 });

function spawnSlime() {
  if (mobs.length >= (qualityHigh ? 6 : 4)) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 6;
    const x = clamp(camera.position.x + Math.cos(angle) * radius, -WORLD_RADIUS + 2, WORLD_RADIUS - 2);
    const z = clamp(camera.position.z + Math.sin(angle) * radius, -WORLD_RADIUS + 2, WORLD_RADIUS - 2);
    const groundY = findGroundBlockY(x, z);
    if (groundY <= SEA_LEVEL) continue;

    const group = new THREE.Group();
    const body = new THREE.Mesh(slimeBodyGeometry, slimeBodyMaterial.clone());
    body.castShadow = qualityHigh;
    group.add(body);
    const leftEye = new THREE.Mesh(slimeEyeGeometry, slimeEyeMaterial);
    const rightEye = new THREE.Mesh(slimeEyeGeometry, slimeEyeMaterial);
    leftEye.position.set(-0.2, 0.1, 0.46);
    rightEye.position.set(0.2, 0.1, 0.46);
    group.add(leftEye, rightEye);
    group.position.set(x, groundY + 0.87, z);
    const mob = { group, body, hp: 3, attackTimer: 0, age: 0, phase: Math.random() * Math.PI * 2, knockback: new THREE.Vector3() };
    body.userData.mob = mob;
    leftEye.userData.mob = mob;
    rightEye.userData.mob = mob;
    mobHitMeshes.push(body, leftEye, rightEye);
    mobs.push(mob);
    scene.add(group);
    return;
  }
}

function removeSlime(mob) {
  scene.remove(mob.group);
  const mobIndex = mobs.indexOf(mob);
  if (mobIndex >= 0) mobs.splice(mobIndex, 1);
  for (const mesh of [mob.body, ...mob.group.children.filter((child) => child !== mob.body)]) {
    const index = mobHitMeshes.indexOf(mesh);
    if (index >= 0) mobHitMeshes.splice(index, 1);
  }
}

function attackMob() {
  if (!gameActive() || attackCooldown > 0) return;
  attackCooldown = 0.32;
  animateHand('hit');
  if (!currentMobTarget) {
    playTone(140, 0.04, 0.018);
    return;
  }
  const mob = currentMobTarget;
  mob.hp -= 1;
  const direction = mob.group.position.clone().sub(camera.position).setY(0).normalize();
  mob.knockback.add(direction.multiplyScalar(3.2));
  mob.body.material.emissive.setHex(0x7a1717);
  window.setTimeout(() => mob.body?.material?.emissive?.setHex(0x102b14), 90);
  playTone(175, 0.06, 0.04, 'sawtooth');
  spawnParticles(mob.group.position.x, mob.group.position.y, mob.group.position.z, 'leaves', { count: 9, life: 0.3 });
  if (mob.hp <= 0) {
    removeSlime(mob);
    gameStats.kills += 1;
    playerState.score += 50;
    if (Math.random() > 0.5 && inventory.stone < MAX_STACK) inventory.stone += 1;
    buildHotbar();
    showToast('Slime defeated · +50 score');
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
    const toPlayer = camera.position.clone().sub(mob.group.position);
    const horizontalDistance = Math.hypot(toPlayer.x, toPlayer.z);
    const direction = toPlayer.setY(0).normalize();
    const activeSpeed = currentNightFactor > 0.45 ? 1.4 : 0.45;
    if (gameActive() && horizontalDistance < 18) mob.group.position.addScaledVector(direction, activeSpeed * delta);
    mob.group.position.addScaledVector(mob.knockback, delta);
    mob.knockback.multiplyScalar(Math.pow(0.05, delta));
    mob.group.position.x = clamp(mob.group.position.x, -WORLD_RADIUS + 1, WORLD_RADIUS - 1);
    mob.group.position.z = clamp(mob.group.position.z, -WORLD_RADIUS + 1, WORLD_RADIUS - 1);
    const groundY = findGroundBlockY(mob.group.position.x, mob.group.position.z);
    const targetY = groundY + 0.87 + Math.abs(Math.sin(mob.age * 4 + mob.phase)) * 0.16;
    mob.group.position.y += (targetY - mob.group.position.y) * Math.min(1, delta * 9);
    mob.group.lookAt(camera.position.x, mob.group.position.y, camera.position.z);
    const squash = 1 + Math.sin(mob.age * 7 + mob.phase) * 0.08;
    mob.body.scale.set(1 / squash, squash, 1 / squash);

    if (gameActive() && horizontalDistance < 1.25 && mob.attackTimer <= 0) {
      mob.attackTimer = 1.15;
      damagePlayer(1, 'a hostile slime');
      const push = camera.position.clone().sub(mob.group.position).setY(0).normalize();
      camera.position.addScaledVector(push, 0.42);
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
  const nightColor = new THREE.Color(0x071321);
  const dayColor = new THREE.Color(0x82c7f2);
  const duskColor = new THREE.Color(0xe58b68);
  const skyColor = nightColor.clone().lerp(dayColor, daylight);
  if (daylight > 0.08 && daylight < 0.48) skyColor.lerp(duskColor, 0.25 * (1 - Math.abs(daylight - 0.28) / 0.2));
  scene.background.copy(skyColor);
  scene.fog.color.copy(skyColor);
  stars.material.opacity = clamp(currentNightFactor * 1.25 - 0.2, 0, 0.95);
  clouds.children.forEach((cloud) => { cloud.visible = daylight > 0.08; });
  waterMaterial.color.setHex(daylight > 0.25 ? 0x3b9ee8 : 0x183f72);

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
  waterMaterial.opacity = 0.43 + Math.sin(performance.now() * 0.0018) * 0.035;
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
pauseButton.addEventListener('click', () => {
  touchActive = false;
  keys.clear();
  leftMouseDown = false;
  resetMining();
  menu.classList.add('visible');
  hud.classList.add('hidden');
  hud.setAttribute('aria-hidden', 'true');
  saveWorld(false);
});
craftPanel.addEventListener('pointerdown', (event) => {
  if (event.target === craftPanel) closeCrafting();
});

window.addEventListener('keydown', (event) => {
  if (gameActive()) keys.add(event.code);
  const number = Number(event.key);
  if (number >= 1 && number <= hotbarTypes.length) selectSlot(number - 1);
  if (event.code === 'Space' && !event.repeat && gameActive() && grounded) {
    velocity.y = JUMP_SPEED;
    grounded = false;
    playTone(180, 0.035, 0.025);
  }
  if (event.code === 'KeyR' && gameActive()) respawn();
  if (event.code === 'KeyF' && !event.repeat) attackMob();
  if (event.code === 'KeyC' && !event.repeat) openCrafting();
  if (event.code === 'KeyP' && !event.repeat) takeScreenshot();
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
  camera.rotation.y -= dx * 0.0045;
  camera.rotation.x = clamp(camera.rotation.x - dy * 0.0045, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
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
