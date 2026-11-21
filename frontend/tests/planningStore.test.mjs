import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const model = await import('../src/lib/planning/model.ts');
const { PlanningStore } = await import('../src/lib/planning/store.ts');

const {
  dueTag, projectProgress, overdueCount, neighbours, localRank, columnItems, moveItemLocal,
  removeStatusLocal, setStatusKindLocal, applyRenumbered, replaceId, stepSpot, shiftId, statusesOf,
} = model;

/* ---- Fixtures (made-up) ---- */

const T = '2026-11-21T10:00:00.000Z';
const status = (id, order, kind, projectId = 'p1') => ({ id, projectId, name: id, color: '', order, kind, createdAt: T, updatedAt: 'v1' });
const item = (id, statusId, rank, extra = {}) => ({
  id, projectId: 'p1', statusId, milestoneId: '', title: id, description: '', priority: 'none', labels: [], startDate: '',
  dueDate: '', completedAt: '', rank, checklist: [], budget: null, linkedTxIds: [], linkedNoteId: '', archivedAt: '',
  createdAt: T, updatedAt: 'v1', spent: 0, missingTxIds: [], linkedNoteMissing: false, ...extra,
});
const project = (id = 'p1', extra = {}) => ({
  id, name: 'Trip', description: '', color: '', icon: '', state: 'active', startDate: '', dueDate: '', linkedGoalId: '',
  sortOrder: 0, createdAt: T, updatedAt: 'v1', linkedGoalMissing: false, ...extra,
});
function board() {
  return {
    projects: [project()],
    statuses: [status('todo', 0, 'todo'), status('doing', 1, 'doing'), status('done', 2, 'done')],
    milestones: [],
    items: [item('a', 'todo', 1024), item('b', 'todo', 2048), item('c', 'todo', 3072), item('d', 'done', 1024, { completedAt: T })],
  };
}
const titles = (data, statusId) => columnItems(data, statusId).map((i) => i.id);

/* ---- Pure rules ---- */

test('progress: done ÷ board cards, archived left out, none = null', () => {
  const data = board();
  data.items.push(item('z', 'done', 9, { archivedAt: T }));
  assert.deepEqual(projectProgress(data, 'p1'), { done: 1, total: 4, percent: 25 });
  assert.equal(projectProgress({ ...data, items: [] }, 'p1').percent, null);
});

test('due tags: overdue, soon within 3 days, done never warns', () => {
  assert.equal(dueTag('2026-11-20', '2026-11-21'), 'overdue');
  assert.equal(dueTag('2026-11-21', '2026-11-21'), 'soon');
  assert.equal(dueTag('2026-11-24', '2026-11-21'), 'soon');
  assert.equal(dueTag('2026-11-25', '2026-11-21'), null);
  assert.equal(dueTag('2026-11-01', '2026-11-21', true), null);
  assert.equal(dueTag('', '2026-11-21'), null);
  const data = board();
  data.items[0].dueDate = '2026-11-01';
  data.items[3].dueDate = '2026-11-01';
  assert.equal(overdueCount(data, 'p1', '2026-11-21'), 1, 'the done card does not count');
});

test('neighbours and local rank for a drop position', () => {
  const col = [{ id: 'a', rank: 1024 }, { id: 'b', rank: 2048 }];
  assert.deepEqual(neighbours(col, 0), { beforeId: 'a' });
  assert.deepEqual(neighbours(col, 1), { afterId: 'a', beforeId: 'b' });
  assert.deepEqual(neighbours(col, 9), { afterId: 'b' });
  assert.deepEqual(neighbours([], 0), {});
  assert.equal(localRank(col, 1), 1536);
  assert.equal(localRank(col, 0), 0);
  assert.equal(localRank(col, 2), 3072);
});

test('optimistic move: order and completedAt follow the status kind', () => {
  let data = moveItemLocal(board(), 'c', 'todo', 0, T);
  assert.deepEqual(titles(data, 'todo'), ['c', 'a', 'b']);
  data = moveItemLocal(data, 'a', 'done', 0, T);
  assert.deepEqual(titles(data, 'done'), ['a', 'd']);
  assert.equal(data.items.find((i) => i.id === 'a').completedAt, T);
  data = moveItemLocal(data, 'd', 'doing', 0, T);
  assert.equal(data.items.find((i) => i.id === 'd').completedAt, '');
});

