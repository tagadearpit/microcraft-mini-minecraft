/**
 * MicroCraft — shared terrain module (SINGLE SOURCE OF TRUTH).
 *
 * Classic script (no imports/exports, no build step): assigns
 * `globalThis.MCTerrain`. Loaded by:
 *   - game.js boot(): fetched as text and prepended to the patched engine
 *     blob, so the engine and its fallback path use it on the main thread.
 *   - world-worker.js: via importScripts('./world-terrain.js').
 * Both threads therefore run literally the same bytes — same seed produces
 * the same world everywhere.
 *
 * Terrain model (all coordinates are block columns, y is height):
 *   1. baseLandHeight  = low-frequency fBm "base elevation" (period ~48
 *      blocks) + reduced legacy broad sines + small per-column roughness.
 *      Neighbouring columns share the base layer, so hills/valleys span
 *      many blocks instead of spiking per column.
 *   2. rivers          = two domain-warped noise bands; |field - center|
 *      below RIVER_HALF_WIDTH carves a bed below SEA_LEVEL, with a narrow
 *      sand/dirt bank strip on each side. Deterministic from the seed and
 *      suppressed near spawn.
 *   3. biome banding   = surface block chosen from the same low-frequency
 *      height: sea floor sand, grass midlands, stone outcrops tapering
 *      into rocky peaks.
 *   4. forestDensity   = a second independent low-frequency fBm field;
 *      trees roll a high per-column chance inside groves and a rare chance
 *      outside (lone trees), never on rivers/banks/peaks.
 */
