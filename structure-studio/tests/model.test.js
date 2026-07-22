import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  addRoom,
  addObject,
  updateObject,
  removeObject,
  duplicateObject,
  serializeProject,
  deserializeProject,
  createHistory,
} from '../model.js';

test('creates a rectangular room with four walls and a floor', () => {
  const project = createProject('Townhouse');
  const next = addRoom(project, { x: -4, z: -3 }, { x: 4, z: 3 });
  assert.equal(next.name, 'Townhouse');
  assert.equal(next.items.filter((item) => item.kind === 'wall').length, 4);
  assert.equal(next.items.filter((item) => item.kind === 'floor').length, 1);
  assert.deepEqual(next.items.find((item) => item.kind === 'floor').size, [8, 0.12, 6]);
});

test('minimum-size rooms remain enclosed and centered', () => {
  const next = addRoom(createProject('Small'), { x: 2, z: 3 }, { x: 2.2, z: 3.1 });
  const floor = next.items.find((item) => item.kind === 'floor');
  const walls = next.items.filter((item) => item.kind === 'wall');
  assert.deepEqual(floor.position, [2.1, 0, 3.05]);
  assert.deepEqual(floor.size, [1, 0.12, 1]);
  assert.deepEqual(walls.map((wall) => wall.position), [
    [2.1, 1.4, 2.55], [2.1, 1.4, 3.55], [1.6, 1.4, 3.05], [2.6, 1.4, 3.05],
  ]);
});

test('adds, updates, duplicates, and removes design objects immutably', () => {
  const project = createProject();
  const withSofa = addObject(project, {
    kind: 'furniture', subtype: 'sofa', position: [1, 0, 2], rotation: [0, 0, 0], size: [2.4, 0.9, 1], color: '#b88a67',
  });
  assert.equal(project.items.length, 0);
  assert.equal(withSofa.items.length, 1);
  const id = withSofa.items[0].id;
  const moved = updateObject(withSofa, id, { position: [3, 0, -2], rotation: [0, Math.PI / 2, 0] });
  assert.deepEqual(moved.items[0].position, [3, 0, -2]);
  assert.deepEqual(withSofa.items[0].position, [1, 0, 2]);
  const duplicated = duplicateObject(moved, id);
  assert.equal(duplicated.items.length, 2);
  assert.notEqual(duplicated.items[0].id, duplicated.items[1].id);
  assert.deepEqual(duplicated.items[1].position, [3.5, 0, -1.5]);
  assert.equal(removeObject(moved, id).items.length, 0);
});

test('round-trips a project through portable JSON', () => {
  const project = addObject(createProject('Saved plan'), {
    kind: 'furniture', subtype: 'bed', position: [0, 0, 0], rotation: [0, 0, 0], size: [2, 0.65, 2.2], color: '#8097b0',
  });
  const restored = deserializeProject(serializeProject(project));
  assert.deepEqual(restored, project);
});

test('history supports undo and redo without mutating snapshots', () => {
  const history = createHistory(createProject());
  history.commit(addObject(history.current(), {
    kind: 'furniture', subtype: 'table', position: [0, 0, 0], rotation: [0, 0, 0], size: [1.8, 0.75, 1], color: '#9b7253',
  }));
  assert.equal(history.current().items.length, 1);
  history.undo();
  assert.equal(history.current().items.length, 0);
  history.redo();
  assert.equal(history.current().items.length, 1);
});

test('history retains only the latest 50 snapshots', () => {
  const base = createProject('0');
  const history = createHistory(base);
  for (let index = 1; index <= 60; index += 1) history.commit({ ...base, name: String(index) });
  for (let index = 0; index < 100; index += 1) history.undo();
  assert.equal(history.current().name, '11');
  assert.equal(history.canUndo(), false);
});

test('rejects malformed imported plans', () => {
  assert.throws(() => deserializeProject('{"items":"bad"}'), /Invalid project/);
  assert.throws(() => deserializeProject('{broken'), /valid JSON/);
  assert.throws(() => deserializeProject(JSON.stringify({ version: 1, name: 'Broken', items: [{}], rooms: [] })), /Invalid project/);
  assert.throws(() => deserializeProject(JSON.stringify({
    version: 1, name: 'Broken', rooms: [],
    items: [{ id: 'x', kind: 'wall', subtype: 'wall', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, -2, 1], color: '#fff' }],
  })), /Invalid project/);
  assert.throws(() => deserializeProject(JSON.stringify({
    version: 1, name: 'Broken', items: [{ id: 'x', kind: 'furniture', subtype: 'spaceship', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }],
  })), /Invalid project/);
  assert.throws(() => deserializeProject(JSON.stringify({
    version: 1, name: 'Tilted wall', updatedAt: new Date().toISOString(),
    items: [{ id: 'wall', kind: 'wall', subtype: 'wall', position: [0, 1, 0], rotation: [1, 0, 1], size: [3, 2, .16], color: '#ffffff' }],
  })), /Walls must remain upright/);
  const tooMany = Array.from({ length: 2001 }, (_, index) => ({ id: `x${index}`, kind: 'furniture', subtype: 'chair', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }));
  assert.throws(() => deserializeProject(JSON.stringify({ version: 1, name: 'Too large', updatedAt: new Date().toISOString(), items: tooMany })), /Invalid project/);
  const validItem = { id: 'safe', kind: 'furniture', subtype: 'chair', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' };
  const plan = (item) => JSON.stringify({ version: 1, name: 'Plan', updatedAt: new Date().toISOString(), items: [item] });
  assert.throws(() => deserializeProject(plan({ ...validItem, position: [501, 0, 0] })), /Invalid project/);
  assert.throws(() => deserializeProject(plan({ ...validItem, size: [201, 1, 1] })), /Invalid project/);
  assert.throws(() => deserializeProject(plan({ ...validItem, color: '#12345' })), /Invalid project/);
  assert.throws(() => deserializeProject(plan({ ...validItem, metadata: { deeply: ['nested'] } })), /Invalid project/);
  assert.throws(() => deserializeProject(' '.repeat(2_000_001)), /Invalid project/);
});

test('migrates openings onto one host wall and rejects overlapping or unhosted openings', () => {
  let plan = addRoom(createProject('Hosted openings'), { x: -4, z: -3 }, { x: 4, z: 3 });
  plan = addObject(plan, { kind: 'opening', subtype: 'door', position: [0, 0, 0], rotation: [0, 0, 0], size: [.9, 2.1, .14], color: '#886644' });
  const migrated = deserializeProject(serializeProject(plan));
  const opening = migrated.items.find((item) => item.kind === 'opening');
  assert.ok(opening.hostWallId);
  assert.equal(typeof opening.localOffset, 'number');
  assert.equal(typeof opening.localBottom, 'number');
  assert.ok(migrated.items.some((item) => item.id === opening.hostWallId && item.kind === 'wall'));

  const overlapping = structuredClone(migrated);
  overlapping.items.push({ ...structuredClone(opening), id: 'overlap', name: 'Overlap' });
  assert.throws(() => deserializeProject(JSON.stringify(overlapping)), /Openings overlap/);

  const unhosted = createProject('No walls');
  unhosted.items.push({ ...structuredClone(opening), id: 'orphan' });
  assert.throws(() => deserializeProject(JSON.stringify(unhosted)), /Opening requires a host wall|host wall/);
});
