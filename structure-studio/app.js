import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  createProject, addRoom, addObject, updateObject, removeObject, duplicateObject,
  serializeProject, deserializeProject, createHistory,
} from './model.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const STORAGE_KEY = 'structure-studio-project-v1';
const COLORS = { wall: '#d8d5ce', floor: '#8b6d54', accent: '#7170ff' };
const snap = (n) => $('snap-toggle').checked ? Math.round(n * 4) / 4 : n;
const labelFor = (item) => item.name || item.subtype?.replace(/^./, (c) => c.toUpperCase()) || item.kind;

let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1800);
}

function starterProject() {
  let p = addRoom(createProject('Modern loft'), { x: -4, z: -3 }, { x: 4, z: 3 }, { floorColor: '#8b6d54' });
  p = addObject(p, { kind: 'furniture', subtype: 'sofa', position: [-1.9, 0, 1.35], rotation: [0, 0, 0], size: [2.4, .9, 1], color: '#a88167' });
  p = addObject(p, { kind: 'furniture', subtype: 'table', position: [.25, 0, .8], rotation: [0, 0, 0], size: [1.35, .72, .8], color: '#6f4f39' });
  p = addObject(p, { kind: 'furniture', subtype: 'plant', position: [3.25, 0, 2.2], rotation: [0, 0, 0], size: [.7, 1.35, .7], color: '#47745b' });
  return p;
}

let project;
try { project = deserializeProject(localStorage.getItem(STORAGE_KEY)); }
catch { project = starterProject(); }
const history = createHistory(project);
let selectedId = null;
let activeTool = 'select';
let transformMode = 'translate';
let wallTransparency = true;
let viewMode = '3d';
let drawing = null;
let pointerMoved = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111316);
scene.fog = new THREE.Fog(0x111316, 28, 65);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.appendChild(renderer.domElement);

const perspective = new THREE.PerspectiveCamera(44, 1, .1, 100);
perspective.position.set(9.5, 8, 10.5);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
ortho.position.set(0, 24, 0);
ortho.up.set(0, 0, -1);
ortho.lookAt(0, 0, 0);
let camera = perspective;
let orbit;

function createOrbit() {
  orbit?.dispose();
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = .08;
  orbit.screenSpacePanning = true;
  orbit.minDistance = 3;
  orbit.maxDistance = 42;
  orbit.enableRotate = viewMode === '3d';
  orbit.maxPolarAngle = Math.PI / 2.02;
  orbit.target.set(0, 0, 0);
}
createOrbit();

scene.add(new THREE.HemisphereLight(0xdde8ff, 0x3f342c, 2.25));
const sun = new THREE.DirectionalLight(0xfff4df, 2.8);
sun.position.set(8, 14, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
sun.shadow.camera.right = sun.shadow.camera.top = 15;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8999ff, .7);
fill.position.set(-8, 7, -10);
scene.add(fill);