(function () {
  'use strict';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // --- Base hashes -----------------------------------------------------------
  function seededRandom2D(x, z, seed) {
    const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.017) * 43758.5453123;
    return value - Math.floor(value);
  }

  // Smooth value noise: bilinear interpolation of the hash over an integer
  // lattice, so adjacent columns correlate instead of jumping randomly.
  function valueNoise2D(x, z, seed) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = seededRandom2D(ix, iz, seed);
    const b = seededRandom2D(ix + 1, iz, seed);
    const c = seededRandom2D(ix, iz + 1, seed);
    const d = seededRandom2D(ix + 1, iz + 1, seed);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }

  // Two-octave fBm, output roughly [0, 1].
  function fbm2(x, z, seed) {
    return valueNoise2D(x, z, seed) * 0.65
      + valueNoise2D(x * 2.1 + 13.7, z * 2.1 - 7.3, seed + 91) * 0.35;
  }

  // --- Rivers ----------------------------------------------------------------
  // Two independent winding bands defined by domain-warped fBm. A column is
  // river where the warped field sits within RIVER_HALF_WIDTH of the band
  // centreline; a slightly wider halo forms the banks.
  const RIVER_HALF_WIDTH = 0.016;
  const RIVER_BANK_WIDTH = 0.034;

  function riverField(x, z, seed) {
    const wx = fbm2(x * 0.011 + 31.7, z * 0.011 - 17.9, seed + 500) - 0.5;
    const wz = fbm2(x * 0.011 - 45.2, z * 0.011 + 8.4, seed + 900) - 0.5;
    const v1 = fbm2((x + wx * 30) * 0.016 + 3.1, (z + wz * 30) * 0.016 + 71.7, seed + 1300);
    const v2 = fbm2((x - wz * 26) * 0.013 - 53.9, (z + wx * 26) * 0.013 + 11.3, seed + 2100);
    const d1 = Math.abs(v1 - 0.52);
    const d2 = Math.abs(v2 - 0.48);
    let d = Math.min(d1, d2);
    // Keep spawn (0,0) river-free so the player never spawns in water.
    const sd = Math.sqrt(x * x + z * z);
    if (sd < 12) d += (12 - sd) * 0.012;
    return d;
  }

  // Returns null away from rivers, else { d, river, bank } where d is the
  // field distance (0 = river centreline).
  function riverInfo(x, z, seed) {
    const d = riverField(x, z, seed);
    if (d >= RIVER_BANK_WIDTH) return null;
    return { d, river: d <= RIVER_HALF_WIDTH, bank: d > RIVER_HALF_WIDTH };
  }

  // --- Height ----------------------------------------------------------------
  // Low-frequency base elevation shared by neighbouring columns, with the
  // legacy broad sines and per-column noise layered on top as detail only.
  function baseLandHeight(x, z, seed) {
    const base = (fbm2(x * 0.021, z * 0.021, seed) - 0.5) * 7.2;       // ±3.6 rolling hills/valleys
    const broad = (Math.sin((x + seed * 0.001) * 0.18) * 1.45
      + Math.cos((z - seed * 0.001) * 0.16) * 1.3) * 0.5;              // ±1.4 legacy character
    const detail = (seededRandom2D(x, z, seed) - 0.5) * 1.1;           // ±0.55 roughness
    const ridge = Math.sin((x + z) * 0.08) * 0.4;
    return 6.1 + base + broad + detail + ridge;
  }

  // Final integer column height including river carving.
  function terrainHeight(x, z, seed) {
    let h = baseLandHeight(x, z, seed);
    const rv = riverInfo(x, z, seed);
    // Rivers only carve land: where the base terrain is already submerged
    // (sea/lake bed), the river is masked so open water stays unmarked.
    if (rv && h > seaLevelRef + 1) {
      if (rv.river) {
        const k = rv.d / RIVER_HALF_WIDTH;          // 0 centre → 1 edge
        const target = (seaLevelRef - 1) + k * k * 2.0; // bed below sea, sloping up at edges
        h = Math.min(h, target);
      } else {
        const k = (rv.d - RIVER_HALF_WIDTH) / (RIVER_BANK_WIDTH - RIVER_HALF_WIDTH); // 0→1 across bank
        const target = seaLevelRef + 0.6 + k * 2.2; // banks sit just above the waterline
        h = Math.min(h, target);
      }
    }
    return clamp(Math.floor(h), 2, 14);
  }

  // terrainHeight needs SEA_LEVEL but must stay seed/world-config agnostic;
  // it is bound per generateChunkHeights call and via terrainHeight's wrapper.
  let seaLevelRef = 4;

  // --- Biomes / surface ------------------------------------------------------
  // Returns { top, sub, subDepth } block ids for a column.
  function surfaceFor(h, rv, x, z, seed, seaLevel) {
    if (rv && rv.river) {
      // Mixed sand/dirt riverbed.
      return { top: seededRandom2D(x * 5 + 3, z * 7 - 2, seed) > 0.45 ? 4 : 2, sub: 4, subDepth: 2 };
    }
    if (rv && rv.bank) return { top: 4, sub: 2, subDepth: 2 };          // sand bank over dirt
    if (h <= seaLevel) return { top: 4, sub: 4, subDepth: 2 };          // sea/lake floor sand
    if (h >= 10) return { top: 3, sub: 3, subDepth: 3 };                // rocky peaks
    if (h >= 8 && fbm2(x * 0.05, z * 0.05, seed + 77) > 0.54) {
      return { top: 3, sub: 3, subDepth: 2 };                           // stone outcrops tapering down
    }
    return { top: 1, sub: 2, subDepth: 2 };                             // grass over dirt
  }

  // --- Forests ---------------------------------------------------------------
  const GROVE_MIN = 0.56;        // forest-density threshold for groves
  const GROVE_CHANCE = 0.955;    // per-column tree roll inside a grove (~4.5%)
  const LONE_CHANCE = 0.995;     // per-column tree roll outside groves (~0.5%)

  function forestDensity(x, z, seed) {
    return fbm2(x * 0.018 + 137.5, z * 0.018 - 91.2, seed + 3100);
  }

  const TYPE_IDS = { grass: 1, dirt: 2, stone: 3, sand: 4, wood: 5, leaves: 6, planks: 7, crystal: 8, bedrock: 9, brick: 10, torch: 11 };
  const IDS_TYPE = [null, 'grass', 'dirt', 'stone', 'sand', 'wood', 'leaves', 'planks', 'crystal', 'bedrock', 'brick', 'torch'];

  // --- Chunk generation ------------------------------------------------------
  // Fills `heights` ((chunk+8)^2 x (worldHeight+1) Float32Array) for chunk
  // (cx, cz). The 4-block margin on each side covers 2-wide tree canopies
  // (a trunk may sit up to 2 past this chunk) and provides neighbours for
  // border face culling. Player edits for this chunk's own columns are baked
  // in last. opts = { chunk, worldHeight, radius, seaLevel, seed, mods }
  // where mods maps "x,y,z" -> block id (0 = removed by player).
  function generateChunkHeights(heights, cx, cz, opts) {
    const chunk = opts.chunk;
    const worldHeight = opts.worldHeight;
    const radius = opts.radius;
    const seaLevel = opts.seaLevel;
    const seed = opts.seed;
    const mods = opts.mods || {};
    seaLevelRef = seaLevel;

    const size = chunk + 8;
    const x0 = cx * chunk;
    const z0 = cz * chunk;
    heights.fill(0);

    function cget(lx, y, lz) {
      if (lx < 0 || lz < 0 || lx >= size || lz >= size || y < 0 || y > worldHeight) return 0;
      return heights[(lz * size + lx) * (worldHeight + 1) + y];
    }
    function cset(lx, y, lz, t) {
      if (lx < 0 || lz < 0 || lx >= size || lz >= size || y < 0 || y > worldHeight) return;
      heights[(lz * size + lx) * (worldHeight + 1) + y] = t;
    }

    // Terrain pass
    for (let lx = 0; lx < size; lx += 1) {
      for (let lz = 0; lz < size; lz += 1) {
        const x = x0 + lx - 4;
        const z = z0 + lz - 4;
        if (Math.abs(x) > radius || Math.abs(z) > radius) continue;
        const rv = riverInfo(x, z, seed);
        const h = terrainHeight(x, z, seed);
        const surf = surfaceFor(h, rv, x, z, seed, seaLevel);
        for (let y = 0; y <= h; y += 1) {
          let t = 3; // stone
          if (y === 0) t = 9; // bedrock
          else if (y === h) t = surf.top;
          else if (y >= h - surf.subDepth) t = surf.sub;
          else if (y > 1 && seededRandom2D(x * 9 + y * 13, z * 11 - y * 5, seed) > 0.982) t = 8; // crystal
          cset(lx, y, lz, t);
        }
      }
    }

    // Tree pass: trunks only in the world interior band (|x| <= radius - 2),
    // but up to 3 past this chunk so 2-wide canopies land inside the margin.
    // Trees need grass under the trunk (no peaks/sand/riverbeds), avoid
    // rivers/banks explicitly, and cluster via the forest-density field.
    const overlay = new Set();
    for (let lx = 1; lx < size - 1; lx += 1) {
      for (let lz = 1; lz < size - 1; lz += 1) {
        const x = x0 + lx - 4;
        const z = z0 + lz - 4;
        if (Math.abs(x) > radius - 2 || Math.abs(z) > radius - 2) continue;
        const h = terrainHeight(x, z, seed);
        if (h <= seaLevel) continue;
        if (Math.abs(x) < 3 && Math.abs(z) < 3) continue; // spawn clearing
        const rv = riverInfo(x, z, seed);
        if (rv && rv.d <= RIVER_BANK_WIDTH + 0.01) continue; // no trees on rivers or banks
        const density = forestDensity(x, z, seed);
        const threshold = density > GROVE_MIN ? GROVE_CHANCE : LONE_CHANCE;
        const treeChance = seededRandom2D(x * 3 + 17, z * 5 - 11, seed);
        if (treeChance <= threshold) continue;
        if (cget(lx, h, lz) !== 1) continue; // grass only
        const trunk = seededRandom2D(x * 7 - 3, z * 11 + 5, seed) > 0.82 ? 4 : 3;
        for (let y = 1; y <= trunk; y += 1) { cset(lx, h + y, lz, 5); overlay.add(lx + ',' + (h + y) + ',' + lz); }
        const crownY = h + trunk;
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dz = -2; dz <= 2; dz += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
              if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 4) continue;
              const bx = lx + dx;
              const by = crownY + dy;
              const bz = lz + dz;
              if (!cget(bx, by, bz) && !overlay.has(bx + ',' + by + ',' + bz)) { cset(bx, by, bz, 6); overlay.add(bx + ',' + by + ',' + bz); }
            }
          }
        }
        if (!cget(lx, crownY + 2, lz) && !overlay.has(lx + ',' + (crownY + 2) + ',' + lz)) cset(lx, crownY + 2, lz, 6);
      }
    }

    // Player modifications for this chunk's own columns (margins excluded)
    for (const key in mods) {
      const p = key.split(',');
      const lx = Number(p[0]) - x0 + 4;
      const y = Number(p[1]);
      const lz = Number(p[2]) - z0 + 4;
      if (lx < 4 || lz < 4 || lx >= size - 4 || lz >= size - 4) continue;
      cset(lx, y, lz, mods[key] || 0);
    }
  }

  globalThis.MCTerrain = {
    clamp,
    seededRandom2D,
    valueNoise2D,
    fbm2,
    riverField,
    riverInfo,
    baseLandHeight,
    terrainHeight: function (x, z, seed, seaLevel) {
      if (typeof seaLevel === 'number') seaLevelRef = seaLevel;
      return terrainHeight(x, z, seed);
    },
    surfaceFor,
    forestDensity,
    generateChunkHeights,
    TYPE_IDS,
    IDS_TYPE,
    RIVER_HALF_WIDTH,
    RIVER_BANK_WIDTH,
    GROVE_MIN
  };
})();
