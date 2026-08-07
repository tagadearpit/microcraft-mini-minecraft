/**
 * MicroCraft — GitHub Pages loader
 * ---------------------------------
 * 1) Loads the stable core engine from CDN
 * 2) Injects Three.js from the page import map
 * 3) Applies feature patches (water, weapons, combat, QoL)
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------------------------------------------------------------------------
const CORE_URL =
  'https://cdn.jsdelivr.net/gh/tagadearpit/microcraft-mini-minecraft@e8f770a4cd2a1cb806dcd131c5853f387f775877/game.js';

globalThis.__MICROCRAFT_THREE__ = THREE;
globalThis.__MICROCRAFT_PLC__ = PointerLockControls;

// ---------------------------------------------------------------------------
// Feature patches
// ---------------------------------------------------------------------------
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

  // Longer reach when holding a sword
  code = code.replace(
    '  raycaster.far = 4.6;',
    '  raycaster.far = getActiveWeapon().reach;'
  );

  // Hint text shows weapon
  code = code.replace(
    "  if (currentMobTarget) interactionHint.textContent = `F · Attack slime (${currentMobTarget.hp} HP)`;",
    "  if (currentMobTarget) interactionHint.textContent = `F · Attack with ${getActiveWeapon().label} (${currentMobTarget.hp} HP)`;\n  else if (getSelectedDef()?.isConsumable) interactionHint.textContent = 'F · Eat apple (+2 health)';\n  else if (getSelectedDef()?.isWeapon) interactionHint.textContent = `${getActiveWeapon().label} ready · F to attack`;"
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
  if (def?.isWeapon) { showToast(def.label + ' equipped · press F to attack'); return; }
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
    const prelude =
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