const grid = new THREE.GridHelper(20, 40, 0x4b4d57, 0x282a30);
grid.position.y = -.015;
scene.add(grid);
const groundVisual = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: .95, metalness: 0 }),
);
groundVisual.rotation.x = -Math.PI / 2;
groundVisual.position.y = -.025;
groundVisual.receiveShadow = true;
scene.add(groundVisual);
const sceneGroup = new THREE.Group();
scene.add(sceneGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const transform = new TransformControls(camera, renderer.domElement);
transform.setMode(transformMode);
transform.setTranslationSnap(.25);
transform.setRotationSnap(THREE.MathUtils.degToRad(15));
const transformHelper = transform.getHelper();
scene.add(transformHelper);
transform.addEventListener('dragging-changed', ({ value }) => { orbit.enabled = !value; });
transform.addEventListener('mouseDown', () => { pointerMoved = true; });
transform.addEventListener('mouseUp', commitTransform);

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: options.roughness ?? .72, metalness: options.metalness ?? .02,
    transparent: options.transparent ?? false, opacity: options.opacity ?? 1,
  });
}
function box(parent, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options));
  mesh.position.set(...position);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cylinder(parent, radiusTop, radiusBottom, height, position, color, radial = 18) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial), material(color));
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildFurniture(item) {
  const g = new THREE.Group();
  const c = item.color;
  const dark = new THREE.Color(c).multiplyScalar(.68).getStyle();
  const light = new THREE.Color(c).lerp(new THREE.Color('#ffffff'), .18).getStyle();
  switch (item.subtype) {
    case 'sofa':
      box(g, [.88, .28, .78], [0, .27, 0], c);
      box(g, [.88, .46, .18], [0, .51, .3], dark);
      box(g, [.12, .38, .75], [-.45, .37, 0], dark); box(g, [.12, .38, .75], [.45, .37, 0], dark);
      box(g, [.4, .09, .61], [-.21, .45, -.04], light); box(g, [.4, .09, .61], [.21, .45, -.04], light);
      break;
    case 'bed':
      box(g, [1, .18, 1], [0, .18, 0], dark);
      box(g, [.94, .25, .88], [0, .38, -.02], light);
      box(g, [.98, .72, .1], [0, .39, .45], c);
      box(g, [.38, .12, .23], [-.22, .57, .27], '#e6e1d9'); box(g, [.38, .12, .23], [.22, .57, .27], '#e6e1d9');
      break;
    case 'table':
      box(g, [1, .12, 1], [0, .82, 0], c);
      for (const x of [-.4, .4]) for (const z of [-.4, .4]) box(g, [.08, .76, .08], [x, .4, z], dark);
      break;
    case 'chair':
      box(g, [.78, .12, .78], [0, .48, 0], c);
      box(g, [.78, .55, .1], [0, .78, .34], c);
      for (const x of [-.3, .3]) for (const z of [-.3, .3]) box(g, [.08, .48, .08], [x, .24, z], dark);
      break;
    case 'cabinet':
      box(g, [1, 1, .75], [0, .5, 0], c);
      box(g, [.02, .86, .68], [-.01, .52, -.39], light);
      box(g, [.02, .86, .68], [.01, .52, -.4], light);
      cylinder(g, .025, .025, .08, [-.08, .53, -.43], '#c6a86e', 10).rotation.z = Math.PI / 2;
      cylinder(g, .025, .025, .08, [.08, .53, -.43], '#c6a86e', 10).rotation.z = Math.PI / 2;
      break;
    case 'plant':
      cylinder(g, .34, .25, .38, [0, .19, 0], '#8d6250');
      cylinder(g, .035, .045, .7, [0, .66, 0], '#446c50', 9);
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 8), material(i % 2 ? c : light));
        const a = i * Math.PI * 2 / 7;
        leaf.scale.set(.48, .9, .22); leaf.position.set(Math.cos(a) * .17, .78 + (i % 3) * .08, Math.sin(a) * .17); leaf.rotation.y = -a;
        leaf.castShadow = true; g.add(leaf);
      }
      break;
    default: box(g, [1, 1, 1], [0, .5, 0], c);
  }
  return g;
}

function buildArchitectural(item) {
  const g = new THREE.Group();
  if (item.subtype === 'door') {
    box(g, [.94, .96, .1], [0, .48, 0], item.color);
    cylinder(g, .025, .025, .09, [.34, .5, -.08], '#d5bd7e', 12).rotation.x = Math.PI / 2;
  } else if (item.subtype === 'window') {
    const frame = item.color;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(.84, .76, .05), material('#9bc1d7', { transparent: true, opacity: .32, roughness: .15 }));
    glass.position.y = .5; g.add(glass);
    box(g, [1, .08, .11], [0, .08, 0], frame); box(g, [1, .08, .11], [0, .92, 0], frame);
    box(g, [.08, .92, .11], [-.46, .5, 0], frame); box(g, [.08, .92, .11], [.46, .5, 0], frame);
    box(g, [.05, .84, .08], [0, .5, 0], frame);
  }
  return g;
}

function createSceneObject(item) {
  let root;
  if (item.kind === 'wall' || item.kind === 'floor') {
    const opacity = item.kind === 'wall' && wallTransparency ? .36 : 1;
    root = new THREE.Mesh(new THREE.BoxGeometry(...item.size), material(item.color, { transparent: opacity < 1, opacity }));
    root.castShadow = item.kind === 'wall'; root.receiveShadow = true;
    root.position.set(...item.position); root.rotation.set(...item.rotation);
  } else {
    root = item.kind === 'furniture' ? buildFurniture(item) : buildArchitectural(item);
    root.position.set(...item.position); root.rotation.set(...item.rotation); root.scale.set(...item.size);
  }
  root.userData.itemId = item.id;
  root.traverse((child) => { child.userData.itemId = item.id; });
  return root;
}