test('status delete moves cards to the end in order; kind change re-decides done', () => {
  const data = removeStatusLocal(board(), 'todo', 'done', T);
  assert.deepEqual(titles(data, 'done'), ['d', 'a', 'b', 'c']);
  assert.ok(data.items.filter((i) => i.statusId === 'done').every((i) => i.completedAt));
  assert.equal(statusesOf(data, 'p1').length, 2);
  const kind = setStatusKindLocal(board(), 'done', 'doing', T);
  assert.equal(kind.items.find((i) => i.id === 'd').completedAt, '');
});

test('server side effects: renumbered ranks, temp id swap', () => {
  const data = applyRenumbered(board(), [{ id: 'b', rank: 1 }]);
  assert.deepEqual(titles(data, 'todo'), ['b', 'a', 'c']);
  assert.equal(data.items.find((i) => i.id === 'b').updatedAt, 'v1', 'rank only');
  const swapped = replaceId({ ...board(), items: [item('tmp-1', 'tmp-s', 1)], statuses: [status('tmp-s', 0, 'todo')] }, 'tmp-s', 's9');
  assert.equal(swapped.statuses[0].id, 's9');
  assert.equal(swapped.items[0].statusId, 's9');
});

test('keyboard steps and column shifts', () => {
  const cols = ['todo', 'doing', 'done'];
  const sizes = { todo: 3, doing: 0, done: 1 };
  assert.deepEqual(stepSpot({ statusId: 'todo', index: 2 }, 'ArrowRight', cols, sizes), { statusId: 'doing', index: 0 });
  assert.deepEqual(stepSpot({ statusId: 'todo', index: 2 }, 'ArrowDown', cols, sizes), { statusId: 'todo', index: 3 });
  assert.deepEqual(stepSpot({ statusId: 'todo', index: 0 }, 'ArrowUp', cols, sizes), { statusId: 'todo', index: 0 });
  assert.deepEqual(stepSpot({ statusId: 'done', index: 1 }, 'ArrowRight', cols, sizes), { statusId: 'done', index: 1 });
  assert.deepEqual(shiftId(cols, 'done', -1), ['todo', 'done', 'doing']);
  assert.deepEqual(shiftId(cols, 'todo', -1), cols);
});

/* ---- The store, against a fake server ---- */

/**
 * A tiny in-memory backend following docs/planning-api.md for what the store
 * uses. `gate()` holds the next answers until released; `failNext` /
 * `conflictNext` make the next call fail.
 */
