/**
 * MicroCraft — terrain worker (classic Web Worker, no imports, no build step).
 *
 * ALL terrain math comes from the shared module ./world-terrain.js
 * (importScripts below) — the exact same bytes the main thread uses, so the
 * seed produces identical terrain on every thread. No logic is duplicated
 * in this file.
 *
 * Receives:  { type: 'generate', key, cx, cz, chunk, worldHeight, radius, seaLevel, seed, mods }
 *   - mods: flat array [x, y, z, idOrEmptyString, ...] of player edits inside
 *     this chunk's column span (0/empty = block removed by player).
 * Posts back: { type: 'chunk', key, cx, cz, heights } with `heights` transferred.
 */
'use strict';

importScripts('./world-terrain.js');

self.onmessage = (event) => {
  const d = event.data;
  if (!d || d.type !== 'generate') return;
  const size = d.chunk + 8;
  const heights = new Float32Array(size * size * (d.worldHeight + 1));
  const mods = {};
  if (d.mods) {
    for (let i = 0; i + 3 < d.mods.length; i += 4) {
      mods[d.mods[i] + ',' + d.mods[i + 1] + ',' + d.mods[i + 2]] = d.mods[i + 3] || 0;
    }
  }
  MCTerrain.generateChunkHeights(heights, d.cx, d.cz, {
    chunk: d.chunk,
    worldHeight: d.worldHeight,
    radius: d.radius,
    seaLevel: d.seaLevel,
    seed: d.seed,
    mods
  });
  self.postMessage({ type: 'chunk', key: d.key, cx: d.cx, cz: d.cz, heights }, [heights.buffer]);
};
