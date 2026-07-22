const VERSION = 1;

const clone = (value) => structuredClone(value);
const id = () => crypto.randomUUID();

export function createProject(name = 'Untitled design') {
  return { version: VERSION, name, updatedAt: new Date().toISOString(), items: [] };
}

function normalizePoint(a, b) {
  return {
    minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
  };
}

export function addObject(project, object) {
  const next = clone(project);
  next.items.push({ id: id(), ...clone(object) });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function addRoom(project, start, end, options = {}) {
  const { minX, maxX, minZ, maxZ } = normalizePoint(start, end);
  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxZ - minZ);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const height = options.height ?? 2.8;
  const thickness = options.thickness ?? 0.16;
  const wallColor = options.wallColor ?? '#d8d5ce';
  const floorColor = options.floorColor ?? '#9a7a5e';
  let next = addObject(project, {
    kind: 'floor', subtype: 'floor', position: [cx, 0, cz], rotation: [0, 0, 0], size: [width, 0.12, depth], color: floorColor,
  });
  const walls = [
    { position: [cx, height / 2, minZ], size: [width, height, thickness], rotation: [0, 0, 0] },
    { position: [cx, height / 2, maxZ], size: [width, height, thickness], rotation: [0, 0, 0] },
    { position: [minX, height / 2, cz], size: [depth, height, thickness], rotation: [0, Math.PI / 2, 0] },
    { position: [maxX, height / 2, cz], size: [depth, height, thickness], rotation: [0, Math.PI / 2, 0] },
  ];
  for (const wall of walls) next = addObject(next, { kind: 'wall', subtype: 'wall', color: wallColor, ...wall });
  return next;
}

export function updateObject(project, objectId, patch) {
  const next = clone(project);
  const index = next.items.findIndex((item) => item.id === objectId);
  if (index === -1) return next;
  next.items[index] = { ...next.items[index], ...clone(patch), id: objectId };
  next.updatedAt = new Date().toISOString();
  return next;
}

export function removeObject(project, objectId) {
  const next = clone(project);
  next.items = next.items.filter((item) => item.id !== objectId);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function duplicateObject(project, objectId) {
  const source = project.items.find((item) => item.id === objectId);
  if (!source) return clone(project);
  const copy = clone(source);
  delete copy.id;
  copy.position = [copy.position[0] + 0.5, copy.position[1], copy.position[2] + 0.5];
  return addObject(project, copy);
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Project file must be valid JSON');
  }
  if (!parsed || parsed.version !== VERSION || typeof parsed.name !== 'string' || !Array.isArray(parsed.items)) {
    throw new Error('Invalid project file');
  }
  const validKinds = new Set(['wall', 'floor', 'furniture', 'opening']);
  const ids = new Set();
  const validVector = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  for (const item of parsed.items) {
    const valid = item && typeof item.id === 'string' && item.id && !ids.has(item.id)
      && validKinds.has(item.kind) && typeof item.subtype === 'string'
      && validVector(item.position) && validVector(item.rotation) && validVector(item.size)
      && item.size.every((value) => value > 0)
      && typeof item.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(item.color);
    if (!valid) throw new Error('Invalid project item');
    ids.add(item.id);
  }
  return parsed;
}

export function createHistory(initial) {
  const snapshots = [clone(initial)];
  let cursor = 0;
  return {
    current: () => clone(snapshots[cursor]),
    canUndo: () => cursor > 0,
    canRedo: () => cursor < snapshots.length - 1,
    commit(project) {
      snapshots.splice(cursor + 1);
      snapshots.push(clone(project));
      cursor = snapshots.length - 1;
      return this.current();
    },
    undo() { if (cursor > 0) cursor -= 1; return this.current(); },
    redo() { if (cursor < snapshots.length - 1) cursor += 1; return this.current(); },
    reset(project) { snapshots.splice(0, snapshots.length, clone(project)); cursor = 0; return this.current(); },
  };
}
