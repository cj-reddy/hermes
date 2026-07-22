import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('designer page exposes all primary authoring controls', async () => {
  const html = await source('index.html');
  for (const id of ['viewport', 'tool-select', 'tool-room', 'tool-wall', 'view-toggle', 'undo', 'redo', 'save', 'export', 'import-file', 'delete-selected', 'inspector']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  for (const furniture of ['sofa', 'bed', 'table', 'chair', 'cabinet', 'plant']) {
    assert.match(html, new RegExp(`data-add=["']${furniture}["']`), `missing ${furniture}`);
  }
  assert.match(html, /id=["']walls-toggle["'][^>]*checked/, 'starter scene should reveal interior furniture');
});

test('app implements keyboard shortcuts, local save, import/export, screenshot, and responsive resizing', async () => {
  const js = await source('app.js');
  for (const marker of ['localStorage', 'keydown', 'serializeProject', 'deserializeProject', 'toDataURL', 'resize', 'TransformControls', 'OrbitControls']) {
    assert.ok(js.includes(marker), `missing ${marker}`);
  }
  assert.match(js, /setView[\s\S]*requestAnimationFrame\(fitView\)/, 'view changes should refit the design');
  assert.match(js, /orbit\.enableRotate\s*=\s*viewMode\s*===\s*['"]3d['"]/, 'plan view should lock to a true top-down camera');
});

test('interface has responsive and accessible styling', async () => {
  const css = await source('styles.css');
  assert.match(css, /@media\s*\(max-width:/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--accent:/);
});