function renderProject() {
  transform.detach();
  while (sceneGroup.children.length) sceneGroup.remove(sceneGroup.children[0]);
  for (const item of project.items) sceneGroup.add(createSceneObject(item));
  if (selectedId) {
    const selected = sceneGroup.children.find((obj) => obj.userData.itemId === selectedId);
    if (selected) transform.attach(selected); else selectedId = null;
  }
  $('project-name').value = project.name;
  $('object-count').textContent = `${project.items.length} object${project.items.length === 1 ? '' : 's'}`;
  $('undo').disabled = !history.canUndo(); $('redo').disabled = !history.canRedo();
  updateInspector();
}

function saveLocal(silent = true) {
  localStorage.setItem(STORAGE_KEY, serializeProject(project));
  if (!silent) toast('Design saved locally');
}
function commit(next, keepSelection = selectedId) {
  project = history.commit(next);
  selectedId = keepSelection;
  saveLocal(true);
  renderProject();
}

function selectItem(id) {
  selectedId = id;
  renderProject();
  if (id) $('status').textContent = `Selected ${labelFor(project.items.find((i) => i.id === id))}`;
}

function updateInspector() {
  const item = project.items.find((i) => i.id === selectedId);
  $('empty-inspector').classList.toggle('hidden', !!item);
  $('object-fields').classList.toggle('hidden', !item);
  $('selection-type').textContent = item ? `${item.kind} · ${item.subtype}` : 'Nothing selected';
  if (!item) return;
  $('object-name').value = labelFor(item);
  $('pos-x').value = item.position[0].toFixed(2); $('pos-z').value = item.position[2].toFixed(2);
  $('size-x').value = item.size[0].toFixed(2); $('size-y').value = item.size[1].toFixed(2); $('size-z').value = item.size[2].toFixed(2);
  $('object-color').value = new THREE.Color(item.color).getHexString().padStart(6, '0').replace(/^/, '#');
  $('color-value').value = $('object-color').value;
}

function commitTransform() {
  const object = transform.object;
  if (!object || !selectedId) return;
  const item = project.items.find((i) => i.id === selectedId);
  if (!item) return;
  const position = [snap(object.position.x), snap(object.position.y), snap(object.position.z)];
  const rotation = [object.rotation.x, object.rotation.y, object.rotation.z];
  commit(updateObject(project, selectedId, { position, rotation }), selectedId);
  $('status').textContent = `Updated ${labelFor(item)}`;
}

function screenPoint(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}
function groundPoint(event) {
  screenPoint(event); raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, point) ? { x: snap(point.x), z: snap(point.z) } : null;
}
function pick(event) {
  screenPoint(event); raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(sceneGroup.children, true);
  return hits[0]?.object.userData.itemId || null;
}

const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(COLORS.accent, { transparent: true, opacity: .25 }));
preview.visible = false; scene.add(preview);
function updatePreview(start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  if (activeTool === 'room') {
    preview.scale.set(Math.max(.1, Math.abs(dx)), .05, Math.max(.1, Math.abs(dz)));
    preview.position.set((start.x + end.x) / 2, .025, (start.z + end.z) / 2); preview.rotation.y = 0;
  } else {
    const length = Math.hypot(dx, dz);
    preview.scale.set(Math.max(.1, length), 2.8, .16);
    preview.position.set((start.x + end.x) / 2, 1.4, (start.z + end.z) / 2); preview.rotation.y = -Math.atan2(dz, dx);
  }
  preview.visible = true;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerMoved = false;
  if (event.button !== 0 || activeTool === 'select') return;
  const point = groundPoint(event); if (!point) return;
  drawing = { start: point, current: point };
  orbit.enabled = false; renderer.domElement.setPointerCapture(event.pointerId);
  updatePreview(point, point);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!drawing) return;
  const point = groundPoint(event); if (!point) return;
  drawing.current = point; pointerMoved = true; updatePreview(drawing.start, point);
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (drawing) {
    const { start, current } = drawing; drawing = null; preview.visible = false; orbit.enabled = true;
    const dx = current.x - start.x, dz = current.z - start.z;
    if (Math.hypot(dx, dz) > .5) {
      if (activeTool === 'room') {
        const next = addRoom(project, start, current); commit(next, next.items.at(-1).id); toast('Room added');
      } else {
        const length = Math.hypot(dx, dz); const next = addObject(project, {
          kind: 'wall', subtype: 'wall', position: [(start.x + current.x) / 2, 1.4, (start.z + current.z) / 2],
          rotation: [0, -Math.atan2(dz, dx), 0], size: [length, 2.8, .16], color: COLORS.wall,
        }); commit(next, next.items.at(-1).id); toast('Wall added');
      }
    }
    return;
  }
  if (activeTool === 'select' && !pointerMoved && !transform.dragging) selectItem(pick(event));
});

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  $('draw-hint').classList.toggle('hidden', tool === 'select');
  $('status').textContent = tool === 'select' ? 'Select and edit objects' : `Draw ${tool}: click and drag on the grid`;
  renderer.domElement.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  if (tool !== 'select') transform.detach(); else renderProject();
}
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));

