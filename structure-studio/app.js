import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import { TransformControls } from './vendor/controls/TransformControls.js';
import {
  createProject, addRoom, addObject, updateObject, removeObject, duplicateObject,
  serializeProject, deserializeProject, createHistory,
} from './model.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const STORAGE_KEY = 'structure-studio-project-v1';
const MAX_ITEMS = 500, MAX_WALLS = 200, MAX_OPENINGS = 100;
const COLORS = { wall: '#d8d5ce', floor: '#8b6d54', accent: '#7170ff' };
const snap = (n) => $('snap-toggle').checked ? Math.round(n * 4) / 4 : n;
const bounded = (n) => THREE.MathUtils.clamp(snap(n), -500, 500);
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
let pointerStart = null;
let activePointerId = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111316);
scene.fog = new THREE.Fog(0x111316, 40, 700);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D design canvas');
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.appendChild(renderer.domElement);

const perspective = new THREE.PerspectiveCamera(44, 1, .1, 2000);
perspective.position.set(9.5, 8, 10.5);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 2000);
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
  orbit.maxDistance = 1000;
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

function normalizeModel(group) {
  const bounds = new THREE.Box3().setFromObject(group);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -bounds.min.y, -center.z);
  const normalized = new THREE.Group();
  normalized.add(group);
  normalized.scale.set(
    1 / Math.max(dimensions.x, .001),
    1 / Math.max(dimensions.y, .001),
    1 / Math.max(dimensions.z, .001),
  );
  const wrapper = new THREE.Group();
  wrapper.add(normalized);
  return wrapper;
}

function buildWallWithOpenings(item) {
  const group = new THREE.Group();
  const [length, height, thickness] = item.size;
  const halfLength = length / 2, halfHeight = height / 2;
  const openings = project.items.filter((entry) => entry.kind === 'opening' && entry.hostWallId === item.id).map((entry) => {
    const localX = entry.localOffset;
    const x0 = Math.max(-halfLength, localX - entry.size[0] / 2);
    const x1 = Math.min(halfLength, localX + entry.size[0] / 2);
    const openingBottom = entry.position[1] - item.position[1];
    const y0 = Math.max(-halfHeight, openingBottom);
    const y1 = Math.min(halfHeight, openingBottom + entry.size[1]);
    return x1 - x0 > .05 && y1 - y0 > .05 ? { x0, x1, y0, y1 } : null;
  }).filter(Boolean);
  const wallOptions = { transparent: wallTransparency, opacity: wallTransparency ? .36 : 1 };
  if (!openings.length) {
    box(group, item.size, [0, 0, 0], item.color, wallOptions);
  } else {
    const xStops = [...new Set([-halfLength, halfLength, ...openings.flatMap((opening) => [opening.x0, opening.x1])])].sort((a, b) => a - b);
    for (let index = 0; index < xStops.length - 1; index += 1) {
      const left = xStops[index], right = xStops[index + 1];
      if (right - left < .001) continue;
      const middle = (left + right) / 2;
      const blocked = openings.filter((opening) => opening.x0 < middle && opening.x1 > middle)
        .map((opening) => [opening.y0, opening.y1]).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of blocked) {
        const previous = merged.at(-1);
        if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
        else merged.push([...interval]);
      }
      let cursor = -halfHeight;
      for (const [bottom, top] of [...merged, [halfHeight, halfHeight]]) {
        if (bottom > cursor + .001) box(group, [right - left, bottom - cursor, thickness], [middle, (cursor + bottom) / 2, 0], item.color, wallOptions);
        cursor = Math.max(cursor, top);
      }
    }
  }
  group.position.set(...item.position);
  group.rotation.set(...item.rotation);
  return group;
}

function createSceneObject(item) {
  let root;
  if (item.kind === 'wall') {
    root = buildWallWithOpenings(item);
  } else if (item.kind === 'floor') {
    root = new THREE.Mesh(new THREE.BoxGeometry(...item.size), material(item.color));
    root.receiveShadow = true;
    root.position.set(...item.position); root.rotation.set(...item.rotation);
  } else {
    const model = item.kind === 'furniture' ? buildFurniture(item) : buildArchitectural(item);
    root = normalizeModel(model);
    root.position.set(...item.position); root.rotation.set(...item.rotation); root.scale.set(...item.size);
  }
  root.userData.itemId = item.id;
  root.traverse((child) => { child.userData.itemId = item.id; });
  return root;
}

