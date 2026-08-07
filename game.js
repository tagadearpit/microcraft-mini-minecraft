/**
 * MicroCraft — GitHub Pages safe loader
 * Loads the proven core engine, injects Three.js correctly, and adds
 * realistic water immersion + dynamic splash particles.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Core engine snapshot that is known to run correctly
const CORE_URL =
  'https://cdn.jsdelivr.net/gh/tagadearpit/microcraft-mini-minecraft@e8f770a4cd2a1cb806dcd131c5853f387f775877/game.js';

globalThis.__MICROCRAFT_THREE__ = THREE;
globalThis.__MICROCRAFT_PLC__ = PointerLockControls;

function applyPatches(source) {
  let code = source;

  // Strip original ES imports (we inject Three from this module)
  code = code.replace(/import\s+\*\s+as\s+THREE\s+from\s+['\"]three['\"];\s*/m, '');
  code = code.replace(
    /import\s+\{\s*PointerLockControls\s*\}\s+from\s+['\"]three\/addons\/controls\/PointerLockControls\.js['\"];\s*/m,
    ''
  );

  // Always declare water state early so movement never references undeclared vars
  code = code.replace(
    'let lastWorldTime = worldTime;',
    `let lastWorldTime = worldTime;
let isUnderwater = false;
let wasInWater = false;
let waterRippleTime = 0;
const splashParticles = [];
let underwaterOverlay = null;
let waterBase = null;
const splashGeometry = new THREE.SphereGeometry(0.055, 6, 6);

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
    const mat = new THREE.MeshBasicMaterial({
      color: 0xb6ecff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(splashGeometry, mat);
    mesh.position.set(
      x + (Math.random() - 0.5) * 0.5,
      y + Math.random() * 0.1,
      z + (Math.random() - 0.5) * 0.5
    );
    mesh.scale.setScalar(0.5 + Math.random() * 0.9);
    scene.add(mesh);
    splashParticles.push({
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 2.2 * intensity,
        (2.0 + Math.random() * 3.4) * intensity,
        (Math.random() - 0.5) * 2.2 * intensity
      ),
      life: 0.4 + Math.random() * 0.35,
      maxLife: 0.75
    });
  }
  try { playTone(210 + Math.random() * 50, 0.04, 0.018, 'sine'); } catch (e) {}
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
}`
  );

  // Better water surface (keep variable name waterMaterial / water)
  code = code.replace(
    'const waterMaterial = new THREE.MeshPhongMaterial({ color: 0x3b9ee8, transparent: true, opacity: 0.46, shininess: 90, depthWrite: false });\nconst water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 1.5, WORLD_RADIUS * 2 + 1.5), waterMaterial);\nwater.rotation.x = -Math.PI / 2;\nwater.position.y = SEA_LEVEL + 0.46;\nwater.renderOrder = 2;\nscene.add(water);',
    `const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 40, 40);
const waterMaterial = new THREE.MeshPhongMaterial({
  color: 0x1a7ab8,
  transparent: true,
  opacity: 0.62,
  shininess: 140,
  specular: 0xa8d8ff,
  depthWrite: false,
  side: THREE.DoubleSide
});
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

  // Movement: buoyancy + splash on enter (keep WASD intact)
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
  wasInWater = inWater;

  let speedMul = 1;
  let gravityMul = 1;
  if (fullySubmerged) {
    speedMul = 0.5;
    gravityMul = 0.25;
    velocity.y += 3.8 * delta;
  } else if (inWater) {
    speedMul = 0.6;
    gravityMul = 0.58;
    velocity.y += 1.4 * delta;
  }

  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * speedMul;
  velocity.x = movement.x * speed;
  velocity.z = movement.z * speed;
  velocity.y -= GRAVITY * gravityMul * delta;`
  );

  // Swim jump + splash
  code = code.replace(
    "  if (event.code === 'Space' && !event.repeat && gameActive() && grounded) {\n    velocity.y = JUMP_SPEED;",
    "  if (event.code === 'Space' && !event.repeat && gameActive() && (grounded || isUnderwater || (camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.55))) {\n    velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED;\n    if (!grounded) spawnSplash(camera.position.x, Math.min(camera.position.y, SEA_LEVEL + 0.5), camera.position.z, 0.5);"
  );

  // Underwater look + water color
  code = code.replace(
    '  waterMaterial.color.setHex(daylight > 0.25 ? 0x3b9ee8 : 0x183f72);\n\n  const totalMinutes = Math.floor(worldTime * 24 * 60);',
    `  if (daylight > 0.35) waterMaterial.color.setHex(0x1a7ab8);
  else if (daylight > 0.12) waterMaterial.color.setHex(0x2a5f8a);
  else waterMaterial.color.setHex(0x0c2a48);

  const overlay = ensureUnderwaterOverlay();
  if (isUnderwater) {
    const deep = new THREE.Color(0x0a3a52);
    scene.background.copy(deep);
    scene.fog.color.copy(deep);
    scene.fog.near = 2;
    scene.fog.far = 14;
    hemiLight.intensity = 0.35;
    sun.intensity *= 0.35;
    overlay.classList.add('active');
  } else {
    scene.fog.near = 22;
    scene.fog.far = 62;
    overlay.classList.remove('active');
  }

  const totalMinutes = Math.floor(worldTime * 24 * 60);`
  );

  // Waves + opacity shimmer
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
      const wave1 = Math.sin(x * 0.55 + waterRippleTime * 1.6) * 0.04;
      const wave2 = Math.cos(y * 0.48 + waterRippleTime * 1.15) * 0.028;
      pos.array[ix + 2] = waterBase[ix + 2] + wave1 + wave2;
    }
    pos.needsUpdate = true;
    water.geometry.computeVertexNormals();
  }
  waterMaterial.opacity = isUnderwater ? 0.28 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);
}`
  );

  // Animate splash particles each frame
  code = code.replace(
    '  updateParticles(delta);\n  updateBlockAnimations(delta);\n  updateClouds(delta);',
    '  updateParticles(delta);\n  updateSplashParticles(delta);\n  updateBlockAnimations(delta);\n  updateClouds(delta);'
  );

  // Soft sky
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
    const url = URL.createObjectURL(blob);
    await import(url);
  } catch (error) {
    console.error('MicroCraft boot failed:', error);
    if (loadingEl) {
      loadingEl.classList.add('visible');
      loadingEl.innerHTML =
        '<span>Unable to start world</span><small>Hard-refresh (Ctrl+Shift+R). Check your internet connection (Three.js + engine load from CDN).</small>';
    }
  }
}

boot();