function fakeServer(initial = board()) {
  let db = structuredClone(initial);
  let version = 1;
  const calls = [];
  const holds = [];
  const server = { calls, failNext: null, conflictNext: false, held: false };
  const stamp = () => `v${(version += 1)}`;
  const find = (table, id) => db[table].find((r) => r.id === id);
  const check = (table, body) => {
    const row = find(table, body.id);
    if (!row) throw Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND' });
    if (server.conflictNext) {
      server.conflictNext = false;
      row.updatedAt = stamp();
      row.title = row.title !== undefined ? 'Changed elsewhere' : row.title;
      throw Object.assign(new Error('changed'), { status: 409, code: 'CONFLICT', current: structuredClone(row) });
    }
    if (!body.force && body.baseUpdatedAt !== row.updatedAt) {
      throw Object.assign(new Error('stale'), { status: 409, code: 'CONFLICT', current: structuredClone(row) });
    }
    return row;
  };
  const end = (statusId) => db.items.filter((i) => i.statusId === statusId).reduce((m, i) => Math.max(m, i.rank), 0) + 1024;
  let n = 0;
  const handlers = {
    'item.save': (b) => {
      if (!b.id) {
        const row = item(`i${(n += 1)}`, b.statusId, end(b.statusId), { title: b.title, updatedAt: stamp() });
        db.items.push(row);
        return { item: structuredClone(row) };
      }
      const row = check('items', b);
      Object.assign(row, Object.fromEntries(Object.entries(b).filter(([k]) => !['id', 'baseUpdatedAt', 'force'].includes(k))), { updatedAt: stamp() });
      return { item: structuredClone(row) };
    },
    'item.move': (b) => {
      const row = check('items', b);
      const col = db.items.filter((i) => i.statusId === b.statusId && i.id !== row.id).sort((x, y) => x.rank - y.rank);
      const lo = b.afterId ? find('items', b.afterId).rank : null;
      const hi = b.beforeId ? find('items', b.beforeId).rank : null;
      row.rank = lo !== null && hi !== null ? (lo + hi) / 2 : lo !== null ? lo + 1024 : hi !== null ? hi - 1024 : end(b.statusId);
      row.statusId = b.statusId;
      row.completedAt = find('statuses', b.statusId).kind === 'done' ? row.completedAt || T : '';
      row.updatedAt = stamp();
      /* Always renumber, to prove the store applies it. */
      const ordered = [...col, row].sort((x, y) => x.rank - y.rank);
      const renumbered = [];
      ordered.forEach((c, i) => {
        c.rank = (i + 1) * 1024;
        if (c !== row) renumbered.push({ id: c.id, rank: c.rank });
      });
      return { item: structuredClone(row), renumbered };
    },
    'item.delete': (b) => {
      check('items', b);
      db.items = db.items.filter((i) => i.id !== b.id);
      return { id: b.id };
    },
    'status.reorder': (b) => {
      const mine = db.statuses.filter((s) => s.projectId === b.projectId);
      if (b.statusIds.length !== mine.length) {
        throw Object.assign(new Error('changed'), { status: 409, code: 'CONFLICT', current: { statuses: structuredClone(mine) } });
      }
      b.statusIds.forEach((id, i) => { find('statuses', id).order = i; });
      return { statuses: structuredClone(b.statusIds.map((id) => find('statuses', id))) };
    },
    'status.delete': (b) => {
      check('statuses', b);
      const moved = db.items.filter((i) => i.statusId === b.id);
      moved.forEach((i, k) => { i.statusId = b.moveToStatusId; i.rank = end(b.moveToStatusId) + k; i.updatedAt = stamp(); });
      db.statuses = db.statuses.filter((s) => s.id !== b.id);
      return { id: b.id, items: structuredClone(moved) };
    },
  };
  server.transport = {
    list: async () => structuredClone(db),
    call: async (action, body) => {
      calls.push({ action, body: structuredClone(body) });
      if (server.held) await new Promise((resolve) => holds.push(resolve));
      if (server.failNext && server.failNext === action) {
        server.failNext = null;
        throw Object.assign(new Error('boom'), { status: 500, code: 'INTERNAL_ERROR' });
      }
      return handlers[action](body);
    },
  };
  server.release = () => { server.held = false; holds.splice(0).forEach((r) => r()); };
  server.edit = (fn) => { fn(db); };
  return server;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function idle(store) {
  for (let i = 0; i < 50 && store.getState().saving; i += 1) await settle();
  await settle();
}

test('store: optimistic move sends neighbours, applies renumbered ranks', async () => {
  const server = fakeServer();
  const store = new PlanningStore(server.transport, { now: () => T });
  await store.load();
  server.held = true;
  store.moveItem('c', 'todo', 1);
  assert.deepEqual(titles(store.getState().data, 'todo'), ['a', 'c', 'b'], 'shown at once');
  server.release();
  await idle(store);
  assert.deepEqual(server.calls[0], { action: 'item.move', body: { id: 'c', statusId: 'todo', afterId: 'a', beforeId: 'b', baseUpdatedAt: 'v1' } });
  const data = store.getState().data;
  assert.deepEqual(titles(data, 'todo'), ['a', 'c', 'b']);
  assert.deepEqual(data.items.filter((i) => i.statusId === 'todo').map((i) => i.rank).sort((x, y) => x - y), [1024, 2048, 3072]);
});

test('store: a quick-added card can be moved and edited before its create answers', async () => {
  const server = fakeServer();
  const store = new PlanningStore(server.transport, { now: () => T });
  await store.load();
  server.held = true;
  const temp = store.createItem('p1', 'todo', { title: 'New' });
  store.moveItem(temp, 'doing', 0);
  store.updateItem(temp, { title: 'Renamed' });
  const shown = store.getState().data.items.find((i) => i.id === temp);
  assert.equal(shown.statusId, 'doing');
  assert.equal(shown.title, 'Renamed');
  assert.equal(server.calls.length, 1, 'only the create went out; the rest wait for the real id');
  server.release();
  await idle(store);
  const real = store.resolve(temp);
  assert.notEqual(real, temp);
  assert.deepEqual(server.calls.map((c) => [c.action, c.body.id]), [['item.save', undefined], ['item.move', real], ['item.save', real]]);
  assert.ok(server.calls.slice(1).every((c) => c.body.baseUpdatedAt && c.body.baseUpdatedAt !== 'v1'), 'each base is the previous answer');
  const data = store.getState().data;
  assert.ok(!data.items.some((i) => i.id === temp), 'no temp id left in the cache');
  assert.equal(data.items.find((i) => i.id === real).title, 'Renamed');
});

test('store: a failed write rolls back, drops its dependents, refetches once, and the next base is fresh', async () => {
  const server = fakeServer();
  const errors = [];
  const store = new PlanningStore(server.transport, { now: () => T, onError: (m) => errors.push(m) });
  await store.load();
  let lists = 0;
  const list = server.transport.list;
  server.transport.list = async () => { lists += 1; return list(); };

  server.failNext = 'item.save';
  const temp = store.createItem('p1', 'todo', { title: 'Lost' });
  store.moveItem(temp, 'doing', 0);
  /* Meanwhile the row changed on another device. */
  server.edit((db) => { db.items.find((i) => i.id === 'a').updatedAt = 'v-elsewhere'; });
  store.updateItem('a', { title: 'Mine' });
  await idle(store);

  assert.deepEqual(errors, ['boom']);
  assert.equal(lists, 1, 'one refetch after the failure');
  assert.deepEqual(server.calls.map((c) => c.action), ['item.save', 'item.save'], 'the dependent move was dropped');
  assert.equal(server.calls[1].body.baseUpdatedAt, 'v-elsewhere', 'the update after the failure used the refetched base');
  const data = store.getState().data;
  assert.ok(!data.items.some((i) => i.id === temp), 'the failed create is gone');
  assert.equal(data.items.find((i) => i.id === 'a').title, 'Mine');
});

test('store: a background refresh does not overwrite a row with a pending write', async () => {
  const server = fakeServer();
  const store = new PlanningStore(server.transport, { now: () => T });
  await store.load();
  server.held = true;
  store.updateItem('a', { title: 'Pending' });
  await store.load(true);
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').title, 'Pending');
  server.release();
  await idle(store);
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').title, 'Pending');
});

test('store: an answer that lands during a refresh is not undone by that refresh', async () => {
  const server = fakeServer();
  const store = new PlanningStore(server.transport, { now: () => T });
  await store.load();
  let releaseList;
  const list = server.transport.list;
  const snapshotBefore = await list();
  server.transport.list = () => new Promise((resolve) => { releaseList = () => resolve(snapshotBefore); });
  const refreshing = store.load(true);
  store.updateItem('a', { title: 'Saved' });
  await idle(store);
  releaseList();
  await refreshing;
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').title, 'Saved');
});

test('store: 409 pauses with the current row; Use latest drops my writes for it, Keep mine forces', async () => {
  const server = fakeServer();
  const store = new PlanningStore(server.transport, { now: () => T });
  await store.load();
  server.conflictNext = true;
  store.updateItem('a', { title: 'Mine' });
  store.updateItem('a', { priority: 'high' });
  store.updateItem('b', { title: 'Other' });
  await idle(store);
  await settle();
  const { conflict } = store.getState();
  assert.equal(conflict.table, 'items');
  assert.equal(conflict.current.title, 'Changed elsewhere');
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').title, 'Mine', 'still shows mine while asking');
  store.resolveConflict('latest');
  await idle(store);
  const data = store.getState().data;
  assert.equal(data.items.find((i) => i.id === 'a').title, 'Changed elsewhere');
  assert.equal(data.items.find((i) => i.id === 'a').priority, 'none', 'the later write for that row was dropped too');
  assert.equal(data.items.find((i) => i.id === 'b').title, 'Other', 'other rows still saved');

  server.conflictNext = true;
  store.updateItem('a', { title: 'Mine again' });
  await idle(store);
  await settle();
  store.resolveConflict('mine');
  await idle(store);
  assert.equal(server.calls[server.calls.length - 1].body.force, true);
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').title, 'Mine again');
});

test('store: a refused reorder takes the server order and notices', async () => {
  const server = fakeServer();
  let noticed = 0;
  const store = new PlanningStore(server.transport, { now: () => T, onReorderRefused: () => { noticed += 1; } });
  await store.load();
  store.reorderStatuses('p1', ['done', 'todo']);
  await idle(store);
  assert.equal(noticed, 1);
  assert.equal(store.getState().conflict, null);
  assert.deepEqual(statusesOf(store.getState().data, 'p1').map((s) => s.id), ['todo', 'doing', 'done']);
});

test('store: deleting a status applies the cards the server moved', async () => {
  const server = fakeServer();
  const store = new PlanningStore(server.transport, { now: () => T });
  await store.load();
  store.deleteStatus('todo', 'done');
  assert.deepEqual(titles(store.getState().data, 'done'), ['d', 'a', 'b', 'c'], 'optimistic');
  await idle(store);
  const data = store.getState().data;
  assert.ok(!data.statuses.some((s) => s.id === 'todo'));
  assert.ok(data.items.filter((i) => i.statusId === 'done').length === 4);
  assert.ok(data.items.find((i) => i.id === 'a').updatedAt !== 'v1', 'moved cards carry the server\'s updatedAt');
});