function disposeObject3D(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((child) => {
    if (child.geometry && !geometries.has(child.geometry)) {
      geometries.add(child.geometry); child.geometry.dispose();
    }
    const entries = Array.isArray(child.material) ? child.material : [child.material];
    entries.filter(Boolean).forEach((entry) => {
      if (materials.has(entry)) return;
      materials.add(entry);
      Object.values(entry).filter((value) => value?.isTexture && !textures.has(value)).forEach((texture) => {
        textures.add(texture); texture.dispose();
      });
      entry.dispose();
    });
  });
}

function renderProject() {
  transform.detach();
  while (sceneGroup.children.length) {
    const child = sceneGroup.children[0];
    sceneGroup.remove(child);
    disposeObject3D(child);
  }
  for (const item of project.items) sceneGroup.add(createSceneObject(item));
  if (selectedId) {
    const selected = sceneGroup.children.find((obj) => obj.userData.itemId === selectedId);
    if (selected) transform.attach(selected); else selectedId = null;
  }
  $('project-name').value = project.name;
  $('object-count').textContent = `${project.items.length} object${project.items.length === 1 ? '' : 's'}`;
  const objectSelect = $('object-select');
  objectSelect.replaceChildren(new Option('Nothing selected', ''), ...project.items.map((item) => new Option(labelFor(item), item.id)));
  objectSelect.value = selectedId || '';
  $('undo').disabled = !history.canUndo(); $('redo').disabled = !history.canRedo();
  updateInspector();
}

function saveLocal(silent = true) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
    if (!silent) toast('Design saved locally');
    return true;
  } catch {
    $('status').textContent = 'Autosave unavailable — export a backup';
    toast('Could not save locally — export a backup');
    return false;
  }
}
function commit(next, keepSelection = selectedId) {
  try {
    next = deserializeProject(serializeProject(next));
  } catch {
    toast('That change would create an invalid project');
    renderProject();
    return false;
  }
  project = history.commit(next);
  selectedId = keepSelection;
  saveLocal(true);
  renderProject();
  return true;
}

function selectItem(id) {
  selectedId = id;
  renderProject();
  if (id) $('status').textContent = `Selected ${labelFor(project.items.find((i) => i.id === id))}`;
}
$('object-select').addEventListener('change', (event) => selectItem(event.target.value || null));

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

function syncWallOpenings(next, wallId) {
  const wall = next.items.find((entry) => entry.id === wallId && entry.kind === 'wall');
  if (!wall) return next;
  const hosted = next.items.filter((entry) => entry.kind === 'opening' && entry.hostWallId === wallId);
  if (hosted.some((entry) => Math.abs(entry.localOffset) + entry.size[0] / 2 > wall.size[0] / 2 - .04
      || entry.localBottom + entry.size[1] > wall.size[1] + .01)) return null;
  const angle = wall.rotation[1], cos = Math.cos(angle), sin = Math.sin(angle);
  const wallBottom = wall.position[1] - wall.size[1] / 2;
  for (const opening of hosted) {
    const position = [wall.position[0] + cos * opening.localOffset, wallBottom + opening.localBottom, wall.position[2] - sin * opening.localOffset];
    if (position.some((value) => Math.abs(value) > 500)) return null;
    next = updateObject(next, opening.id, {
      position,
      rotation: [...wall.rotation],
    });
  }
  return next;
}