const DEFAULTS = {
  sofa: { kind: 'furniture', size: [2.4, .9, 1], color: '#a88167' }, bed: { kind: 'furniture', size: [2, .7, 2.2], color: '#8097b0' },
  table: { kind: 'furniture', size: [1.6, .75, 1], color: '#76543d' }, chair: { kind: 'furniture', size: [.65, 1, .65], color: '#aa815f' },
  cabinet: { kind: 'furniture', size: [1.25, 1.7, .5], color: '#6e604f' }, plant: { kind: 'furniture', size: [.7, 1.35, .7], color: '#47745b' },
  door: { kind: 'opening', size: [.9, 2.1, .14], color: '#8c684e' }, window: { kind: 'opening', size: [1.4, 1.25, .14], color: '#d7d9de' },
};
document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => {
  const subtype = button.dataset.add, spec = DEFAULTS[subtype];
  const center = orbit.target;
  const next = addObject(project, { ...spec, subtype, position: [snap(center.x), 0, snap(center.z)], rotation: [0, 0, 0] });
  setTool('select'); commit(next, next.items.at(-1).id); toast(`${subtype[0].toUpperCase() + subtype.slice(1)} added`);
}));

$('move-mode').addEventListener('click', () => setTransformMode('translate'));
$('rotate-mode').addEventListener('click', () => setTransformMode('rotate'));
function setTransformMode(mode) {
  transformMode = mode; transform.setMode(mode);
  $('move-mode').classList.toggle('active', mode === 'translate'); $('rotate-mode').classList.toggle('active', mode === 'rotate');
}

function updateSelected(patch) {
  if (!selectedId) return;
  commit(updateObject(project, selectedId, patch), selectedId);
}
$('object-name').addEventListener('change', (e) => updateSelected({ name: e.target.value.trim() || undefined }));
[['pos-x', 0], ['pos-z', 2]].forEach(([id, axis]) => $(id).addEventListener('change', (e) => {
  const item = project.items.find((i) => i.id === selectedId); if (!item) return;
  const position = [...item.position]; position[axis] = snap(Number(e.target.value)); updateSelected({ position });
}));
[['size-x', 0], ['size-y', 1], ['size-z', 2]].forEach(([id, axis]) => $(id).addEventListener('change', (e) => {
  const item = project.items.find((i) => i.id === selectedId); if (!item) return;
  const size = [...item.size]; size[axis] = Math.max(.1, Number(e.target.value)); updateSelected({ size });
}));
$('object-color').addEventListener('input', (e) => { $('color-value').value = e.target.value; });
$('object-color').addEventListener('change', (e) => updateSelected({ color: e.target.value }));

function deleteSelected() {
  if (!selectedId) return; const old = selectedId; selectedId = null; commit(removeObject(project, old), null); toast('Object deleted');
}
function duplicateSelected() {
  if (!selectedId) return; const next = duplicateObject(project, selectedId); commit(next, next.items.at(-1).id); toast('Object duplicated');
}
$('delete-selected').addEventListener('click', deleteSelected); $('duplicate-selected').addEventListener('click', duplicateSelected);
$('undo').addEventListener('click', () => { project = history.undo(); selectedId = null; saveLocal(); renderProject(); });
$('redo').addEventListener('click', () => { project = history.redo(); selectedId = null; saveLocal(); renderProject(); });
$('save').addEventListener('click', () => saveLocal(false));
$('project-name').addEventListener('change', (e) => { const next = structuredClone(project); next.name = e.target.value.trim() || 'Untitled design'; commit(next); });

