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
  const bounds = normalizePoint(start, end);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const minX = cx - width / 2;
  const maxX = cx + width / 2;
  const minZ = cz - depth / 2;
  const maxZ = cz + depth / 2;
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
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Invalid project file');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Project file must be valid JSON');
  }
  if (!parsed || parsed.version !== VERSION || typeof parsed.name !== 'string' || parsed.name.length > 120
      || typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length > 40 || !Number.isFinite(Date.parse(parsed.updatedAt))
      || !Array.isArray(parsed.items) || parsed.items.length > 500
      || Object.keys(parsed).some((key) => !['version', 'name', 'updatedAt', 'items'].includes(key))) {
    throw new Error('Invalid project file');
  }
  const validKinds = new Set(['wall', 'floor', 'furniture', 'opening']);
  const validSubtypes = {
    wall: new Set(['wall']),
    floor: new Set(['floor']),
    furniture: new Set(['sofa', 'bed', 'table', 'chair', 'cabinet', 'plant']),
    opening: new Set(['door', 'window']),
  };
  const ids = new Set();
  const validVector = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const roughWalls = parsed.items.filter((item) => item?.kind === 'wall' && typeof item.id === 'string'
    && validVector(item.position) && validVector(item.rotation) && validVector(item.size));
  for (const item of parsed.items.filter((entry) => entry?.kind === 'opening')) {
    let host = roughWalls.find((wall) => wall.id === item.hostWallId);
    if (!host) {
      host = roughWalls.map((wall) => {
        const angle = wall.rotation[1], dx = item.position?.[0] - wall.position[0], dz = item.position?.[2] - wall.position[2];
        return { wall, localOffset: Math.cos(angle) * dx - Math.sin(angle) * dz, distance: Math.abs(Math.sin(angle) * dx + Math.cos(angle) * dz) };
      }).sort((a, b) => a.distance - b.distance)[0]?.wall;
      if (!host) throw new Error('Opening requires a host wall');
      item.hostWallId = host.id;
    }
    if (!Number.isFinite(item.localOffset)) {
      const angle = host.rotation[1], dx = item.position?.[0] - host.position[0], dz = item.position?.[2] - host.position[2];
      item.localOffset = Math.cos(angle) * dx - Math.sin(angle) * dz;
    }
    if (!Number.isFinite(item.localBottom)) item.localBottom = item.position?.[1] - (host.position[1] - host.size[1] / 2);
  }
  for (const item of parsed.items) {
    const valid = item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100 && !ids.has(item.id)
      && validKinds.has(item.kind) && typeof item.subtype === 'string' && validSubtypes[item.kind]?.has(item.subtype)
      && validVector(item.position) && item.position.every((value) => Math.abs(value) <= 500)
      && validVector(item.rotation) && item.rotation.every((value) => Math.abs(value) <= 10_000)
      && validVector(item.size) && item.size.every((value) => value >= .05 && value <= 200)
      && (item.name === undefined || (typeof item.name === 'string' && item.name.length <= 120))
      && !Object.keys(item).some((key) => !['id', 'kind', 'subtype', 'position', 'rotation', 'size', 'color', 'name', 'hostWallId', 'localOffset', 'localBottom'].includes(key))
      && (item.kind === 'opening'
        ? typeof item.hostWallId === 'string' && item.hostWallId.length <= 128 && Number.isFinite(item.localOffset) && Math.abs(item.localOffset) <= 500
          && Number.isFinite(item.localBottom) && item.localBottom >= 0 && item.localBottom <= 200
        : item.hostWallId === undefined && item.localOffset === undefined && item.localBottom === undefined)
      && typeof item.color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(item.color);
    if (!valid) throw new Error('Invalid project item');
    ids.add(item.id);
  }
  const walls = parsed.items.filter((item) => item.kind === 'wall');
  const openings = parsed.items.filter((item) => item.kind === 'opening');
  if (walls.length > 200 || openings.length > 100) throw new Error('Project is too complex');
  if (walls.some((wall) => Math.abs(wall.rotation[0]) > .001 || Math.abs(wall.rotation[2]) > .001)) {
    throw new Error('Walls must remain upright');
  }
  const wallMap = new Map(walls.map((wall) => [wall.id, wall]));
  const openingCounts = new Map();
  for (const item of openings) {
    const wall = wallMap.get(item.hostWallId);
    if (!wall || Math.abs(wall.rotation[0]) > .001 || Math.abs(wall.rotation[2]) > .001
        || Math.abs(item.localOffset) + item.size[0] / 2 > wall.size[0] / 2 - .04) {
      throw new Error('Opening does not fit its host wall');
    }
    const wallBottom = wall.position[1] - wall.size[1] / 2;
    if (item.localBottom + item.size[1] > wall.size[1] + .01) {
      throw new Error('Opening exceeds its host wall height');
    }
    const count = (openingCounts.get(wall.id) || 0) + 1;
    if (count > 16) throw new Error('Too many openings on one wall');
    openingCounts.set(wall.id, count);
    const angle = wall.rotation[1], cos = Math.cos(angle), sin = Math.sin(angle);
    const worldX = wall.position[0] + cos * item.localOffset;
    const worldY = wallBottom + item.localBottom;
    const worldZ = wall.position[2] - sin * item.localOffset;
    if ([worldX, worldY, worldZ].some((value) => Math.abs(value) > 500)) throw new Error('Opening is outside project bounds');
    item.position = [worldX, worldY, worldZ];
    item.rotation = [...wall.rotation];
  }
  for (const wall of walls) {
    const hosted = openings.filter((item) => item.hostWallId === wall.id).sort((a, b) => a.localOffset - b.localOffset);
    for (let index = 1; index < hosted.length; index += 1) {
      if (hosted[index].localOffset - hosted[index - 1].localOffset < (hosted[index].size[0] + hosted[index - 1].size[0]) / 2 + .08) {
        throw new Error('Openings overlap');
      }
    }
  }
  return parsed;
}

export function createHistory(initial) {
  const historyLimit = 50;
  const snapshots = [clone(initial)];
  let cursor = 0;
  return {
    current: () => clone(snapshots[cursor]),
    canUndo: () => cursor > 0,
    canRedo: () => cursor < snapshots.length - 1,
    commit(project) {
      snapshots.splice(cursor + 1);
      snapshots.push(clone(project));
      if (snapshots.length > historyLimit) snapshots.shift();
      cursor = snapshots.length - 1;
      return this.current();
    },
    undo() { if (cursor > 0) cursor -= 1; return this.current(); },
    redo() { if (cursor < snapshots.length - 1) cursor += 1; return this.current(); },
    reset(project) { snapshots.splice(0, snapshots.length, clone(project)); cursor = 0; return this.current(); },
  };
}