function commitTransform() {
  const object = transform.object;
  if (!object || !selectedId) return;
  const item = project.items.find((i) => i.id === selectedId);
  if (!item) return;
  let position = [bounded(object.position.x), THREE.MathUtils.clamp(snap(object.position.y), -500, 500), bounded(object.position.z)];
  let rotation = [object.rotation.x, object.rotation.y, object.rotation.z];
  let extra = {};
  if (item.kind === 'opening') {
    const placement = openingPlacement(item.subtype, item, { x: object.position.x, z: object.position.z });
    if (!placement) { toast('No valid wall slot at that location'); renderProject(); return; }
    position = placement.position; rotation = placement.rotation;
    extra = { hostWallId: placement.hostWallId, localOffset: placement.localOffset, localBottom: placement.localBottom };
  }
  if (item.kind === 'wall') rotation = [0, rotation[1], 0];
  let next = updateObject(project, selectedId, { position, rotation, ...extra });
  if (item.kind === 'wall') next = syncWallOpenings(next, item.id);
  if (!next) { toast('That wall change would detach an opening'); renderProject(); return; }
  commit(next, selectedId);
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
  return raycaster.ray.intersectPlane(groundPlane, point) ? { x: bounded(point.x), z: bounded(point.z) } : null;
}
function pick(event) {
  screenPoint(event); raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(sceneGroup.children, true);
  return hits[0]?.object.userData.itemId || null;
}

const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(COLORS.accent, { transparent: true, opacity: .25 }));
preview.visible = false; scene.add(preview);
function constrainDrawPoint(start, point) {
  let dx = point.x - start.x, dz = point.z - start.z;
  if (activeTool === 'room') { dx = THREE.MathUtils.clamp(dx, -200, 200); dz = THREE.MathUtils.clamp(dz, -200, 200); }
  else {
    const length = Math.hypot(dx, dz);
    if (length > 200) { dx *= 200 / length; dz *= 200 / length; }
  }
  return { x: bounded(start.x + dx), z: bounded(start.z + dz) };
}
function ensureRoomExtent(start, end) {
  const next = { ...end };
  if (Math.abs(next.x - start.x) < 1) next.x = bounded(start.x + (start.x >= 499.5 ? -1 : 1));
  if (Math.abs(next.z - start.z) < 1) next.z = bounded(start.z + (start.z >= 499.5 ? -1 : 1));
  return next;
}
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
  renderer.domElement.focus({ preventScroll: true });
  if (event.button !== 0 || activePointerId !== null) return;
  activePointerId = event.pointerId;
  pointerMoved = false;
  pointerStart = { x: event.clientX, y: event.clientY };
  if (activeTool === 'select') return;
  const point = groundPoint(event); if (!point) return;
  drawing = { start: point, current: point };
  orbit.enabled = false; renderer.domElement.setPointerCapture(event.pointerId);
  updatePreview(point, point);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointerId) return;
  if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) pointerMoved = true;
  if (!drawing) return;
  const point = groundPoint(event); if (!point) return;
  drawing.current = constrainDrawPoint(drawing.start, point); updatePreview(drawing.start, drawing.current);
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.pointerId !== activePointerId) return;
  activePointerId = null;
  pointerStart = null;
  if (event.button !== 0) return;
  if (drawing) {
    const { start, current } = drawing; drawing = null; preview.visible = false; orbit.enabled = true;
    const dx = current.x - start.x, dz = current.z - start.z;
    if (Math.hypot(dx, dz) > .5) {
      if (activeTool === 'room') {
        if (project.items.length + 5 > MAX_ITEMS || project.items.filter((item) => item.kind === 'wall').length + 4 > MAX_WALLS) {
          toast('Project complexity limit reached'); return;
        }
        const end = ensureRoomExtent(start, current);
        const next = addRoom(project, start, end); commit(next, next.items.at(-1).id); toast('Room added');
      } else {
        if (project.items.length >= MAX_ITEMS || project.items.filter((item) => item.kind === 'wall').length >= MAX_WALLS) {
          toast('Project complexity limit reached'); return;
        }
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
function cancelPointer(event) {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  activePointerId = null;
  pointerStart = null;
  drawing = null;
  preview.visible = false;
  orbit.enabled = true;
}
renderer.domElement.addEventListener('pointercancel', cancelPointer);
renderer.domElement.addEventListener('lostpointercapture', cancelPointer);

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('draw-hint').classList.toggle('hidden', tool === 'select');
  $('status').textContent = tool === 'select' ? 'Select and edit objects' : `Draw ${tool}: click and drag on the grid`;
  renderer.domElement.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  if (tool !== 'select') transform.detach(); else renderProject();
}
function addKeyboardStructure(kind) {
  const center = { x: bounded(orbit.target.x), z: bounded(orbit.target.z) };
  if (kind === 'room') {
    if (project.items.length + 5 > MAX_ITEMS || project.items.filter((item) => item.kind === 'wall').length + 4 > MAX_WALLS) {
      toast('Project complexity limit reached'); return;
    }
    const next = addRoom(project, { x: bounded(center.x - 2), z: bounded(center.z - 1.5) }, { x: bounded(center.x + 2), z: bounded(center.z + 1.5) });
    commit(next, next.items.at(-1).id); toast('Room added'); return;
  }
  if (project.items.length >= MAX_ITEMS || project.items.filter((item) => item.kind === 'wall').length >= MAX_WALLS) {
    toast('Project complexity limit reached'); return;
  }
  const next = addObject(project, { kind: 'wall', subtype: 'wall', position: [bounded(center.x), 1.4, bounded(center.z)],
    rotation: [0, 0, 0], size: [3, 2.8, .16], color: COLORS.wall });
  commit(next, next.items.at(-1).id); toast('Wall added');
}
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', (event) => {
  const tool = button.dataset.tool;
  if (event.detail === 0 && ['room', 'wall'].includes(tool)) addKeyboardStructure(tool); else setTool(tool);
}));

