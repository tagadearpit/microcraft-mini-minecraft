/**
 * MicroCraft — self-contained engine loader (GitHub Pages safe)
 * Loads local engine chunks, injects Three.js from the page import map.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const CHUNK_COUNT = 9;

globalThis.__MICROCRAFT_THREE__ = THREE;
globalThis.__MICROCRAFT_PLC__ = PointerLockControls;

async function loadEngine() {
  const loading = document.querySelector('#loading');
  try {
    if (loading) {
      loading.classList.add('visible');
      loading.innerHTML = '<span>Loading world…</span><small>Assembling engine</small>';
    }

    const parts = [];
    for (let i = 0; i < CHUNK_COUNT; i += 1) {
      const response = await fetch(`./chunks/chunk-${i}.txt?v=stable1`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Missing engine chunk ${i} (${response.status})`);
      parts.push(await response.text());
    }

    let source = parts.join('');

    // Strip ES imports — Three is provided by this module
    source = source.replace(/import\s+\*\s+as\s+THREE\s+from\s+['"]three['"];\s*/m, '');
    source = source.replace(
      /import\s+\{\s*PointerLockControls\s*\}\s+from\s+['"]three\/addons\/controls\/PointerLockControls\.js['"];\s*/m,
      ''
    );

    const prelude =
      'const THREE = globalThis.__MICROCRAFT_THREE__;\n' +
      'const PointerLockControls = globalThis.__MICROCRAFT_PLC__;\n';

    const blob = new Blob([prelude + source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    await import(url);
  } catch (error) {
    console.error('MicroCraft failed to load:', error);
    if (loading) {
      loading.classList.add('visible');
      loading.innerHTML =
        '<span>Unable to start world</span><small>Hard-refresh (Ctrl+Shift+R). Check the browser console for details.</small>';
    }
  }
}

loadEngine();
