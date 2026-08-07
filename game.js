/**
 * MicroCraft — GitHub Pages safe loader
 * Loads proven core engine from CDN, injects Three.js, applies water realism.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const CORE_URL =
  'https://cdn.jsdelivr.net/gh/tagadearpit/microcraft-mini-minecraft@e8f770a4cd2a1cb806dcd131c5853f387f775877/game.js';

globalThis.__MICROCRAFT_THREE__ = THREE;
globalThis.__MICROCRAFT_PLC__ = PointerLockControls;

function applyPatches(source) {
  let code = source;

  code = code.replace(/import\s+\*\s+as\s+THREE\s+from\s+['\"]three['\"];\s*/m, '');
  code = code.replace(
    /import\s+\{\s*PointerLockControls\s*\}\s+from\s+['\"]three\/addons\/controls\/PointerLockControls\.js['\"];\s*/m,
    ''
  );

  code = code.replace(
    'let lastWorldTime = worldTime;',
    `let lastWorldTime = worldTime;
let isUnderwater = false;
let wasInWater = false;
let waterRippleTime = 0;
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
  const count = Math.floor((qualityHigh ? 16 : 9) * intensity);
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xb6ecff, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(splashGeometry, mat);
    mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.1, z + (Math.random() - 0.5) * 0.5);
    mesh.scale.setScalar(0.5 + Math.random() * 0.9);
    scene.add(mesh);
    splashParticles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2.2 * intensity, (2.0 + Math.random() * 3.4) * intensity, (Math.random() - 0.5) * 2.2 * intensity),
      life: 0.4 + Math.random() * 0.35,
      maxLife: 0.75
    });
  }
  try { playTone(210 + Math.random() * 50, 0.04, 0.018, 'sine'); } catch (e) {}
}

function spawnBubble(x, y, z, sizeScale = 1) {
  const radius = (0.04 + Math.random() * 0.09) * sizeScale;
  const mat = new THREE.MeshPhongMaterial({ color: 0xd8f6ff, transparent: true, opacity: 0.45 + Math.random() * 0.25, shininess: 120, specular: 0xffffff, depthWrite: false });
  const mesh = new THREE.Mesh(bubbleGeometry, mat);
  mesh.scale.setScalar(radius);
  mesh.position.set(x + (Math.random() - 0.5) * 0.35, y, z + (Math.random() - 0.5) * 0.35);
  mesh.renderOrder = 3;
  scene.add(mesh);
  bubbleParticles.push({
    mesh,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.55 + Math.random() * 0.85, (Math.random() - 0.5) * 0.25),
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 2.2 + Math.random() * 2.5,
    life: 1.4 + Math.random() * 1.8,
    maxLife: 3.2,
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
      bubbleSpawnTimer = qualityHigh ? (0.12 + Math.random() * 0.18) : (0.22 + Math.random() * 0.28);
      const feetY = camera.position.y - EYE_HEIGHT;
      spawnBubble(camera.position.x + (Math.random() - 0.5) * 1.2, feetY + 0.2 + Math.random() * 0.6, camera.position.z + (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.6);
      if (Math.random() < 0.35) {
        spawnBubble(camera.position.x + (Math.random() - 0.5) * 5, Math.min(SEA_LEVEL - 0.3, feetY + Math.random() * 1.5), camera.position.z + (Math.random() - 0.5) * 5, 0.5 + Math.random() * 1.1);
      }
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
    const t = Math.max(0, b.life / (b.maxLife || 3));
    b.mesh.material.opacity = Math.min(0.7, 0.25 + t * 0.45);
    if (b.mesh.position.y >= SEA_LEVEL + 0.35 || b.life <= 0) {
      if (b.mesh.position.y >= SEA_LEVEL + 0.2) spawnSplash(b.mesh.position.x, SEA_LEVEL + 0.45, b.mesh.position.z, 0.18);
      scene.remove(b.mesh);
      b.mesh.material.dispose();
      bubbleParticles.splice(i, 1);
    }
  }
}

function updateUnderwaterFog(delta, daylight) {
  const eyeY = camera.position.y;
  const depthBelow = Math.max(0, (SEA_LEVEL + 0.35) - eyeY);
  const targetBlend = depthBelow > 0 ? Math.min(1, 0.35 + depthBelow / 2.2) : 0;
  const lerpSpeed = targetBlend > underwaterFogBlend ? 5.5 : 3.2;
  underwaterFogBlend += (targetBlend - underwaterFogBlend) * Math.min(1, delta * lerpSpeed);
  if (underwaterFogBlend < 0.001) underwaterFogBlend = 0;
  const overlay = ensureUnderwaterOverlay();
  if (underwaterFogBlend > 0) {
    const shallow = new THREE.Color(0x1a6b7e);
    const mid = new THREE.Color(0x0c4558);
    const deep = new THREE.Color(0x031820);
    const fogColor = shallow.clone().lerp(mid, Math.min(1, underwaterFogBlend * 1.2));
    fogColor.lerp(deep, Math.max(0, underwaterFogBlend - 0.45) / 0.55);
    if (daylight < 0.35) fogColor.lerp(new THREE.Color(0x01080e), ((0.35 - daylight) / 0.35) * 0.45);
    const near = 0.4 + (1 - underwaterFogBlend) * 2.8;
    const far = 5.5 + (1 - underwaterFogBlend) * 14;
    if (!scene.fog) scene.fog = new THREE.Fog(fogColor.getHex(), near, far);
    else { scene.fog.color.copy(fogColor); scene.fog.near = near; scene.fog.far = far; }
    scene.background.copy(fogColor);
    const lightMul = 1 - underwaterFogBlend * 0.72;
    hemiLight.intensity = (0.22 + daylight * 1.35) * lightMul;
    sun.intensity = (0.12 + daylight * 2.25) * (1 - underwaterFogBlend * 0.8);
    overlay.style.opacity = String(0.35 + underwaterFogBlend * 0.65);
    overlay.classList.add('active');
  } else {
    if (scene.fog) { scene.fog.near = surfaceFogNear; scene.fog.far = surfaceFogFar; }
    overlay.style.opacity = '';
    overlay.classList.remove('active');
  }
}`
  );

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

  code = code.replace(
    '  const inWater = camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.65;\n  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (inWater ? 0.62 : 1);\n  velocity.x = movement.x * speed;\n  velocity.z = movement.z * speed;\n  velocity.y -= GRAVITY * delta;',
    `  const feetY = camera.position.y - EYE_HEIGHT;
  const eyeY = camera.position.y;
  const inWater = feetY < SEA_LEVEL + 0.55;
  const fullySubmerged = eyeY < SEA_LEVEL + 0.35;
  isUnderwater = fullySubmerged;
  if (inWater && !wasInWater) {
    const impact = Math.max(0.4, Math.min(1.5, Math.abs(velocity.y) / 8));
    spawnSplash(camera.position.x, SEA_LEVEL + 0.5, camera.position.z, impact);
  }
  if (inWater && movement.lengthSq() > 0.12 && Math.random() < delta * 5) {
    spawnSplash(camera.position.x, SEA_LEVEL + 0.48, camera.position.z, 0.3);
  }
  if (fullySubmerged && movement.lengthSq() > 0.2 && Math.random() < delta * 8) {
    spawnBubble(camera.position.x, feetY + 0.4, camera.position.z, 0.7 + Math.random() * 0.5);
  }
  wasInWater = inWater;
  let speedMul = 1;
  let gravityMul = 1;
  if (fullySubmerged) { speedMul = 0.5; gravityMul = 0.25; velocity.y += 3.8 * delta; }
  else if (inWater) { speedMul = 0.6; gravityMul = 0.58; velocity.y += 1.4 * delta; }
  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * speedMul;
  velocity.x = movement.x * speed;
  velocity.z = movement.z * speed;
  velocity.y -= GRAVITY * gravityMul * delta;`
  );

  code = code.replace(
    "  if (event.code === 'Space' && !event.repeat && gameActive() && grounded) {\n    velocity.y = JUMP_SPEED;",
    "  if (event.code === 'Space' && !event.repeat && gameActive() && (grounded || isUnderwater || (camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.55))) {\n    velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED;\n    if (!grounded) {\n      spawnSplash(camera.position.x, Math.min(camera.position.y, SEA_LEVEL + 0.5), camera.position.z, 0.5);\n      if (isUnderwater) for (let bi = 0; bi < 4; bi += 1) spawnBubble(camera.position.x, camera.position.y - 0.4, camera.position.z, 0.6 + Math.random() * 0.5);\n    }"
  );

  code = code.replace(
    '  waterMaterial.color.setHex(daylight > 0.25 ? 0x3b9ee8 : 0x183f72);\n\n  const totalMinutes = Math.floor(worldTime * 24 * 60);',
    `  if (daylight > 0.35) waterMaterial.color.setHex(0x1a7ab8);
  else if (daylight > 0.12) waterMaterial.color.setHex(0x2a5f8a);
  else waterMaterial.color.setHex(0x0c2a48);
  updateUnderwaterFog(delta, daylight);
  const totalMinutes = Math.floor(worldTime * 24 * 60);`
  );

  code = code.replace(
    'function updateClouds(delta) {\n  for (const cloud of clouds.children) {\n    cloud.position.x += cloud.userData.speed * delta;\n    if (cloud.position.x > 42) cloud.position.x = -42;\n  }\n  waterMaterial.opacity = 0.43 + Math.sin(performance.now() * 0.0018) * 0.035;\n}',
    `function updateClouds(delta) {
  for (const cloud of clouds.children) {
    cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > 42) cloud.position.x = -42;
  }
  waterRippleTime += delta;
  if (waterBase && water && water.geometry) {
    const pos = water.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const ix = i * 3;
      const x = waterBase[ix];
      const y = waterBase[ix + 1];
      pos.array[ix + 2] = waterBase[ix + 2] + Math.sin(x * 0.55 + waterRippleTime * 1.6) * 0.04 + Math.cos(y * 0.48 + waterRippleTime * 1.15) * 0.028;
    }
    pos.needsUpdate = true;
    water.geometry.computeVertexNormals();
  }
  waterMaterial.opacity = isUnderwater ? 0.28 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);
}`
  );

  code = code.replace(
    '  updateParticles(delta);\n  updateBlockAnimations(delta);\n  updateClouds(delta);',
    '  updateParticles(delta);\n  updateSplashParticles(delta);\n  updateBubbleParticles(delta);\n  updateBlockAnimations(delta);\n  updateClouds(delta);'
  );

  code = code.replace(
    'const nightColor = new THREE.Color(0x071321);\n  const dayColor = new THREE.Color(0x82c7f2);\n  const duskColor = new THREE.Color(0xe58b68);',
    'const nightColor = new THREE.Color(0x060e1a);\n  const dayColor = new THREE.Color(0x7eb8e8);\n  const duskColor = new THREE.Color(0xd4784a);'
  );

  code = code.replace(
    'scene.background = new THREE.Color(0x82c7f2);\nscene.fog = new THREE.Fog(0x82c7f2, 28, 68);',
    'scene.background = new THREE.Color(0x7eb8e8);\nscene.fog = new THREE.Fog(0x7eb8e8, 22, 62);'
  );

  return code;
}

async function boot() {
  const loadingEl = document.querySelector('#loading');
  try {
    if (loadingEl) {
      loadingEl.classList.add('visible');
      loadingEl.innerHTML = '<span>Loading world…</span><small>Preparing terrain and water</small>';
    }
    const response = await fetch(CORE_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Core engine HTTP ' + response.status);
    let source = await response.text();
    source = applyPatches(source);
    const prelude =
      'const THREE = globalThis.__MICROCRAFT_THREE__;\n' +
      'const PointerLockControls = globalThis.__MICROCRAFT_PLC__;\n';
    const blob = new Blob([prelude + source], { type: 'text/javascript' });
    await import(URL.createObjectURL(blob));
  } catch (error) {
    console.error('MicroCraft boot failed:', error);
    if (loadingEl) {
      loadingEl.classList.add('visible');
      loadingEl.innerHTML =
        '<span>Unable to start world</span><small>Hard-refresh (Ctrl+Shift+R). Need internet for Three.js + engine CDN.</small>';
    }
  }
}

boot();