const DEFAULTS = {
  sofa: { kind: 'furniture', size: [2.4, .9, 1], color: '#a88167' }, bed: { kind: 'furniture', size: [2, .7, 2.2], color: '#8097b0' },
  table: { kind: 'furniture', size: [1.6, .75, 1], color: '#76543d' }, chair: { kind: 'furniture', size: [.65, 1, .65], color: '#aa815f' },
  cabinet: { kind: 'furniture', size: [1.25, 1.7, .5], color: '#6e604f' }, plant: { kind: 'furniture', size: [.7, 1.35, .7], color: '#47745b' },
  door: { kind: 'opening', size: [.9, 2.1, .14], color: '#8c684e' }, window: { kind: 'opening', size: [1.4, 1.25, .14], color: '#d7d9de' },
};
function openingPlacement(subtype, spec, center, source = project) {
  let best = null;
  for (const wall of source.items.filter((item) => item.kind === 'wall')) {
    if (spec.size[0] + .1 > wall.size[0] || spec.size[1] > wall.size[1] + .01) continue;
    const angle = wall.rotation[1], cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = center.x - wall.position[0], dz = center.z - wall.position[2];
    const localX = cos * dx - sin * dz;
    const localZ = sin * dx + cos * dz;
    const usableHalf = wall.size[0] / 2 - spec.size[0] / 2 - .05;
    const desiredX = THREE.MathUtils.clamp(snap(localX), -usableHalf, usableHalf);
    const occupied = source.items.filter((entry) => entry.kind === 'opening' && entry.hostWallId === wall.id && entry.id !== spec.id);
    if (occupied.length >= 16) continue;
    const candidates = [desiredX, -usableHalf, usableHalf];
    occupied.forEach((entry) => {
      const clearance = (entry.size[0] + spec.size[0]) / 2 + .1;
      candidates.push(entry.localOffset - clearance, entry.localOffset + clearance);
    });
    const wallBottom = wall.position[1] - wall.size[1] / 2;
    const openingY = spec.position?.[1] ?? wallBottom + (subtype === 'window' ? .85 : 0);
    if (openingY < wallBottom - .01 || openingY + spec.size[1] > wallBottom + wall.size[1] + .01) continue;
    for (const candidate of [...new Set(candidates.map((value) => snap(value)))]) {
      if (candidate < -usableHalf - .001 || candidate > usableHalf + .001) continue;
      if (occupied.some((entry) => Math.abs(entry.localOffset - candidate) < (entry.size[0] + spec.size[0]) / 2 + .08)) continue;
      const score = Math.abs(localZ) + Math.abs(localX - candidate);
      const position = [wall.position[0] + cos * candidate, openingY, wall.position[2] - sin * candidate];
      if (position.some((value) => Math.abs(value) > 500)) continue;
      if (!best || score < best.score) best = {
        score, hostWallId: wall.id, localOffset: candidate, localBottom: openingY - wallBottom,
        position,
        rotation: [...wall.rotation],
      };
    }
  }
  return best;
}

