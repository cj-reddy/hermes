import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  addRoom,
  addObject,
  updateObject,
  removeObject,
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

test('rejects malformed imported plans', () => {
  assert.throws(() => deserializeProject('{"items":"bad"}'), /Invalid project/);
  assert.throws(() => deserializeProject('{broken'), /valid JSON/);
  assert.throws(() => deserializeProject(JSON.stringify({ version: 1, name: 'Broken', items: [{}], rooms: [] })), /Invalid project/);
  assert.throws(() => deserializeProject(JSON.stringify({
    version: 1, name: 'Broken', rooms: [],
    items: [{ id: 'x', kind: 'wall', subtype: 'wall', position: [0, 0, 0], rotation: [0, 0, 0], size: [1, -2, 1], color: '#fff' }],
  })), /Invalid project/);
});
