import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('designer page exposes all primary authoring controls', async () => {
  const html = await source('index.html');
  for (const id of ['viewport', 'tool-select', 'tool-room', 'tool-wall', 'view-toggle', 'undo', 'redo', 'save', 'export', 'import-file', 'delete-selected', 'inspector', 'object-select']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  for (const furniture of ['sofa', 'bed', 'table', 'chair', 'cabinet', 'plant']) {
    assert.match(html, new RegExp(`data-add=["']${furniture}["']`), `missing ${furniture}`);
  }
  assert.match(html, /id=["']walls-toggle["'][^>]*checked/, 'starter scene should reveal interior furniture');
});

test('app implements keyboard shortcuts, local save, import/export, screenshot, and responsive resizing', async () => {
  const js = await source('app.js');
  const html = await source('index.html');
  for (const marker of ['localStorage', 'keydown', 'serializeProject', 'deserializeProject', 'toDataURL', 'resize', 'TransformControls', 'OrbitControls']) {
    assert.ok(js.includes(marker), `missing ${marker}`);
  }
  assert.match(js, /setView[\s\S]*requestAnimationFrame\(fitView\)/, 'view changes should refit the design');
  assert.match(js, /orbit\.enableRotate\s*=\s*viewMode\s*===\s*['"]3d['"]/, 'plan view should lock to a true top-down camera');
  assert.match(js, /disposeObject3D[\s\S]*geometry\.dispose/, 'scene rebuilds must dispose GPU geometry');
  assert.match(js, /pointerStart[\s\S]*Math\.hypot/, 'camera drags must not be treated as clicks');
  assert.match(js, /orbit\.minDistance[\s\S]*orbit\.maxDistance/, 'perspective button zoom must respect orbit bounds');
  assert.match(js, /if \(mod \|\| event\.altKey\) return/, 'browser-modified shortcuts must not trigger app actions');
  assert.match(js, /buildWallWithOpenings[\s\S]*kind === 'opening'/, 'doors and windows must cut wall openings');
  assert.match(js, /getBoundingSphere[\s\S]*camera\.fov/, 'perspective fit must use geometry and camera FOV');
  assert.match(js, /function saveLocal[\s\S]*try[\s\S]*localStorage\.setItem[\s\S]*catch/, 'autosave failures must be handled');
  assert.match(js, /file\.size[\s\S]*await file\.text\(\)/, 'imports must be size-limited before reading');
  assert.match(js, /activePointerId[\s\S]*lostpointercapture/, 'pointer gestures must be scoped and cancellable');
  assert.match(js, /hostWallId[\s\S]*localOffset/, 'openings must retain an explicit host-wall relationship');
  assert.match(js, /keyboardTransform[\s\S]*ArrowLeft/, 'selected objects must support keyboard movement');
  assert.match(js, /MAX_ITEMS\s*=\s*500[\s\S]*MAX_WALLS\s*=\s*200[\s\S]*MAX_OPENINGS\s*=\s*100/, 'runtime complexity caps must match imports');
  assert.match(js, /next\s*=\s*deserializeProject\(serializeProject\(next\)\)/, 'every committed mutation must pass import validation');
  assert.match(js, /source\.kind === 'wall'[\s\S]*MAX_WALLS[\s\S]*source\.kind === 'opening'[\s\S]*MAX_OPENINGS/, 'duplication must enforce subtype caps');
  assert.match(js, /if \(item\.kind === 'wall'\) rotation = \[0, rotation\[1\], 0\]/, 'walls must remain upright');
  assert.match(js, /bounded\(object\.position\.x\)/, 'transform positions must remain inside schema bounds');
  assert.match(js, /camera\.far\s*=\s*Math\.max/, 'camera clipping must adapt to scene bounds');
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /https:\/\/cdn\.jsdelivr\.net/);
});

test('interface has responsive and accessible styling', async () => {
  const css = await source('styles.css');
  const html = await source('index.html');
  assert.match(css, /@media\s*\(max-width:/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--accent:/);
  assert.doesNotMatch(css, /\.inspector\{display:none\}/, 'mobile users must retain the inspector');
  assert.doesNotMatch(css, /\.top-actions \.button:not\(\.primary\)[^{]*\{display:none\}/, 'mobile users must retain save/import/export');
  assert.match(css, /max-height:500px[\s\S]*overflow:auto/, 'short landscape layouts must remain scrollable');
  assert.match(html, /id=["']import-button["']/);
  assert.match(html, /aria-pressed=["']true["']/);
});