document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => {
  const subtype = button.dataset.add, spec = DEFAULTS[subtype];
  if (project.items.length >= MAX_ITEMS || (spec.kind === 'opening' && project.items.filter((item) => item.kind === 'opening').length >= MAX_OPENINGS)) {
    toast('Project complexity limit reached'); return;
  }
  if (spec.kind === 'opening' && !project.items.some((item) => item.kind === 'wall')) {
    toast('Add a wall before placing an opening'); return;
  }
  const center = orbit.target;
  const placement = spec.kind === 'opening' ? openingPlacement(subtype, spec, center) : {
    position: [bounded(center.x), 0, bounded(center.z)], rotation: [0, 0, 0],
  };
  if (!placement) { toast('No wall has enough free space for this opening'); return; }
  const next = addObject(project, { ...spec, subtype, position: placement.position, rotation: placement.rotation,
    ...(spec.kind === 'opening' ? { hostWallId: placement.hostWallId, localOffset: placement.localOffset, localBottom: placement.localBottom } : {}) });
  setTool('select'); commit(next, next.items.at(-1).id); toast(`${subtype[0].toUpperCase() + subtype.slice(1)} added`);
}));

$('move-mode').addEventListener('click', () => setTransformMode('translate'));
$('rotate-mode').addEventListener('click', () => setTransformMode('rotate'));
function setTransformMode(mode) {
  transformMode = mode; transform.setMode(mode);
  const moving = mode === 'translate';
  $('move-mode').classList.toggle('active', moving); $('move-mode').setAttribute('aria-pressed', String(moving));
  $('rotate-mode').classList.toggle('active', !moving); $('rotate-mode').setAttribute('aria-pressed', String(!moving));
}

function updateSelected(patch) {
  if (!selectedId) return;
  commit(updateObject(project, selectedId, patch), selectedId);
}
$('object-name').addEventListener('change', (e) => updateSelected({ name: e.target.value.trim().slice(0, 120) || undefined }));
[['pos-x', 0], ['pos-z', 2]].forEach(([id, axis]) => $(id).addEventListener('change', (e) => {
  const item = project.items.find((i) => i.id === selectedId); if (!item) return;
  const value = Number(e.target.value);
  if (e.target.value.trim() === '' || !Number.isFinite(value)) { toast('Enter a valid position'); updateInspector(); return; }
  const position = [...item.position]; position[axis] = THREE.MathUtils.clamp(snap(value), -500, 500);
  if (item.kind === 'opening') {
    const placement = openingPlacement(item.subtype, item, { x: position[0], z: position[2] });
    if (!placement) { toast('No valid wall slot at that location'); updateInspector(); return; }
    updateSelected({ position: placement.position, rotation: placement.rotation,
      hostWallId: placement.hostWallId, localOffset: placement.localOffset, localBottom: placement.localBottom });
  } else {
    let next = updateObject(project, item.id, { position });
    if (item.kind === 'wall') next = syncWallOpenings(next, item.id);
    if (!next) { toast('That wall change would detach an opening'); updateInspector(); return; }
    commit(next, item.id);
  }
}));
[['size-x', 0], ['size-y', 1], ['size-z', 2]].forEach(([id, axis]) => $(id).addEventListener('change', (e) => {
  const item = project.items.find((i) => i.id === selectedId); if (!item) return;
  const value = Number(e.target.value);
  if (e.target.value.trim() === '' || !Number.isFinite(value)) { toast('Enter a valid size'); updateInspector(); return; }
  const size = [...item.size]; size[axis] = THREE.MathUtils.clamp(value, .1, 200);
  if (item.kind === 'opening') {
    const placement = openingPlacement(item.subtype, { ...item, size }, { x: item.position[0], z: item.position[2] });
    if (!placement) { toast('That opening does not fit in any free wall slot'); updateInspector(); return; }
    updateSelected({ size, position: placement.position, rotation: placement.rotation,
      hostWallId: placement.hostWallId, localOffset: placement.localOffset, localBottom: placement.localBottom });
  } else {
    let next = updateObject(project, item.id, { size });
    if (item.kind === 'wall') next = syncWallOpenings(next, item.id);
    if (!next) { toast('That wall is too short for its openings'); updateInspector(); return; }
    commit(next, item.id);
  }
}));
$('object-color').addEventListener('input', (e) => { $('color-value').value = e.target.value; });
$('object-color').addEventListener('change', (e) => updateSelected({ color: e.target.value }));

