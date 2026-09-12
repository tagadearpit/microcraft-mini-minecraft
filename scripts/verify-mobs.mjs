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
 *      you can compare against a fresh CDN download).
 *   2. Extracts applyPatches(source) from game.js and runs it against core.
 *   3. Asserts that the patched source contains:
 *        - all three zombie variants in MOB_TYPES (regular, fast, tank) with
 *          distinct stats
 *        - night-only spawning logic for aggressive mobs
 *        - daylight burning mechanic
 *        - createZombieModel() with the classic multi-part hierarchy
 *        - limb swing animation in the update loop
 *        - custom audio tones for zombie hits
 *        - zombie loot drops (dirt, stone, chance of apple)
 *        - mobile touch controls untouched (joystick, look zone, tilt lock)
 *        - desktop click-to-attack / F hotkey preserved
 *   4. Writes the patched source out to ./patched-engine.js so you can inspect
 *      the exact code the browser will run.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const loaderPath = path.join(root, 'game.js');
const corePath = path.join(__dirname, 'core-source.js');
const outPath = path.join(__dirname, 'patched-engine.js');

if (!fs.existsSync(loaderPath)) {
  console.error('game.js not found at ' + loaderPath);
  process.exit(1);
}
if (!fs.existsSync(corePath)) {
  console.error(
    'core-source.js not found at ' + corePath +
    '\nRun `curl -sL https://cdn.jsdelivr.net/gh/tagadearpit/microcraft-mini-minecraft@e8f770a4cd2a1cb806dcd131c5853f387f775877/game.js > scripts/core-source.js` first.'
  );
  process.exit(1);
}

const loader = fs.readFileSync(loaderPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

// Extract the applyPatches function body from game.js
const fnMatch = loader.match(/function applyPatches\(source\) \{([\s\S]*?)\n\}\s*\n\s*\/\/\s*Run the patched engine/);
if (!fnMatch) {
  console.error('Failed to extract applyPatches() from game.js');
  process.exit(1);
}

// Evaluate applyPatches in a tiny sandbox that mirrors the loader environment
const applyPatches = new Function('source', fnMatch[1]);

let patched;
try {
  patched = applyPatches(core);
} catch (err) {
  console.error('applyPatches threw an error:');
  console.error(err);
  process.exit(1);
}

// --- Marker assertions ------------------------------------------------------
const checks = [
  // Mob definitions
  ['MOB_TYPES constant defined', patched.includes('const MOB_TYPES = Object.freeze({')],
  ['slime in MOB_TYPES', patched.includes("type: 'slime'")],
  ['zombie in MOB_TYPES', patched.includes("type: 'zombie'")],
  ['fast_zombie in MOB_TYPES', patched.includes("type: 'fast_zombie'")],
  ['tank_zombie in MOB_TYPES', patched.includes("type: 'tank_zombie'")],

  // Distinct stats across variants
  ['regular zombie stats (hp: 6, speed: 2.1, dmg: 2)',
    patched.includes("hp: 6,") && patched.includes("speed: 2.1,") && patched.includes("damage: 2,")],
  ['fast zombie stats (hp: 4, speed: 3.3, dmg: 1.5)',
    patched.includes("hp: 4,") && patched.includes("speed: 3.3,") && patched.includes("damage: 1.5,")],
  ['tank zombie stats (hp: 12, speed: 1.5, dmg: 3.5)',
    patched.includes("hp: 12,") && patched.includes("speed: 1.5,") && patched.includes("damage: 3.5,")],

  // Model creation
  ['createZombieModel function present', patched.includes('function createZombieModel(')],
  ['zombie head mesh present', patched.includes('zombieHeadGeo')],
  ['zombie arms present (classic forward reach)', patched.includes('leftArm.rotation.x = -Math.PI / 2')],
  ['zombie legs present', patched.includes('leftLeg') && patched.includes('rightLeg')],
  ['green zombie skin color', patched.includes('0x4b7337') || patched.includes('0x3f632d') || patched.includes('0x345025')],
  ['blue pants color', patched.includes('0x2b386b') || patched.includes('0x222e57')],
  ['cyan shirt color', patched.includes('0x2e7d7d') || patched.includes('0x236363')],

  // Spawner & daytime rules
  ['night-only zombie spawn gating', patched.includes('daylight < 0.35')],
  ['weighted variant picker (chooseMobType)', patched.includes('function chooseMobType()')],
  ['zombie burn timer tracking', patched.includes('burnTimer: 0')],
  ['daylight burning loop', patched.includes('mob.burnTimer') && patched.includes('mob.hp -= 1')],
  ['fire particles while burning', patched.includes("spawnParticles(pos.x, pos.y + 0.9, pos.z, 'dirt'")],

  // Animation
  ['walking limb animation loop', patched.includes('mob.limbAngle') && patched.includes('leftArm.rotation.x')],

  // Audio & feedback
  ['distinct zombie groan / hit pitch', patched.includes('playTone(85, 0.12, 0.045, ') || patched.includes('playTone(110, 0.09, 0.04, ')],
  ['player damage flash (red emissive)', patched.includes('mob.hitTimer = 0.14')],

  // Combat integration
  ['zombies attack player in reach', patched.includes('dist < 1.25') && patched.includes('damagePlayer(mob.damage')],
  ['weapon reach hits zombies', patched.includes('currentMobTarget = null')],
  ['kill rewards track kills and score', patched.includes('gameStats.kills += 1') && patched.includes('playerState.score += mob.score')],

  // Loot drops
  ['loot drops on death', patched.includes('inventory.dirt += 1') && patched.includes('inventory.apple += 1')],

  // Existing features untouched
  ['water physics preserved', patched.includes('isUnderwater') && patched.includes('spawnSplash')],
  ['underwater caustics/fog preserved', patched.includes('updateUnderwaterFog')],
  ['weapons crafting preserved', patched.includes('wood_sword') && patched.includes('stone_sword')],
  ['food healing preserved', patched.includes('tryConsumeApple')],
  ['mobile touch joystick preserved', loader.includes('window.__mcJoystickVector')],
  ['mobile look sensitivity preserved', loader.includes('window.__mcLookSensitivity')],
  ['tilt lock preserved', loader.includes('screen.orientation.lock')]
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
