/**
 * MicroCraft mob verification — runtime suite.
 *
 * Standalone, zero dependencies: `node scripts/verify-mobs-runtime.mjs`
 * (run from anywhere — paths resolve relative to this script's location).
 *
 * What it does:
 *   Executes the REAL patched engine's mob code (spawnSlime / removeSlime /
 *   updateMobs / builders / type table, extracted from
 *   scripts/patched-engine.js) against a minimal stubbed THREE, and asserts
 *   behavior: all 4 mob types spawn, per-type HP scales with dayCount, parts
 *   and hit-mesh registries are wired, phantom flies at head height, zombie
 *   melee deals its damage with an arm swing, removal cleans registries, and
 *   the morning despawn rule still fires.
 *
 *   If scripts/patched-engine.js is missing or stale, this script first runs
 *   the marker suite (verify-mobs.mjs) to regenerate it — so you can also
 *   just run this one file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const patchedPath = path.join(here, 'patched-engine.js');
const markerSuite = path.join(here, 'verify-mobs.mjs');
const gameJsPath = path.join(here, '..', 'game.js');

function patchedIsStale() {
  if (!fs.existsSync(patchedPath)) return true;
  return fs.statSync(patchedPath).mtimeMs < fs.statSync(gameJsPath).mtimeMs;
}
if (patchedIsStale()) {
  console.log('patched-engine.js missing or older than game.js — regenerating via verify-mobs.mjs:');
  execFileSync(process.execPath, [markerSuite], { stdio: 'inherit' });
}

const patched = fs.readFileSync(patchedPath, 'utf8');

// ---- Minimal THREE stub ----
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  setY(y) { this.y = y; return this; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
}
class Euler { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
class Obj3D {
  constructor() { this.children = []; this.position = new V3(); this.rotation = new Euler(); this.scale = new V3(1, 1, 1); this.userData = {}; }
  add(...cs) { this.children.push(...cs); return this; }
  lookAt() {}
}
class Mesh extends Obj3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
class Group extends Obj3D {}
class BoxGeometry { constructor(w, h, d) { this.w = w; this.h = h; this.d = d; } }
class Material {
  constructor(o = {}) { Object.assign(this, o); this.emissive = { setHex(h) { this._h = h; }, _h: 0 }; }
  clone() { return new Material(this); }
}
const THREE = {
  Vector3: V3, Mesh, Group, BoxGeometry,
  MeshLambertMaterial: Material, MeshBasicMaterial: Material,
  Matrix4: class { multiplyMatrices() { return this; } makeTranslation() { return this; } },
  Frustum: class { setFromProjectionMatrix() {} intersectsSphere() { return true; } },
  Sphere: class { constructor() { this.center = new V3(); this.radius = 1; } },
  InstancedMesh: class extends Mesh { setMatrixAt() {} computeBoundingSphere() {} },
};

// ---- Extract the real generated code from the patched engine ----
function grab(src, head) {
  const start = src.indexOf(head);
  if (start < 0) throw new Error('missing in patched engine: ' + head);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const MOB_TABLE = patched.match(/const MC_MOB_TYPES = \{[\s\S]*?\n\};/)[0];
const MOB_LIST = patched.match(/const MC_MOB_LIST = [^\n]*;/)[0];
const MATS = patched.match(/const MC_MOB_MATS = \{[\s\S]*?\n\};/)[0];
const GEO_CACHE = 'const mcBoxGeoCache = new Map();';
const helpers = [
  grab(patched, 'function mcBoxGeo'), grab(patched, 'function mcLambert'),
  grab(patched, 'function mcAddPart'), grab(patched, 'function mcBuildHumanoid'),
  grab(patched, 'function mcBuildPhantom'), grab(patched, 'function mcBuildMobMesh')
].join('\n');
const slimeGeoms = [
  'const slimeBodyGeometry = new THREE.BoxGeometry(0.9, 0.72, 0.9);',
  'const slimeEyeGeometry = new THREE.BoxGeometry(0.13, 0.17, 0.08);',
  patched.match(/const slimeBodyMaterial = [^\n]*;/)[0],
  patched.match(/const slimeEyeMaterial = [^\n]*;/)[0]
].join('\n');
// Mob cap is disabled in this extracted copy so every type can be observed
// within a bounded number of spawn attempts.
const spawnFn = grab(patched, 'function spawnSlime()')
  .replace('if (mobs.length >= (qualityHigh ? 8 : 3)) return;', '// mob cap disabled for exhaustive spawn test');
const removeFn = grab(patched, 'function removeSlime(mob)');
const updateFn = grab(patched, 'function updateMobs(delta)');

// ---- Engine globals the mob code expects ----
const sandbox = {
  THREE, qualityHigh: true, SEA_LEVEL: 4, WORLD_RADIUS: 72, dayCount: 5,
  camera: { position: new V3(0, 10, 0) },
  mobs: [], mobHitMeshes: [],
  scene: { add() {}, remove() {} },
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  findGroundBlockY: () => 6,
  gameActive: () => true,
  damagePlayer: (dmg, src) => { sandbox._hits.push({ dmg, src }); },
  currentNightFactor: 0.8, // night: every type eligible to spawn
  mobSpawnTimer: 0, attackCooldown: 0,
  _hits: []
};
const engineSource = `${MOB_TABLE}\n${MOB_LIST}\n${GEO_CACHE}\n${MATS}\n${helpers}\n${slimeGeoms}\n${spawnFn}\n${removeFn}\n${updateFn}\n`;
const env = new Function(
  ...Object.keys(sandbox),
  engineSource + 'return { MC_MOB_TYPES, spawnSlime, removeSlime, updateMobs };'
)(...Object.values(sandbox));

const { MC_MOB_TYPES, spawnSlime, removeSlime, updateMobs } = env;
let pass = 0;
let total = 0;
const results = [];
const check = (name, cond) => { total++; if (cond) pass++; else results.push('FAIL  ' + name); };

// 1) Type table
check('4 mob types defined', Object.keys(MC_MOB_TYPES).length === 4);
check('phantom nightOnly+flying', MC_MOB_TYPES.phantom.nightOnly && MC_MOB_TYPES.phantom.flying);
check('zombie ground melee (dmg 2)', !MC_MOB_TYPES.zombie.flying && MC_MOB_TYPES.zombie.dmg === 2);
check('skeleton ground melee (dmg 2)', !MC_MOB_TYPES.skeleton.flying && MC_MOB_TYPES.skeleton.dmg === 2);

// 2) Spawn until every type observed (cap disabled; 400 attempts is generous)
for (let i = 0; i < 400; i++) spawnSlime();
const seen = {};
for (const mob of sandbox.mobs) if (!seen[mob.type]) seen[mob.type] = mob;
check('all 4 types spawned across 400 attempts', ['slime', 'zombie', 'skeleton', 'phantom'].every(t => seen[t]));

for (const t of ['slime', 'zombie', 'skeleton', 'phantom']) {
  const m = seen[t];
  if (!m) continue;
  const expectedHp = MC_MOB_TYPES[t].baseHp + Math.min(MC_MOB_TYPES[t].hpCap, Math.floor(sandbox.dayCount / 2) * MC_MOB_TYPES[t].hpPerTwoDays);
  check(`${t} hp scales with dayCount (=${expectedHp} at day 5)`, m.hp === expectedHp);
  check(`${t} hit meshes registered`, m.hitMeshes.every(h => sandbox.mobHitMeshes.includes(h)));
  check(`${t} userData.mob wired on every hit mesh`, m.hitMeshes.every(h => h.userData.mob === m));
}
check('zombie has humanoid parts (limbs+head)', Boolean(seen.zombie?.parts?.legL && seen.zombie?.parts?.armR && seen.zombie?.parts?.head));
check('skeleton has humanoid parts', Boolean(seen.skeleton?.parts?.legL && seen.skeleton?.parts?.head));
check('phantom has wings', Boolean(seen.phantom?.parts?.wingL && seen.phantom?.parts?.wingR));
check('slime keeps core squash body (no humanoid parts)', Boolean(seen.slime && !seen.slime.parts));

// 3) Movement
const zom = seen.zombie, pha = seen.phantom;
zom.group.position.set(3, 7.02, 3); pha.group.position.set(3, 7, 3);
sandbox.camera.position.set(0, 10, 0);
updateMobs(0.1);
check('zombie stays near ground level (y≈7)', Math.abs(zom.group.position.y - 7.02) < 0.6);
for (let t = 0; t < 12; t++) updateMobs(0.1); // let the phantom's lerp converge
check('phantom converges to head-height orbit (y in 9.3..11)', pha.group.position.y > 9.3 && pha.group.position.y < 11);
check('phantom never below ground+1.6', pha.group.position.y >= 6 + 1.6 - 0.01);

// 4) Melee: zombie in reach with a ready attack timer hurts the player for ITS damage
zom.group.position.set(0.5, 10, 0.5); zom.attackTimer = 0;
sandbox._hits.length = 0;
updateMobs(0.05);
check('zombie melee deals its dmg (2)', sandbox._hits.some(h => h.dmg === 2 && h.src === 'a hostile zombie'));
check('zombie arm swing on attack', zom.parts.armR.rotation.x === -1.2);

// 5) Removal cleans both registries
const victim = seen.skeleton || seen.zombie;
removeSlime(victim);
check('removeSlime unregisters all hit meshes', !sandbox.mobHitMeshes.some(h => victim.hitMeshes.includes(h)));
check('removeSlime splices from mobs', !sandbox.mobs.includes(victim));
check('removeSlime null-guard does not throw', (() => { try { removeSlime(undefined); return true; } catch { return false; } })());

// 6) Morning despawn rule — scalar sandbox values are bound by value, so a
//    second env instance runs at morning while sharing the mobs arrays.
const morningSandbox = Object.assign({}, sandbox, { currentNightFactor: 0.1, mobSpawnTimer: 999, _hits: [] });
const morningEnv = new Function(
  ...Object.keys(morningSandbox),
  engineSource + 'return { updateMobs };'
)(...Object.values(morningSandbox));
const old = sandbox.mobs.find(m => m.type === 'slime') || seen.slime;
if (!sandbox.mobs.includes(old)) sandbox.mobs.push(old);
old.age = 99; old.group.position.set(30, 7, 30); // far from player (dist ~42 > 8)
morningEnv.updateMobs(0.05);
check('morning despawn removes old far mobs', !sandbox.mobs.includes(old));

for (const line of results) console.log(line);
console.log(`verify-mobs-runtime.mjs: ${pass}/${total} checks passed`);
process.exit(pass === total ? 0 : 1);