function deleteSelected() {
  if (!selectedId) return;
  const old = selectedId, item = project.items.find((entry) => entry.id === old);
  let next = removeObject(project, old);
  if (item?.kind === 'wall') {
    for (const opening of project.items.filter((entry) => entry.kind === 'opening' && entry.hostWallId === old)) next = removeObject(next, opening.id);
  }
  selectedId = null; commit(next, null); toast('Object deleted');
}
function duplicateSelected() {
  if (!selectedId) return;
  if (project.items.length >= MAX_ITEMS) { toast('Project complexity limit reached'); return; }
  const source = project.items.find((item) => item.id === selectedId);
  if (!source) return;
  if (source.kind === 'wall' && project.items.filter((item) => item.kind === 'wall').length >= MAX_WALLS) {
    toast('Wall complexity limit reached'); return;
  }
  if (source.kind === 'opening' && project.items.filter((item) => item.kind === 'opening').length >= MAX_OPENINGS) {
    toast('Opening complexity limit reached'); return;
  }
  let next = duplicateObject(project, selectedId);
  const duplicate = next.items.at(-1);
  if (source.kind === 'opening' && duplicate) {
    const placement = openingPlacement(duplicate.subtype, duplicate, { x: duplicate.position[0], z: duplicate.position[2] });
    if (!placement) { toast('No free wall slot for a duplicate'); return; }
    next = updateObject(next, duplicate.id, { position: placement.position, rotation: placement.rotation,
      hostWallId: placement.hostWallId, localOffset: placement.localOffset, localBottom: placement.localBottom });
  } else {
    next = updateObject(next, duplicate.id, { position: [bounded(duplicate.position[0]),
      THREE.MathUtils.clamp(duplicate.position[1], -500, 500), bounded(duplicate.position[2])] });
  }
  commit(next, duplicate.id); toast('Object duplicated');
}
$('delete-selected').addEventListener('click', deleteSelected); $('duplicate-selected').addEventListener('click', duplicateSelected);
$('undo').addEventListener('click', () => { project = history.undo(); selectedId = null; saveLocal(); renderProject(); });
$('redo').addEventListener('click', () => { project = history.redo(); selectedId = null; saveLocal(); renderProject(); });
$('save').addEventListener('click', () => saveLocal(false));
$('project-name').addEventListener('change', (e) => { const next = structuredClone(project); next.name = e.target.value.trim().slice(0, 120) || 'Untitled design'; commit(next); });