$('export').addEventListener('click', () => {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'design'}.json`; a.click(); URL.revokeObjectURL(url); toast('Project exported');
});
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { project = deserializeProject(await file.text()); history.reset(project); selectedId = null; saveLocal(); renderProject(); fitView(); toast('Project imported'); }
  catch { toast('That project file is not valid'); }
  e.target.value = '';
});
$('screenshot').addEventListener('click', () => {
  renderer.render(scene, camera); const a = document.createElement('a'); a.href = renderer.domElement.toDataURL('image/png'); a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'design'}.png`; a.click(); toast('Snapshot downloaded');
});
$('clear-scene').addEventListener('click', () => {
  if (!confirm('Clear every object from this design?')) return;
  const next = createProject(project.name); selectedId = null; commit(next, null); toast('Scene cleared');
});
$('grid-toggle').addEventListener('change', (e) => { grid.visible = e.target.checked; });
$('walls-toggle').addEventListener('change', (e) => { wallTransparency = e.target.checked; renderProject(); });
$('snap-toggle').addEventListener('change', (e) => { transform.setTranslationSnap(e.target.checked ? .25 : null); });

function setView(mode) {
  viewMode = mode;
  const center = orbit.target.clone();
  camera = mode === '3d' ? perspective : ortho;
  if (mode === '2d') { ortho.position.set(center.x, 24, center.z); ortho.lookAt(center.x, 0, center.z); }
  createOrbit(); orbit.target.copy(center); transform.camera = camera;
  $('view-label').textContent = mode === '3d' ? '3D view' : 'Plan view'; $('view-icon').textContent = mode === '3d' ? '◇' : '▦'; resize();
  requestAnimationFrame(fitView);
}
$('view-toggle').addEventListener('click', () => setView(viewMode === '3d' ? '2d' : '3d'));
function zoom(factor) {
  if (camera.isOrthographicCamera) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, .4, 5); camera.updateProjectionMatrix(); }
  else camera.position.lerp(orbit.target, 1 - 1 / factor);
}
$('zoom-in').addEventListener('click', () => zoom(1.25)); $('zoom-out').addEventListener('click', () => zoom(.8)); $('fit-view').addEventListener('click', fitView);
function fitView() {
  const box = new THREE.Box3().setFromObject(sceneGroup); if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()); orbit.target.copy(center);
  if (camera.isPerspectiveCamera) { const distance = Math.max(size.x, size.z, size.y) * 1.55 + 4; camera.position.copy(center).add(new THREE.Vector3(distance, distance * .72, distance)); }
  else { camera.position.set(center.x, 24, center.z); camera.lookAt(center.x, 0, center.z); camera.zoom = Math.min(16 / Math.max(size.x, 1), 12 / Math.max(size.z, 1)); camera.updateProjectionMatrix(); }
  orbit.update();
}

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName); if (typing) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) $('redo').click(); else $('undo').click(); }
  else if (['Delete', 'Backspace'].includes(event.key)) deleteSelected();
  else if (event.key.toLowerCase() === 'd') duplicateSelected();
  else if (event.key === '1') setTool('select'); else if (event.key === '2') setTool('room'); else if (event.key === '3') setTool('wall');
  else if (event.key.toLowerCase() === 'v') $('view-toggle').click();
  else if (event.key === 'Escape') { setTool('select'); selectItem(null); }
});

function resize() {
  const width = viewport.clientWidth, height = viewport.clientHeight; if (!width || !height) return;
  renderer.setSize(width, height, false); perspective.aspect = width / height; perspective.updateProjectionMatrix();
  const span = 11; ortho.left = -span * width / height; ortho.right = span * width / height; ortho.top = span; ortho.bottom = -span; ortho.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(viewport);
function animate() { requestAnimationFrame(animate); orbit.update(); renderer.render(scene, camera); }
renderProject(); resize(); fitView(); animate();
