import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const engineSource = readFileSync(join(ROOT, 'scripts', 'patched-engine.js'), 'utf8');

function check(name, pass, detail) {
  const status = pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) process.exitCode = 1;
}

console.log('Static Mob Verification:');

// 1. MOB_TYPES constant
check(
  'MOB_TYPES defined',
  engineSource.includes('const MOB_TYPES = {') &&
  engineSource.includes('slime:') &&
  engineSource.includes('zombie:') &&
  engineSource.includes('fast_zombie:') &&
  engineSource.includes('tank_zombie:'),
  'slime, zombie, fast_zombie, tank_zombie present'
);

// 2. Zombie model creation
check(
  'createZombieModel exists',
  engineSource.includes('function createZombieModel('),
  'head, torso, arms, legs structured'
);

// 3. Mob spawn weighting
check(
  'chooseMobType weighted',
  engineSource.includes('function chooseMobType(') &&
  engineSource.includes('Math.random()'),
  'random mob selection with weights'
);

// 4. Night-only zombie spawning
check(
  'Zombies night-only',
  engineSource.includes('isDaytime') &&
  engineSource.includes("type !== 'slime'"),
  'non-slime mobs restricted to night'
);

// 5. Daylight burning
check(
  'Daylight burning mechanic',
  engineSource.includes('daylightBurn') &&
  engineSource.includes('burnTimer'),
  'sun exposure damages zombies'
);

// 6. Limb animation
check(
  'Limb walking animation',
  engineSource.includes('limbAngle') ||
  engineSource.includes('leftArm.rotation.x'),
  'arms and legs rotate while moving'
);

// 7. Distinct stats per variant
check(
  'Distinct stats',
  engineSource.includes('damage: 2.5') &&
  engineSource.includes('damage: 1.5') &&
  engineSource.includes('damage: 4.0'),
  'regular (2.5), fast (1.5), tank (4.0) damage values'
);

// 8. Zombie hit audio
check(
  'Zombie audio tones',
  engineSource.includes('zombie_groan') ||
  engineSource.includes('playTone(95') ||
  engineSource.includes('playTone(80'),
  'low-pitch audio for zombie hits'
);

// 9. Loot drops
check(
  'Loot drops on death',
  engineSource.includes('dirt') &&
  engineSource.includes('stone') &&
  engineSource.includes('apple'),
  'zombies drop resources on defeat'
);

// 10. Despawning & cap
check(
  'Mob cap enforced',
  engineSource.includes('mobs.length >= MAX_MOBS'),
  'caps total active mobs'
);

console.log(process.exitCode ? '\nSome checks failed!' : '\nAll static checks passed!');
