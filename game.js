/**
 * MicroCraft bootstrap — loads the core engine and applies realistic water immersion.
 * This keeps the main logic intact while upgrading water, underwater feel, and materials.
 */

const CORE_URL =
  'https://raw.githubusercontent.com/tagadearpit/microcraft-mini-minecraft/e8f770a4cd2a1cb806dcd131c5853f387f775877/game.js';

function applyRealismPatches(source) {
  let code = source;

  // Atmosphere
  code = code.replace(
    'scene.background = new THREE.Color(0x82c7f2);\nscene.fog = new THREE.Fog(0x82c7f2, 28, 68);',
    'scene.background = new THREE.Color(0x7eb8e8);\nscene.fog = new THREE.Fog(0x7eb8e8, 22, 62);'
  );

  code = code.replace(
    'renderer.toneMappingExposure = 1.05;',
    'renderer.toneMappingExposure = 1.12;'
  );

  code = code.replace(
    'const hemiLight = new THREE.HemisphereLight(0xc8e8ff, 0x5d6841, 1.55);',
    'const hemiLight = new THREE.HemisphereLight(0xb8d8f0, 0x4a5c38, 1.35);'
  );

  // Realistic materials
  code = code.replace(
    'return new THREE.MeshLambertMaterial({ map: texture, ...extra });',
    'return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.86, metalness: 0.04, ...extra });'
  );

  code = code.replace(
    'crystal: new THREE.MeshLambertMaterial({ map: textures.crystal, emissive: 0x17394d, emissiveIntensity: 0.75 }),\n  torch: new THREE.MeshLambertMaterial({ map: textures.torch, emissive: 0xff7b22, emissiveIntensity: 1.1 })',
    'crystal: new THREE.MeshStandardMaterial({ map: textures.crystal, emissive: 0x17394d, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.25 }),\n  torch: new THREE.MeshStandardMaterial({ map: textures.torch, emissive: 0xff7b22, emissiveIntensity: 1.25, roughness: 0.45, metalness: 0.1 })'
  );

  // Animated realistic water plane
  code = code.replace(
    `const waterMaterial = new THREE.MeshPhongMaterial({ color: 0x3b9ee8, transparent: true, opacity: 0.46, shininess: 90, depthWrite: false });\nconst water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 1.5, WORLD_RADIUS * 2 + 1.5), waterMaterial);\nwater.rotation.x = -Math.PI / 2;\nwater.position.y = SEA_LEVEL + 0.46;\nwater.renderOrder = 2;\nscene.add(water);`,
    `const waterGeometry = new THREE.PlaneGeometry(WORLD_RADIUS * 2 + 2, WORLD_RADIUS * 2 + 2, 48, 48);\nconst waterMaterial = new THREE.MeshPhongMaterial({
  color: 0x1a7ab8,
  transparent: true,
  opacity: 0.62,
  shininess: 140,
  specular: 0xa8d8ff,
  depthWrite: false,
  side: THREE.DoubleSide
});\nconst water = new THREE.Mesh(waterGeometry, waterMaterial);\nwater.rotation.x = -Math.PI / 2;\nwater.position.y = SEA_LEVEL + 0.42;\nwater.renderOrder = 2;\nwater.receiveShadow = true;\nscene.add(water);\nconst waterPositions = water.geometry.attributes.position;\nconst waterBase = new Float32Array(waterPositions.array.length);\nwaterBase.set(waterPositions.array);\nlet underwaterOverlay = document.getElementById('underwater-overlay');\nif (!underwaterOverlay) {\n  underwaterOverlay = document.createElement('div');\n  underwaterOverlay.id = 'underwater-overlay';\n  underwaterOverlay.setAttribute('aria-hidden', 'true');\n  document.body.appendChild(underwaterOverlay);\n}\nlet isUnderwater = false;\nlet waterRippleTime = 0;`
  );

  // Buoyancy + resistance when in water
  code = code.replace(
    `  const inWater = camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.65;\n  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (inWater ? 0.62 : 1);\n  velocity.x = movement.x * speed;\n  velocity.z = movement.z * speed;\n  velocity.y -= GRAVITY * delta;`,
    `  const feetY = camera.position.y - EYE_HEIGHT;\n  const eyeY = camera.position.y;\n  const inWater = feetY < SEA_LEVEL + 0.55;\n  const fullySubmerged = eyeY < SEA_LEVEL + 0.35;\n  isUnderwater = fullySubmerged;\n  let speedMul = 1;\n  let gravityMul = 1;\n  if (fullySubmerged) {\n    speedMul = 0.48;\n    gravityMul = 0.22;\n    velocity.y += 4.2 * delta;\n  } else if (inWater) {\n    speedMul = 0.58;\n    gravityMul = 0.55;\n    velocity.y += 1.6 * delta;\n  }\n  const speed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * speedMul;\n  velocity.x = movement.x * speed;\n  velocity.z = movement.z * speed;\n  velocity.y -= GRAVITY * gravityMul * delta;`
  );

  // Swim jump
  code = code.replace(
    "  if (event.code === 'Space' && !event.repeat && gameActive() && grounded) {\n    velocity.y = JUMP_SPEED;",
    "  if (event.code === 'Space' && !event.repeat && gameActive() && (grounded || isUnderwater || (camera.position.y - EYE_HEIGHT < SEA_LEVEL + 0.55))) {\n    velocity.y = isUnderwater ? JUMP_SPEED * 0.72 : JUMP_SPEED;"
  );

  // Underwater fog / lighting + day water colors
  code = code.replace(
    '  waterMaterial.color.setHex(daylight > 0.25 ? 0x3b9ee8 : 0x183f72);\n\n  const totalMinutes = Math.floor(worldTime * 24 * 60);',
    `  if (daylight > 0.35) {\n    waterMaterial.color.setHex(0x1a7ab8);\n    waterMaterial.specular = new THREE.Color(0xb8e4ff);\n  } else if (daylight > 0.12) {\n    waterMaterial.color.setHex(0x2a5f8a);\n    waterMaterial.specular = new THREE.Color(0x6aa0c8);\n  } else {\n    waterMaterial.color.setHex(0x0c2a48);\n    waterMaterial.specular = new THREE.Color(0x3a6088);\n  }\n  if (isUnderwater) {\n    const deep = new THREE.Color(0x0a3a52);\n    scene.background.copy(deep);\n    scene.fog.color.copy(deep);\n    scene.fog.near = 2;\n    scene.fog.far = 14;\n    hemiLight.intensity = 0.35;\n    sun.intensity *= 0.35;\n    if (underwaterOverlay) underwaterOverlay.classList.add('active');\n  } else {\n    scene.fog.near = 22;\n    scene.fog.far = 62;\n    if (underwaterOverlay) underwaterOverlay.classList.remove('active');\n  }\n\n  const totalMinutes = Math.floor(worldTime * 24 * 60);`
  );

  // Wave animation
  code = code.replace(
    `function updateClouds(delta) {\n  for (const cloud of clouds.children) {\n    cloud.position.x += cloud.userData.speed * delta;\n    if (cloud.position.x > 42) cloud.position.x = -42;\n  }\n  waterMaterial.opacity = 0.43 + Math.sin(performance.now() * 0.0018) * 0.035;\n}`,
    `function updateClouds(delta) {\n  for (const cloud of clouds.children) {\n    cloud.position.x += cloud.userData.speed * delta;\n    if (cloud.position.x > 42) cloud.position.x = -42;\n  }\n  waterRippleTime += delta;\n  const pos = water.geometry.attributes.position;\n  for (let i = 0; i < pos.count; i += 1) {\n    const ix = i * 3;\n    const x = waterBase[ix];\n    const y = waterBase[ix + 1];\n    const wave1 = Math.sin(x * 0.55 + waterRippleTime * 1.6) * 0.045;\n    const wave2 = Math.cos(y * 0.48 + waterRippleTime * 1.15) * 0.032;\n    const wave3 = Math.sin((x + y) * 0.28 + waterRippleTime * 0.9) * 0.02;\n    pos.array[ix + 2] = waterBase[ix + 2] + wave1 + wave2 + wave3;\n  }\n  pos.needsUpdate = true;\n  water.geometry.computeVertexNormals();\n  waterMaterial.opacity = isUnderwater ? 0.28 : (0.58 + Math.sin(waterRippleTime * 1.4) * 0.04);\n}`
  );

  // Sky tones
  code = code.replace(
    'const nightColor = new THREE.Color(0x071321);\n  const dayColor = new THREE.Color(0x82c7f2);\n  const duskColor = new THREE.Color(0xe58b68);',
    'const nightColor = new THREE.Color(0x060e1a);\n  const dayColor = new THREE.Color(0x7eb8e8);\n  const duskColor = new THREE.Color(0xd4784a);'
  );

  return code;
}

async function boot() {
  const loading = document.querySelector('#loading');
  try {
    const response = await fetch(CORE_URL);
    if (!response.ok) throw new Error('Failed to load core engine');
    let source = await response.text();
    source = applyRealismPatches(source);

    // Rewrite relative-looking three imports stay as bare specifiers for the page import map
    const blob = new Blob([source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    await import(url);
  } catch (error) {
    console.error(error);
    if (loading) {
      loading.innerHTML =
        '<span>Game failed to load</span><small>Check your internet connection and refresh the page.</small>';
      loading.classList.add('visible');
    }
  }
}

boot();
