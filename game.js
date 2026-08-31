/**
 * MicroCraft — GitHub Pages loader
 * ---------------------------------
 * 1) Loads the stable core engine from CDN
 * 2) Injects Three.js from the page import map
 * 3) Applies feature patches (water, weapons, combat, QoL)
 * 4) Applies performance patches (chunked world streaming, face culling,
 *    frustum culling, Web Worker terrain generation, bigger world)
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------------------------------------------------------------------------
const CORE_URL =
  'https://cdn.jsdelivr.net/gh/tagadearpit/microcraft-mini-minecraft@e8f770a4cd2a1cb806dcd131c5853f387f775877/game.js';

globalThis.__MICROCRAFT_THREE__ = THREE;
globalThis.__MICROCRAFT_PLC__ = PointerLockControls;

// ---------------------------------------------------------------------------
// Mobile-only enhancements
// ---------------------------------------------------------------------------
// Everything in this block is gated behind `pointer: coarse` (touch devices)
// and, for the orientation lock / rotate prompt, behind "installed app"
// detection. None of it runs, renders, or attaches listeners on desktop —
// laptop/mouse users get the exact same experience as before.
// It talks to the patched engine (below) only through two tiny bridge
// globals (window.__mcJoystickVector / window.__mcLookSensitivity) so it
// never has to touch the remote engine source directly.
(function mobileEnhancements() {
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

  function isInstalledApp() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || window.navigator.standalone === true;
  }

  if (isTouchDevice) document.documentElement.classList.add('mc-touch');

  // --- Auto landscape ("tilt") for the installed app only -----------------
  async function lockLandscape() {
    if (!isTouchDevice || !isInstalledApp()) return;
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock('landscape');
      }
    } catch (err) {
      // Not supported (e.g. iOS) or not allowed yet — the CSS rotate
      // prompt below covers this case, so we just move on quietly.
    }
  }

  function refreshInstalledAppState() {
    if (isTouchDevice && isInstalledApp()) {
      document.documentElement.classList.add('mc-installed-app');
      lockLandscape();
    }
  }

  refreshInstalledAppState();
  window.addEventListener('load', refreshInstalledAppState);
  document.addEventListener('fullscreenchange', lockLandscape);
  document.addEventListener('DOMContentLoaded', () => {
    const playBtn = document.querySelector('#play-button');
    if (playBtn) playBtn.addEventListener('click', lockLandscape);
  });

  if (!isTouchDevice) return; // Nothing below this line ever runs on desktop.

  // --- Look sensitivity (persisted) ---------------------------------------
  const SENSITIVITY_KEY = 'microcraft-touch-sensitivity';
  let storedSensitivity = Number(localStorage.getItem(SENSITIVITY_KEY));
  if (!Number.isFinite(storedSensitivity) || storedSensitivity < 1 || storedSensitivity > 10) {
    storedSensitivity = 5;
  }
  window.__mcLookSensitivity = storedSensitivity;

  function wireSensitivitySlider() {
    const slider = document.querySelector('#sensitivity-slider');
    const label = document.querySelector('#sensitivity-value');
    if (!slider) return;
    slider.value = String(storedSensitivity);
    if (label) label.textContent = String(storedSensitivity);
    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      window.__mcLookSensitivity = value;
      if (label) label.textContent = String(value);
      try { localStorage.setItem(SENSITIVITY_KEY, String(value)); } catch (err) {}
    });
  }

  // --- Virtual movement joystick ------------------------------------------
  window.__mcJoystickVector = { x: 0, y: 0 };

  function wireJoystick() {
    const zone = document.querySelector('#touch-joystick');
    const knob = document.querySelector('#joystick-knob');
    if (!zone || !knob) return;
    const maxRadius = 42;
    let activePointerId = null;
    let originX = 0;
    let originY = 0;

    function setKnob(dx, dy) {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    function reset() {
      activePointerId = null;
      window.__mcJoystickVector.x = 0;
      window.__mcJoystickVector.y = 0;
      setKnob(0, 0);
      zone.classList.remove('active');
    }
    zone.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      activePointerId = event.pointerId;
      const rect = zone.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      zone.classList.add('active');
      zone.setPointerCapture(event.pointerId);
    });
    zone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      let dx = event.clientX - originX;
      let dy = event.clientY - originY;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      setKnob(dx, dy);
      window.__mcJoystickVector.x = dx / maxRadius;
      window.__mcJoystickVector.y = -dy / maxRadius; // up = forward
    });
    const end = (event) => {
      if (event.pointerId !== activePointerId) return;
      reset();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('pointerleave', end);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      wireSensitivitySlider();
      wireJoystick();
    });
  } else {
    wireSensitivitySlider();
    wireJoystick();
  }
})();

// ---------------------------------------------------------------------------
// Feature patches
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Pixel-art sword icon (inline SVG, 16x16 grid matching the classic
// Minecraft iron-sword pattern: diagonal silver blade with a dark 1px
// outline, brass guard, brown grip, dark pommel). Blade pixels use
// fill="currentColor" so the existing --blade-color variable still tints
// wood_sword vs stone_sword differently. Injected as innerHTML wherever
// .sword-icon is used; CSS sets shape-rendering: crispEdges so it stays
// blocky at both the 22px hotbar swatch and the 64px held item.
// ---------------------------------------------------------------------------
const MC_SWORD_PIXEL_ART = (() => {
  // 16x16 pixel grid extracted cell-by-cell from the reference image
  // (classic Minecraft iron sword: tip top-right, pommel bottom-left).
  // Legend: X = dark outline, W = blade highlight, w = blade shadow,
  // B = brown grip. Blade pixels use currentColor (driven by the element's
  // `color`, kept in sync with --blade-color) so wood/stone swords tint
  // differently; 'w' pixels add a black 22% overlay rect to darken the
  // tint instead of using a hard-coded gray.
  const ROWS = [
    '.............XXX',
    '............X..X',
    '...........X.w.X',
    '..........X.wWX.',
    '.........X.wWX..',
    '........X.wWX...',
    '..XX...X.wWX....',
    '..XXX.X.wWX.....',
    '...XwX.BWX......',
    '...XwwXWX.......',
    '....XXXX........',
    '...XXXXXX.......',
    '..XBX.XXXX......',
    'XXXX....XX......',
    'XXX.............',
    'XXX.............'
  ];
  const OUTLINE = '#383632';
  const GRIP = '#907b4e';
  let rects = '';
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const c = ROWS[y][x];
      if (c === '.') continue;
      if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${OUTLINE}"/>`;
      else if (c === 'B') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${GRIP}"/>`;
      else if (c === 'W') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>`;
      else rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/><rect x="${x}" y="${y}" width="1" height="1" fill="#000" opacity="0.22"/>`;
    }
  }
  return `<svg viewBox="0 0 16 16" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rects}</svg>`;
})();
// The patched engine runs in a blob without module scope — expose as a global.
globalThis.__mcSwordSVG = MC_SWORD_PIXEL_ART;

function applyPatches(source) {
  let code = source;

  // --- Strip original imports (Three comes from this module) ---
  code = code.replace(/import\s+\*\s+as\s+THREE\s+from\s+['\"]three['\"];\s*/m, '');
  code = code.replace(
    /import\s+\{\s*PointerLockControls\s*\}\s+from\s+['\"]three\/addons\/controls\/PointerLockControls\.js['\"];\s*/m,
    ''
  );

  // --- Expand inventory: swords + food ---
  code = code.replace(
    `const INITIAL_INVENTORY = Object.freeze({
  grass: 12,
  dirt: 18,
  stone: 12,
  sand: 10,
  wood: 8,
  planks: 0,
  brick: 0,
  torch: 0
});`,
    `const INITIAL_INVENTORY = Object.freeze({
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
});`
  );

  code = code.replace(
    "const hotbarTypes = ['grass', 'dirt', 'stone', 'sand', 'wood', 'planks', 'brick', 'torch'];",
    "const hotbarTypes = ['grass', 'dirt', 'stone', 'sand', 'wood', 'planks', 'brick', 'torch', 'wood_sword', 'stone_sword', 'apple'];"
  );

  // Block definitions for new items (used for colors / labels)
  code = code.replace(
    `bedrock: { label: 'Bedrock', color: '#34363a', hardness: Infinity, materials: simpleMaterials.bedrock, unbreakable: true }
};`,
    `bedrock: { label: 'Bedrock', color: '#34363a', hardness: Infinity, materials: simpleMaterials.bedrock, unbreakable: true },
  wood_sword: { label: 'Wood Sword', color: '#c4a574', hardness: 0.01, materials: simpleMaterials.planks, isWeapon: true, damage: 2, cooldown: 0.28, knockback: 4.2, reach: 5.1 },
  stone_sword: { label: 'Stone Sword', color: '#9aa3ad', hardness: 0.01, materials: simpleMaterials.stone, isWeapon: true, damage: 3, cooldown: 0.22, knockback: 5.2, reach: 5.3 },
  apple: { label: 'Apple', color: '#e85d4c', hardness: 0.01, materials: simpleMaterials.dirt, isConsumable: true, heal: 2 }
};`
  );

  // Crafting recipes for weapons + food
  code = code.replace(
    `const recipes = [
  { id: 'planks', output: { type: 'planks', count: 4 }, ingredients: { wood: 1 }, description: 'Turn one log into four building planks.' },
  { id: 'brick', output: { type: 'brick', count: 4 }, ingredients: { stone: 2, dirt: 1 }, description: 'Combine stone and clay-rich dirt into bricks.' },
  { id: 'torch', output: { type: 'torch', count: 4 }, ingredients: { wood: 1, stone: 1 }, description: 'Create glowing blocks for night builds.' }
];`,
    `const recipes = [
  { id: 'planks', output: { type: 'planks', count: 4 }, ingredients: { wood: 1 }, description: 'Turn one log into four building planks.' },
  { id: 'brick', output: { type: 'brick', count: 4 }, ingredients: { stone: 2, dirt: 1 }, description: 'Combine stone and clay-rich dirt into bricks.' },
  { id: 'torch', output: { type: 'torch', count: 4 }, ingredients: { wood: 1, stone: 1 }, description: 'Create glowing blocks for night builds.' },
  { id: 'wood_sword', output: { type: 'wood_sword', count: 1 }, ingredients: { wood: 2, planks: 1 }, description: 'A basic wooden blade. Deals 2 damage to slimes.' },
  { id: 'stone_sword', output: { type: 'stone_sword', count: 1 }, ingredients: { stone: 2, wood: 1 }, description: 'A sturdy stone blade. Deals 3 damage to slimes.' },
  { id: 'apple', output: { type: 'apple', count: 2 }, ingredients: { leaves: 2, wood: 1 }, description: 'Snack that restores 2 hearts. Right-click or press F while selected.' }
];`
  );

  // Extra challenge for weapon kills
  code = code.replace(
    `  { stat: 'crystals', target: 3, title: 'Crystal Hunter', label: 'Mine crystals' }
];`,
    `  { stat: 'crystals', target: 3, title: 'Crystal Hunter', label: 'Mine crystals' },
  { stat: 'kills', target: 8, title: 'Slime Slayer', label: 'Defeat more slimes' }
];`
  );

  // --- Water / combat / QoL runtime state ---
  code = code.replace(
    'let lastWorldTime = worldTime;',
    `let lastWorldTime = worldTime;
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
const surfaceFogNear = 22;
const surfaceFogFar = 62;
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
}`
  );

  // Water movement + splash + bubbles
  code = code.replace(
    '  const inWater = camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.65;\n  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (inWater ? 0.62 : 1);\n  velocity.x = movement.x * speed;\n  velocity.z = movement.z * speed;\n  velocity.y -= GRAVITY * delta;',
    `  const feetY = camera.position.y - EYE_HEIGHT;
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
  }`
  );

  // Water surface mesh
  code = code.replace(
    'const waterMaterial = new THREE.MeshPhongMaterial({ color: 0x3b9ee8, transparent: true, opacity: 0.46, shininess: 90, depthWrite: false });\nconst water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 1.5, WORLD_RADIUS * 2 + 1.5), waterMaterial);\nwater.rotation.x = -Math.PI / 2;\nwater.position.y = SEA_LEVEL + 0.46;\nwater.renderOrder = 2;\nscene.add(water);',
    `const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 40, 40);
const waterMaterial = new THREE.MeshPhongMaterial({ color: 0x1a7ab8, transparent: true, opacity: 0.62, shininess: 140, specular: 0xa8d8ff, depthWrite: false, side: THREE.DoubleSide });
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI / 2;
water.position.y = SEA_LEVEL + 0.42;
water.renderOrder = 2;
water.receiveShadow = true;
scene.add(water);
waterBase = new Float32Array(water.geometry.attributes.position.array.length);
waterBase.set(water.geometry.attributes.position.array);
ensureUnderwaterOverlay();`
  );

  // Weapon-aware combat
  code = code.replace(
    `function attackMob() {
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
}`,
    `function attackMob() {
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
  window.setTimeout(() => mob.body?.material?.emissive?.setHex(0x102b14), crit ? 140 : 90);
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
    showToast('Slime defeated · +' + bonus + ' score' + (killStreak > 1 ? ' · streak x' + killStreak : ''));
    checkChallenges();
  }
}`
  );

  // --- Mobile joystick blends into WASD movement ---
  code = code.replace(
    "  const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);\n  const rightInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);",
    "  const joyVec = window.__mcJoystickVector || { x: 0, y: 0 };\n  const forwardInput = clamp((keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + joyVec.y, -1, 1);\n  const rightInput = clamp((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + joyVec.x, -1, 1);"
  );

  // --- Touch-look sensitivity setting ---
  code = code.replace(
    "  camera.rotation.y -= dx * 0.0045;\n  camera.rotation.x = clamp(camera.rotation.x - dy * 0.0045, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);",
    "  const lookScale = (window.__mcLookSensitivity || 5) / 5;\n  camera.rotation.y -= dx * 0.0045 * lookScale;\n  camera.rotation.x = clamp(camera.rotation.x - dy * 0.0045 * lookScale, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);"
  );

  // Longer reach when holding a sword
  code = code.replace(
    '  raycaster.far = 4.6;',
    '  raycaster.far = getActiveWeapon().reach;'
  );

  // Hint text shows weapon
  code = code.replace(
    "  if (currentMobTarget) interactionHint.textContent = `F · Attack slime (${currentMobTarget.hp} HP)`;",
    "  if (currentMobTarget) interactionHint.textContent = `Click / F · Attack with ${getActiveWeapon().label} (${currentMobTarget.hp} HP)`;\n  else if (getSelectedDef()?.isConsumable) interactionHint.textContent = 'F · Eat apple (+2 health)';\n  else if (getSelectedDef()?.isWeapon) interactionHint.textContent = `${getActiveWeapon().label} ready · click or F to attack`;"
  );

  // Do not place weapons / food as blocks
  code = code.replace(
    `function placeSelectedBlock() {
  if (!gameActive() || !currentTarget) return;
  const type = hotbarTypes[selectedIndex];
  if ((inventory[type] ?? 0) <= 0) {`,
    `function placeSelectedBlock() {
  if (!gameActive()) return;
  const type = hotbarTypes[selectedIndex];
  const def = blockTypes[type];
  if (def?.isConsumable) { tryConsumeApple(); return; }
  if (def?.isWeapon) { showToast(def.label + ' equipped · left-click or F to attack'); return; }
  if (!currentTarget) return;
  if ((inventory[type] ?? 0) <= 0) {`
  );

  // Stronger night slimes later in the run
  code = code.replace(
    'const mob = { group, body, hp: 3, attackTimer: 0, age: 0, phase: Math.random() * Math.PI * 2, knockback: new THREE.Vector3() };',
    'const mob = { group, body, hp: 3 + Math.min(3, Math.floor(dayCount / 2)), attackTimer: 0, age: 0, phase: Math.random() * Math.PI * 2, knockback: new THREE.Vector3() };'
  );

  // Day/night water + fog
  code = code.replace(
    '  waterMaterial.color.setHex(daylight > 0.25 ? 0x3b9ee8 : 0x183f72);\n\n  const totalMinutes = Math.floor(worldTime * 24 * 60);',
    `  if (daylight > 0.35) waterMaterial.color.setHex(0x1a7ab8);
  else if (daylight > 0.12) waterMaterial.color.setHex(0x2a5f8a);
  else waterMaterial.color.setHex(0x0c2a48);
  updateUnderwaterFog(delta, daylight);
  const totalMinutes = Math.floor(worldTime * 24 * 60);`
  );

  // Waves
  code = code.replace(
    'function updateClouds(delta) {\n  for (const cloud of clouds.children) {\n    cloud.position.x += cloud.userData.speed * delta;\n    if (cloud.position.x > 42) cloud.position.x = -42;\n  }\n  waterMaterial.opacity = 0.43 + Math.sin(performance.now() * 0.0018) * 0.035;\n}',
    `function updateClouds(delta) {
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
}`
  );

  // Animate loop extras
  code = code.replace(
    '  updateParticles(delta);\n  updateBlockAnimations(delta);\n  updateClouds(delta);',
    '  updateParticles(delta);\n  updateSplashParticles(delta);\n  updateBubbleParticles(delta);\n  updateBlockAnimations(delta);\n  updateClouds(delta);'
  );

  // Swim jump
  code = code.replace(
    "  if (event.code === 'Space' && !event.repeat && gameActive() && grounded) {\n    velocity.y = JUMP_SPEED;",
    "  if (event.code === 'Space' && !event.repeat && gameActive() && (grounded || isUnderwater || (camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.55))) {\n    velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED;\n    if (!grounded) spawnSplash(camera.position.x, Math.min(camera.position.y, SEA_LEVEL + 0.5), camera.position.z, 0.45);"
  );

  // Soft sky defaults
  code = code.replace(
    'scene.background = new THREE.Color(0x82c7f2);\nscene.fog = new THREE.Fog(0x82c7f2, 28, 68);',
    'scene.background = new THREE.Color(0x7eb8e8);\nscene.fog = new THREE.Fog(0x7eb8e8, 22, 62);'
  );
  code = code.replace(
    'const nightColor = new THREE.Color(0x071321);\n  const dayColor = new THREE.Color(0x82c7f2);\n  const duskColor = new THREE.Color(0xe58b68);',
    'const nightColor = new THREE.Color(0x060e1a);\n  const dayColor = new THREE.Color(0x7eb8e8);\n  const duskColor = new THREE.Color(0xd4784a);'
  );

  // Reset kill streak when taking damage
  code = code.replace(
    'function damagePlayer(amount, reason = \'damage\') {\n  if (isDead) return;\n  playerState.health = clamp(playerState.health - amount, 0, MAX_HEALTH);',
    "function damagePlayer(amount, reason = 'damage') {\n  if (isDead) return;\n  combatTimer = 6;\n  killStreak = 0;\n  playerState.health = clamp(playerState.health - amount, 0, MAX_HEALTH);"
  );

  // --- Real Minecraft-style sword shape (hotbar swatch + held item) ---
  code = code.replace(
    '    slot.innerHTML = `<span class="slot-number">${index + 1}</span><span class="block-swatch" style="background:${definition.color}"></span><span class="slot-count">${count}</span>`;',
    "    const isSword = Boolean(definition.isWeapon);\n    const swatchClass = isSword ? 'block-swatch sword-icon' : 'block-swatch';\n    const swatchStyle = isSword ? `--blade-color:${definition.color};color:${definition.color}` : `background:${definition.color}`;\n    slot.innerHTML = `<span class=\"slot-number\">${index + 1}</span><span class=\"${swatchClass}\" style=\"${swatchStyle}\">${isSword ? window.__mcSwordSVG : ''}</span><span class=\"slot-count\">${count}</span>`;"
  );
  code = code.replace(
    '  heldBlock.style.background = blockTypes[selectedType].color;',
    "  const heldDef = blockTypes[selectedType];\n  heldBlock.classList.toggle('sword-icon', Boolean(heldDef.isWeapon));\n  if (heldDef.isWeapon) {\n    heldBlock.style.background = '';\n    heldBlock.style.setProperty('--blade-color', heldDef.color);\n    heldBlock.style.color = heldDef.color;\n    heldBlock.innerHTML = window.__mcSwordSVG;\n  } else {\n    heldBlock.style.removeProperty('--blade-color');\n    heldBlock.style.color = '';\n    heldBlock.innerHTML = '';\n    heldBlock.style.background = heldDef.color;\n  }"
  );

  // --- Desktop: left click also attacks when aiming at a mob (in addition
  //     to mining blocks, which it already did). Right click still places. ---
  code = code.replace(
    '  if (!gameActive() || !leftMouseDown || !currentTarget || miningCooldown > 0) {\n    if (!leftMouseDown || !currentTarget || !gameActive()) resetMining();\n    return;\n  }',
    "  if (gameActive() && leftMouseDown && currentMobTarget) {\n    attackMob();\n    resetMining();\n    return;\n  }\n  if (!gameActive() || !leftMouseDown || !currentTarget || miningCooldown > 0) {\n    if (!leftMouseDown || !currentTarget || !gameActive()) resetMining();\n    return;\n  }"
  );

  // --- Fix: player occasionally ends up embedded in a block (after a rough
  //     spawn placement or a tight squeeze near mobs/terrain) and can no
  //     longer move. Every frame, if the player is found overlapping solid
  //     terrain, gently nudge them out to the nearest free space. This is a
  //     no-op (zero cost) in the normal case where nothing is overlapping. ---
  code = code.replace(
    'function updatePlayer(delta) {\n  if (!gameActive()) return;',
    "function resolveStuckPlayer() {\n  if (!playerCollidesAt(camera.position)) return;\n  const nudge = 0.06;\n  const directions = [\n    [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]\n  ];\n  for (let attempt = 0; attempt < 60; attempt += 1) {\n    if (!playerCollidesAt(camera.position)) return;\n    let escaped = false;\n    for (const [dx, dy, dz] of directions) {\n      const testPos = camera.position.clone();\n      testPos.x += dx * nudge;\n      testPos.y += dy * nudge;\n      testPos.z += dz * nudge;\n      if (!playerCollidesAt(testPos)) {\n        camera.position.copy(testPos);\n        escaped = true;\n        break;\n      }\n    }\n    if (!escaped) camera.position.y += nudge;\n  }\n}\n\nfunction updatePlayer(delta) {\n  if (!gameActive()) return;"
  );
  code = code.replace(
    '  if (camera.position.y < -8) damagePlayer(MAX_HEALTH, \'falling out of the world\');\n  updateStaminaUI();\n}',
    "  if (camera.position.y < -8) damagePlayer(MAX_HEALTH, 'falling out of the world');\n  resolveStuckPlayer();\n  updateStaminaUI();\n}"
  );

  // --- Quality mode: push High further up, Performance further down ---
  code = code.replace(
    "function applyQualitySettings() {\n  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityHigh ? 1.75 : 1));\n  renderer.shadowMap.enabled = qualityHigh;\n  sun.castShadow = qualityHigh;\n  qualityButton.textContent = `Quality: ${qualityHigh ? 'High' : 'Performance'}`;\n  rebuildWorldMeshes();\n}",
    "function applyQualitySettings() {\n  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityHigh ? 2 : 0.75));\n  renderer.shadowMap.enabled = qualityHigh;\n  sun.castShadow = qualityHigh;\n  const shadowSize = qualityHigh ? 3072 : 1024;\n  if (sun.shadow.mapSize.width !== shadowSize) {\n    sun.shadow.mapSize.set(shadowSize, shadowSize);\n    if (sun.shadow.map) {\n      sun.shadow.map.dispose();\n      sun.shadow.map = null;\n    }\n  }\n  renderer.toneMappingExposure = qualityHigh ? 1.08 : 0.98;\n  if (scene.fog) {\n    scene.fog.near = qualityHigh ? 30 : 16;\n    scene.fog.far = qualityHigh ? 85 : 40;\n  }\n  qualityButton.textContent = `Quality: ${qualityHigh ? 'High' : 'Performance'}`;\n  rebuildWorldMeshes();\n}"
  );

  // Richer particles in High quality, leaner particles in Performance
  code = code.replace(
    '  const count = qualityHigh ? (options.count ?? 12) : Math.ceil((options.count ?? 12) * 0.55);',
    '  const count = qualityHigh ? Math.ceil((options.count ?? 12) * 1.25) : Math.ceil((options.count ?? 12) * 0.35);'
  );

  // More mobs roaming in High quality, fewer in Performance (less update cost)
  code = code.replace(
    '  if (mobs.length >= (qualityHigh ? 6 : 4)) return;',
    '  if (mobs.length >= (qualityHigh ? 8 : 3)) return;'
  );

  // --- "G" opens the pause/settings menu, same as the on-screen pause
  //     button. Also releases desktop pointer lock so the menu is
  //     actually clickable (a locked pointer has no visible cursor). ---
  code = code.replace(
    "pauseButton.addEventListener('click', () => {\n  touchActive = false;\n  keys.clear();\n  leftMouseDown = false;\n  resetMining();\n  menu.classList.add('visible');\n  hud.classList.add('hidden');\n  hud.setAttribute('aria-hidden', 'true');\n  saveWorld(false);\n});",
    "function openPauseMenu() {\n  if (controls.isLocked) controls.unlock();\n  touchActive = false;\n  keys.clear();\n  leftMouseDown = false;\n  resetMining();\n  menu.classList.add('visible');\n  hud.classList.add('hidden');\n  hud.setAttribute('aria-hidden', 'true');\n  saveWorld(false);\n}\npauseButton.addEventListener('click', openPauseMenu);"
  );
  code = code.replace(
    "  if (event.code === 'KeyP' && !event.repeat) takeScreenshot();\n});",
    "  if (event.code === 'KeyP' && !event.repeat) takeScreenshot();\n  if (event.code === 'KeyG' && !event.repeat && gameActive()) openPauseMenu();\n});"
  );

  // =========================================================================
  // PERFORMANCE + BIGGER WORLD PATCHES (added after all gameplay patches;
  // some old_str targets below match text produced by patches above).
  //
  // Architecture: the world becomes a grid of CHUNK_SIZE x CHUNK_SIZE column
  // chunks. Each chunk keeps a flat Float32Array of block ids (terrain +
  // player modifications baked in) and a THREE.Group of per-type
  // InstancedMesh objects with fully hidden faces culled at mesh time.
  // Chunks are generated/meshed around the player (in a Web Worker when
  // available), frustum- and fog-distance-culled per frame, and disposed
  // when the player walks away. WORLD_RADIUS grew 18 -> 48 -> 72
  // (~16x area vs. the original core).
  //
  // All terrain / river / forest math lives in ./world-terrain.js (loaded
  // as a plain script and prepended to the engine blob in boot()). Both
  // this fallback path and world-worker.js call MCTerrain.* — no duplicate
  // copy in this file.
  // =========================================================================

  // --- P1: bigger world + chunk infrastructure (pure helpers; inserted at
  //     the top of the core, next to the other constants) ---
  code = code.replace(
    'const WORLD_RADIUS = 18;\nconst MAX_BUILD_HEIGHT = 26;',
    `const WORLD_RADIUS = 72;
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
}`
  );

  // --- P2: world generation becomes lazy (chunks generate on demand) ---
  code = code.replace(
    'function generateBaseWorld() {\n  blocks.clear();',
    'function generateBaseWorld() {\n  blocks.clear();\n  for (const key of [...chunkMap.keys()]) {\n    const p = key.split(\'|\');\n    dropChunk(Number(p[0]), Number(p[1]));\n  }\n  _workerPending.clear();'
  );

  // --- P3: full rebuild => bounded prime of chunks around the player.
  //     The whole original function is replaced so no dead all-world meshing
  //     loop survives in the patched engine. ---
  code = code.replace(
    `function rebuildWorldMeshes() {
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
}`,
    'function rebuildWorldMeshes() {\n  mcPrimeChunks();\n  blockMeshes.length = 0;\n}'
  );

  // --- P4: block raycast targets chunk groups (recursive) ---
  code = code.replace(
    '  const intersections = raycaster.intersectObjects(blockMeshes, false);',
    '  const intersections = raycaster.intersectObjects(chunkGroups, true);'
  );

  // --- P5/P6: block edits re-mesh only the affected chunk(s), never the
  //     whole world ---
  code = code.replace(
    '  if (rebuild) rebuildWorldMeshes();',
    '  if (rebuild) remeshAroundEdit(x, z);'
  );
  code = code.replace(
    '  scheduleWorldMeshRebuild(0.18);',
    '  remeshAroundEdit(x, z);'
  );

  // --- P7: streaming + culling hooks into the per-frame update ---
  code = code.replace(
    '  waterMaterial.opacity = isUnderwater ? 0.28 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);\n}',
    '  waterMaterial.opacity = isUnderwater ? 0.28 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);\n  streamChunks(delta);\n  chunkFrameCount += 1;\n  if (chunkFrameCount % 6 === 0) refreshChunkVisibility();\n}'
  );

  // --- P8: surface fog distances follow the quality toggle at runtime ---
  code = code.replace(
    'const surfaceFogNear = 22;\nconst surfaceFogFar = 62;',
    'const surfaceFogNear = qualityHigh ? 30 : 16;\nconst surfaceFogFar = qualityHigh ? 85 : 40;'
  );

  // --- P11: water plane segments scale with the bigger world so wave
  //     animation stays smooth over rivers (146-block plane / 40 segments
  //     would be one wave vertex every ~3.7 blocks; 64 keeps it ~2.3) ---
  code = code.replace(
    'const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 40, 40);',
    'const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 64, 64);'
  );

  // =========================================================================
  // MOB VARIETY PATCHES — zombie / skeleton / phantom join the slime.
  // Replaces four self-contained core functions (spawnSlime, removeSlime,
  // attackMob, updateMobs) plus the hint label and the kill challenge.
  // Every mob keeps the contract the rest of the core relies on:
  //   mob = { group, body, hp, attackTimer, age, phase, knockback },
  //   body.userData.mob = mob, hit meshes registered in mobHitMeshes,
  //   removal via removeSlime() (iterates group.children — type-agnostic).
  // =========================================================================

  // --- M0: mob type table + blocky builders. Materials are shared per part
  //     across all mobs of a type; mob.body gets a CLONE on spawn so the
  //     existing hit-flash (body.material.emissive) never leaks across mobs.
  code = code.replace(
    'const slimeBodyGeometry = new THREE.BoxGeometry(0.9, 0.72, 0.9);',
    `const MC_MOB_TYPES = {
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

const slimeBodyGeometry = new THREE.BoxGeometry(0.9, 0.72, 0.9);`
  );

  // --- M1: spawnSlime becomes a type-aware spawnMob (same function name,
  //     so updateMobs' existing spawnSlime() call keeps working). ---
  code = code.replace(
    `function spawnSlime() {
  if (mobs.length >= (qualityHigh ? 8 : 3)) return;
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
    const mob = { group, body, hp: 3 + Math.min(3, Math.floor(dayCount / 2)), attackTimer: 0, age: 0, phase: Math.random() * Math.PI * 2, knockback: new THREE.Vector3() };
    body.userData.mob = mob;
    leftEye.userData.mob = mob;
    rightEye.userData.mob = mob;
    mobHitMeshes.push(body, leftEye, rightEye);
    mobs.push(mob);
    scene.add(group);
    return;
  }
}`,
    `function spawnSlime() {
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
}`
  );

  // --- M2: removal iterates the mob's registered hit meshes (same as the
  //     original's group-children walk, but exact for cloned bodies). ---
  code = code.replace(
    `function removeSlime(mob) {
  scene.remove(mob.group);
  const mobIndex = mobs.indexOf(mob);
  if (mobIndex >= 0) mobs.splice(mobIndex, 1);
  for (const mesh of [mob.body, ...mob.group.children.filter((child) => child !== mob.body)]) {
    const index = mobHitMeshes.indexOf(mesh);
    if (index >= 0) mobHitMeshes.splice(index, 1);
  }
}`,
    `function removeSlime(mob) {
  if (!mob || !mob.group) return; // defensive: callers pass valid mobs, but never crash the frame loop
  scene.remove(mob.group);
  const mobIndex = mobs.indexOf(mob);
  if (mobIndex >= 0) mobs.splice(mobIndex, 1);
  const meshes = mob.hitMeshes || [mob.body, ...mob.group.children.filter((child) => child !== mob.body)];
  for (const mesh of meshes) {
    const index = mobHitMeshes.indexOf(mesh);
    if (index >= 0) mobHitMeshes.splice(index, 1);
  }
}`
  );

  // --- M3: per-type AI + animation. Same night-spawn gate, despawn rule,
  //     and melee structure as the original; movement/animation branches by
  //     mob.def. Phantom circles above head height with flapping wings;
  //     humanoids walk with swinging limbs. ---
  code = code.replace(
    `function updateMobs(delta) {
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
}`,
    `function updateMobs(delta) {
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
}`
  );

  // --- M4: kill toast + hit-flash reset name the mob type / restore its
  //     own base emissive. Only the weapon-aware attackMob survives
  //     patching (the vanilla one is fully replaced upstream), so the only
  //     real toast line is the bonus one. The emissive patch targets the
  //     crit variant explicitly — its old_str deliberately differs from its
  //     new_str so it can't self-match and double-apply. ---
  code = code.replace(
    "    showToast('Slime defeated · +' + bonus + ' score' + (killStreak > 1 ? ' · streak x' + killStreak : ''));",
    "    showToast((mob.def ? mob.def.label : 'Slime') + ' defeated · +' + bonus + ' score' + (killStreak > 1 ? ' · streak x' + killStreak : ''));"
  );
  code = code.replace(
    "  window.setTimeout(() => mob.body?.material?.emissive?.setHex(0x102b14), crit ? 140 : 90);",
    "  window.setTimeout(() => mob.body?.material?.emissive?.setHex(mob.baseEmissive ?? 0x102b14), crit ? 140 : 90);"
  );

  // --- M5: hint line + challenge text now cover all mob types ---
  code = code.replace(
    "  if (currentMobTarget) interactionHint.textContent = `Click / F · Attack with ${getActiveWeapon().label} (${currentMobTarget.hp} HP)`;",
    "  if (currentMobTarget) interactionHint.textContent = `Click / F · Attack ${currentMobTarget.def ? currentMobTarget.def.label : 'mob'} with ${getActiveWeapon().label} (${currentMobTarget.hp} HP)`;"
  );
  code = code.replace(
    "  { stat: 'kills', target: 8, title: 'Slime Slayer', label: 'Defeat more slimes' }",
    "  { stat: 'kills', target: 8, title: 'Mob Hunter', label: 'Defeat hostile mobs' }"
  );
  code = code.replace(
    "{ stat: 'kills', target: 3, title: 'Night Defender', label: 'Defeat slimes' }",
    "{ stat: 'kills', target: 3, title: 'Night Defender', label: 'Defeat mobs at night' }"
  );

  // --- P10: getBlock reads the chunked store instead of the (now unused)
  //     whole-world Map, keeping physics/minimap/mobs/UI consistent ---
  code = code.replace(
    'function getBlock(x, y, z) {\n  return blocks.get(keyOf(x, y, z));\n}',
    'function getBlock(x, y, z) {\n  const id = collisionLookup(x, y, z);\n  return id ? IDS_TYPE[id] : undefined;\n}'
  );

  return code;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  const loadingEl = document.querySelector('#loading');
  try {
    if (loadingEl) {
      loadingEl.classList.add('visible');
      loadingEl.innerHTML = '<span>Loading world…</span><small>Weapons, water, and terrain</small>';
    }
    const response = await fetch(CORE_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Core engine HTTP ' + response.status);
    let source = await response.text();
    source = applyPatches(source);
    // Shared terrain math (same bytes the worker importScripts) — plain
    // script, sets globalThis.MCTerrain. Relative path: works from GitHub
    // Pages subpaths and VS Code Live Server alike.
    const terrainResponse = await fetch('./world-terrain.js', { cache: 'force-cache' });
    if (!terrainResponse.ok) throw new Error('Terrain module HTTP ' + terrainResponse.status);
    const terrainSource = await terrainResponse.text();
    const prelude =
      terrainSource + '\n' +
      'const THREE = globalThis.__MICROCRAFT_THREE__;\n' +
      'const PointerLockControls = globalThis.__MICROCRAFT_PLC__;\n';
    await import(URL.createObjectURL(new Blob([prelude + source], { type: 'text/javascript' })));
  } catch (error) {
    console.error('MicroCraft boot failed:', error);
    if (loadingEl) {
      loadingEl.classList.add('visible');
      loadingEl.innerHTML =
        '<span>Unable to start world</span><small>Hard-refresh (Ctrl+Shift+R). Internet required for engine CDN.</small>';
    }
  }
}

boot();