$('export').addEventListener('click', () => {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'design'}.json`; a.click(); URL.revokeObjectURL(url); toast('Project exported');
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Project file is too large');
    const imported = deserializeProject(await file.text());
    project = imported; history.reset(project); selectedId = null; saveLocal(); renderProject(); fitView(); toast('Project imported');
  }
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
  $('view-label').textContent = mode === '3d' ? '3D view' : 'Plan view'; $('view-icon').textContent = mode === '3d' ? '◇' : '▦';
  $('view-toggle').setAttribute('aria-pressed', String(mode === '2d'));
  $('view-toggle').setAttribute('aria-label', mode === '3d' ? 'Switch to plan view' : 'Switch to 3D view');
  resize();
  requestAnimationFrame(fitView);
}
$('view-toggle').addEventListener('click', () => setView(viewMode === '3d' ? '2d' : '3d'));
function zoom(factor) {
  if (camera.isOrthographicCamera) {
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, .01, 20);
    camera.updateProjectionMatrix();
  } else {
    const offset = camera.position.clone().sub(orbit.target);
    const distance = THREE.MathUtils.clamp(offset.length() / factor, orbit.minDistance, orbit.maxDistance);
    camera.position.copy(orbit.target).add(offset.setLength(distance));
    orbit.update();
  }
}
$('zoom-in').addEventListener('click', () => zoom(1.25)); $('zoom-out').addEventListener('click', () => zoom(.8)); $('fit-view').addEventListener('click', fitView);
function fitView() {
  const box = new THREE.Box3().setFromObject(sceneGroup); if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  orbit.target.copy(center);
  if (camera.isPerspectiveCamera) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = Math.max(orbit.minDistance, sphere.radius * 1.25 / Math.sin(Math.min(verticalFov, horizontalFov) / 2));
    orbit.maxDistance = Math.max(1000, distance * 2);
    camera.far = Math.max(2000, distance + sphere.radius * 4);
    scene.fog.near = Math.max(40, distance - sphere.radius * 2);
    scene.fog.far = Math.max(700, distance + sphere.radius * 2);
    const direction = camera.position.clone().sub(center);
    if (direction.lengthSq() < .001) direction.set(1, .72, 1);
    direction.y = Math.max(Math.abs(direction.y), Math.hypot(direction.x, direction.z) * .35);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    camera.updateProjectionMatrix();
  } else {
    const size = box.getSize(new THREE.Vector3());
    const verticalPadding = Math.max(20, size.y * 2);
    camera.position.set(center.x, box.max.y + verticalPadding, center.z); camera.lookAt(center);
    camera.far = verticalPadding + size.y + 20;
    const frustumWidth = camera.right - camera.left;
    const frustumHeight = camera.top - camera.bottom;
    camera.zoom = Math.min(
      frustumWidth / Math.max(size.x * 1.2, 1),
      frustumHeight / Math.max(size.z * 1.2, 1),
    );
    camera.updateProjectionMatrix();
  }
  orbit.update();
}

function keyboardTransform(key, rotate = false) {
  const item = project.items.find((entry) => entry.id === selectedId); if (!item) return;
  if (rotate) {
    if (item.kind === 'opening') { toast('Openings stay aligned to their host wall'); return; }
    const direction = ['ArrowRight', 'ArrowUp'].includes(key) ? 1 : -1;
    const rotation = [...item.rotation]; rotation[1] += direction * THREE.MathUtils.degToRad(15);
    let next = updateObject(project, item.id, { rotation });
    if (item.kind === 'wall') next = syncWallOpenings(next, item.id);
    if (!next) { toast('Hosted openings would leave project bounds'); return; }
    commit(next, item.id); return;
  }
  const deltas = { ArrowLeft: [-.25, 0], ArrowRight: [.25, 0], ArrowUp: [0, -.25], ArrowDown: [0, .25] };
  const [dx, dz] = deltas[key];
  const target = { x: bounded(item.position[0] + dx), z: bounded(item.position[2] + dz) };
  if (item.kind === 'opening') {
    const placement = openingPlacement(item.subtype, item, target);
    if (!placement) { toast('No valid wall slot in that direction'); return; }
    commit(updateObject(project, item.id, { position: placement.position, rotation: placement.rotation,
      hostWallId: placement.hostWallId, localOffset: placement.localOffset, localBottom: placement.localBottom }), item.id);
    return;
  }
  const position = [target.x, item.position[1], target.z];
  let next = updateObject(project, item.id, { position });
  if (item.kind === 'wall') next = syncWallOpenings(next, item.id);
  if (!next) { toast('Hosted openings would leave project bounds'); return; }
  commit(next, item.id);
}

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName); if (typing) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) $('redo').click(); else $('undo').click();
    return;
  }
  if (mod || event.altKey) return;
  const commandFocus = document.activeElement === document.body || document.activeElement === renderer.domElement;
  if (!commandFocus) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); keyboardTransform(event.key, event.shiftKey); return;
  }
  if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); deleteSelected(); }
  else if (event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
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
