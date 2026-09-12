/**
 * MicroCraft patch verification — static/markers suite.
 *
 * Standalone, zero dependencies: `node scripts/verify-mobs.mjs`
 * (run from anywhere — paths resolve relative to this script's location).
 *
 * What it does:
 *   1. Loads ../game.js (the loader + patch layer) and ./core-source.js
 *      (a verbatim copy of the pinned remote engine, commit e8f770a4 — the
 *      same bytes CORE_URL fetches at runtime; sha256 printed at the end so
 *      you can compare against a fresh CDN download if you want).
 *   2. Executes the loader's real applyPatches() against the core source and
 *      asserts every sword/mob/terrain patch actually matched (no silent
 *      no-op string replacements).
 *   3. Writes the resulting patched engine to ./patched-engine.js so that
 *      verify-mobs-runtime.mjs (and you) can inspect/execute it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const loaderPath = path.join(here, '..', 'game.js');
const corePath = path.join(here, 'core-source.js');
const outPath = path.join(here, 'patched-engine.js');

const loader = fs.readFileSync(loaderPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

// Sanity: this copy must be the pinned commit's engine (spot-check markers).
if (!core.includes('const WORLD_RADIUS = 18;') || !core.includes('function spawnSlime()')) {
  console.error('core-source.js does not look like the pinned engine (missing WORLD_RADIUS/spawnSlime markers).');
  process.exit(1);
}

// ---- Execute the loader's applyPatches() with browser globals stubbed ----
let mod = loader
  .replace(/import \* as THREE from 'three';\n/, '')
  .replace(/import \{ PointerLockControls \} from 'three\/addons\/controls\/PointerLockControls\.js';\n/, '')
  .replace(/^boot\(\);\s*$/m, '');
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener: () => {}, __mcLookSensitivity: 5 };
globalThis.document = { documentElement: { classList: { add: () => {} } }, addEventListener: () => {}, querySelector: () => null, readyState: 'complete' };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.screen = {};
const applyPatches = new Function(
  'const THREE = {}; const PointerLockControls = function(){};\n' + mod + '\nreturn applyPatches;'
)();
const patched = applyPatches(core);

const styleCss = fs.readFileSync(path.join(here, '..', 'style.css'), 'utf8');

const checks = [
  // --- sword icon (pixel-grid SVG) ---
  ['sword SVG global defined', loader.includes('globalThis.__mcSwordSVG = MC_SWORD_PIXEL_ART')],
  ['sword grid from reference (16 rows)', loader.includes("'.............XXX'") && loader.includes("'XXX.............'")],
  ['hotbar injects __mcSwordSVG', loader.includes('window.__mcSwordSVG')],
  ['held item injects __mcSwordSVG', loader.includes('heldBlock.innerHTML = window.__mcSwordSVG')],
  ['held item clears innerHTML for non-swords', loader.includes("heldBlock.innerHTML = '';")],
  // --- mob infrastructure (M0) ---
  ['mob type table injected', patched.includes('const MC_MOB_TYPES = {')],
  ['zombie def present', patched.includes("zombie:   { key: 'zombie'")],
  ['skeleton def present', patched.includes("skeleton: { key: 'skeleton'")],
  ['phantom def present', patched.includes("phantom:  { key: 'phantom'")],
  ['phantom nightOnly', patched.includes('nightOnly: true,  flying: true')],
  ['builders present', patched.includes('function mcBuildHumanoid') && patched.includes('function mcBuildPhantom')],
  // --- M1 spawn ---
  ['M1 spawn replaced (weighted pool)', patched.includes('const pool = [];') && patched.includes('spawnWeight; w += 1')],
  ['M1 keeps 8:3 cap', patched.includes('if (mobs.length >= (qualityHigh ? 8 : 3)) return;\n  // Weighted type pick')],
  ['M1 hp scaling uses type', patched.includes('type.baseHp + Math.min(type.hpCap')],
  ['M1 body clone for hit-flash', patched.includes('body.material = body.material.clone();')],
  ['M1 baseEmissive set', patched.includes("baseEmissive: type.key === 'slime'")],
  // --- M2 removal ---
  ['M2 removal uses hitMeshes', patched.includes('const meshes = mob.hitMeshes || [mob.body')],
  ['M2 removal null-guarded', patched.includes('if (!mob || !mob.group) return;')],
  // --- M3 updateMobs ---
  ['M3 updateMobs replaced', patched.includes('const def = mob.def || MC_MOB_TYPES.slime;')],
  ['M3 phantom flight', patched.includes('targetY = camera.position.y + 0.4') && patched.includes('never clip into terrain')],
  ['M3 humanoid limb swing', patched.includes('mob.parts.legL.rotation.x = swing;')],
  ['M3 wing flap', patched.includes('mob.parts.wingL.rotation.z = flap;')],
  ['M3 per-type melee dmg', patched.includes("damagePlayer(def.dmg, 'a hostile ' + def.label.toLowerCase())")],
  ['M3 phantom melee swing guard', patched.includes('if (mob.parts && mob.parts.armR) mob.parts.armR.rotation.x = -1.2;')],
  ['M3 morning despawn preserved', patched.includes('if (currentNightFactor < 0.22 && mob.age > 20 && horizontalDistance > 8) removeSlime(mob);')],
  ['original slime squash preserved in M3', patched.includes('mob.body.scale.set(1 / squash, squash, 1 / squash);')],
  // --- M4/M5 text ---
  ['M4 kill toast names mob type', patched.includes("(mob.def ? mob.def.label : 'Slime') + ' defeated · +' + bonus")],
  ['M4 no leftover vanilla toast', !patched.includes("showToast('Slime defeated")],
  ['M5 hint names mob type', patched.includes('Attack ${currentMobTarget.def ? currentMobTarget.def.label : ')],
  ['M5 challenge renamed Mob Hunter', patched.includes("title: 'Mob Hunter', label: 'Defeat hostile mobs'")],
  ['M5 Night Defender generic', patched.includes("title: 'Night Defender', label: 'Defeat mobs at night'")],
  ['emissive reset uses baseEmissive (exactly once, crit line)', (patched.match(/mob\.baseEmissive \?\? 0x102b14/g) || []).length === 1],
  ['no hardcoded green reset left in attackMob', !patched.includes('setHex(0x102b14), crit ? 140 : 90')],
  // --- style.css sword rules ---
  ['old gradient sword CSS gone from style.css', !styleCss.includes('clip-path: polygon(')],
  ['crispEdges set', styleCss.includes('shape-rendering: crispEdges')],
  ['sword rotations removed', !styleCss.includes('rotate(53deg)')],
  // --- regressions: earlier feature patches still intact ---
  ['prior chunk/terrain patches intact', patched.includes('const WORLD_RADIUS = 72;') && patched.includes('MCTerrain.generateChunkHeights')],
];

let pass = 0;
for (const [name, ok] of checks) {
  if (ok) pass++;
  else console.log('FAIL  ' + name);
}
console.log(`verify-mobs.mjs: ${pass}/${checks.length} checks passed`);

fs.writeFileSync(outPath, patched);
const hash = crypto.createHash('sha256').update(core).digest('hex');
console.log('patched engine written to scripts/patched-engine.js');
console.log('core-source.js sha256: ' + hash + ' (compare against the pinned commit e8f770a4 if desired)');
process.exit(pass === checks.length ? 0 : 1);
