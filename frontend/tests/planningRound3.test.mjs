import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const ms = await import('../src/lib/planning/milestones.ts');
const { dueSoonItems } = await import('../src/lib/planning/dueSoon.ts');
const { PlanningStore } = await import('../src/lib/planning/store.ts');

const plain = (v) => JSON.parse(JSON.stringify(v));
const T = '2026-11-21T10:00:00.000Z';
const item = (id, extra = {}) => ({
  id, projectId: 'p1', statusId: 'todo', milestoneId: '', title: id, description: '', priority: 'none', labels: [],
  startDate: '', dueDate: '', completedAt: '', rank: 1024, checklist: [], budget: null, linkedTxIds: [], linkedNoteId: '',
  archivedAt: '', createdAt: T, updatedAt: 'v1', spent: 0, missingTxIds: [], linkedNoteMissing: false, ...extra,
});
const milestone = (id, extra = {}) => ({
  id, projectId: 'p1', title: id, description: '', dueDate: '', state: 'open', order: 0, createdAt: T, updatedAt: 'v1', ...extra,
});
const project = (id, extra = {}) => ({
  id, name: id, description: '', color: '', icon: '', state: 'active', startDate: '', dueDate: '', linkedGoalId: '',
  sortOrder: 0, createdAt: T, updatedAt: 'v1', linkedGoalMissing: false, ...extra,
});
const statuses = [
  { id: 'todo', projectId: 'p1', name: 'To do', order: 0, kind: 'todo' },
  { id: 'done', projectId: 'p1', name: 'Done', order: 1, kind: 'done' },
  { id: 'q-todo', projectId: 'p2', name: 'To do', order: 0, kind: 'todo' },
];

test('milestone progress: done ÷ cards on the board; archived cards never count', () => {
  const data = {
    projects: [project('p1')], statuses, milestones: [milestone('m1')],
    items: [
      item('a', { milestoneId: 'm1', statusId: 'done' }),
      item('b', { milestoneId: 'm1' }),
      item('c', { milestoneId: 'm1', statusId: 'done', archivedAt: T }),
      item('d'),
    ],
  };
  assert.deepEqual(ms.milestoneProgress(data, 'm1'), { done: 1, total: 2, percent: 50 });
  assert.deepEqual(ms.milestoneProgress(data, 'm2'), { done: 0, total: 0, percent: null });
  assert.equal(ms.milestoneAllDone(data, data.milestones[0]), false);
  const allDone = { ...data, items: data.items.map((i) => (i.id === 'b' ? { ...i, statusId: 'done' } : i)) };
  assert.equal(ms.milestoneAllDone(allDone, data.milestones[0]), true);
  assert.equal(ms.milestoneAllDone(allDone, { ...data.milestones[0], state: 'closed' }), false);
  assert.equal(ms.milestoneAllDone({ ...data, items: [] }, data.milestones[0]), false);
});

test('milestones list: open and closed apart, each by order (then due date)', () => {
  const data = {
    projects: [], statuses: [], items: [],
    milestones: [
      milestone('c', { order: 2 }), milestone('a', { order: 0 }), milestone('x', { order: 1, state: 'closed' }),
      milestone('b', { order: 1, dueDate: '2026-12-01' }), milestone('b0', { order: 1 }), milestone('other', { projectId: 'p2' }),
    ],
  };
  const { open, closed } = ms.milestonesOf(data, 'p1');
  assert.deepEqual(open.map((m) => m.id), ['a', 'b', 'b0', 'c']);
  assert.deepEqual(closed.map((m) => m.id), ['x']);
});

test('milestone reorder: one order value between the new neighbours', () => {
  const list = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }, { id: 'd', order: 3 }];
  assert.equal(ms.reorderValue(list, 'c', 1), 0.5); // between a and b
  assert.equal(ms.reorderValue(list, 'a', 3), 4); // after d
  assert.equal(ms.reorderValue(list, 'd', 0), -1); // before a
  assert.equal(ms.reorderValue(list, 'b', 1), null); // not moved
  assert.equal(ms.reorderValue(list, 'zz', 0), null);
  assert.equal(ms.reorderValue([{ id: 'a', order: 5 }], 'a', 0), null);
  const same = [{ id: 'a', order: 1 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }];
  const v = ms.reorderValue(same, 'c', 1);
  assert.ok(v > 1 && v < 2);
});

test('budget totals: cards on the board with a budget; 0 counts; archived and no-budget never count', () => {
  const data = {
    projects: [], statuses: [], milestones: [],
    items: [
      item('a', { budget: 1000, spent: 250.5 }),
      item('b', { budget: 0, spent: 40 }),
      item('c', { budget: null, spent: 999 }),
      item('d', { budget: 5000, spent: 5000, archivedAt: T }),
      item('e', { projectId: 'p2', budget: 70, spent: 0 }),
    ],
  };
  assert.deepEqual(ms.projectBudget(data, 'p1'), { has: true, budget: 1000, spent: 290.5, remaining: 709.5, over: false });
  const none = ms.projectBudget({ ...data, items: [item('c')] }, 'p1');
  assert.equal(none.has, false);
  const over = ms.projectBudget({ ...data, items: [item('a', { budget: 100, spent: 100.1 })] }, 'p1');
  assert.equal(over.over, true);
  assert.equal(over.remaining, -0.1);
  assert.deepEqual(ms.projectBudget({ ...data, items: [item('z', { budget: 0 })] }, 'p1'), { has: true, budget: 0, spent: 0, remaining: 0, over: false });
});

test('due soon: overdue or within 7 days of local today; not done, not archived, active projects only; sorted', () => {
  const today = '2026-11-21';
  const data = {
    projects: [project('p1', { sortOrder: 1 }), project('p2', { sortOrder: 0 }), project('old', { state: 'archived' })],
    statuses: [...statuses, { id: 'o-todo', projectId: 'old', name: 'To do', order: 0, kind: 'todo' }],
    milestones: [],
    items: [
      item('soon', { dueDate: '2026-11-25' }),
      item('edge', { dueDate: '2026-11-28' }), // today + 7: in
      item('late', { dueDate: '2026-11-29' }), // today + 8: out
      item('over', { dueDate: '2026-11-02' }),
      item('today', { dueDate: '2026-11-21' }),
      item('doneOne', { dueDate: '2026-11-20', statusId: 'done' }),
      item('archived', { dueDate: '2026-11-20', archivedAt: T }),
      item('noDate'),
      item('oldProject', { projectId: 'old', statusId: 'o-todo', dueDate: '2026-11-20' }),
      item('p2same', { projectId: 'p2', statusId: 'q-todo', dueDate: '2026-11-25' }),
    ],
  };
  const rows = dueSoonItems(data, today);
  assert.deepEqual(rows.map((r) => r.item.id), ['over', 'today', 'p2same', 'soon', 'edge']);
  assert.deepEqual(rows.map((r) => r.days), [-19, 0, 4, 4, 7]);
  assert.equal(rows[2].project.id, 'p2');
  // Local "today" decides: the same card a day later is overdue.
  assert.equal(dueSoonItems(data, '2026-11-22').find((r) => r.item.id === 'today').days, -1);
});

/* ---- Store: milestone edits ---- */

function server() {
  const calls = [];
  let version = 1;
  const db = {
    projects: [project('p1')],
    statuses,
    milestones: [milestone('m1', { order: 0 }), milestone('m2', { order: 1 })],
    items: [item('a', { milestoneId: 'm1' }), item('b', { milestoneId: 'm1', archivedAt: T }), item('c')],
  };
  const s = { calls, held: false };
  const holds = [];
  s.transport = {
    list: async (opts) => {
      calls.push({ action: 'list', body: opts ?? {} });
      return plain({ ...db, items: opts?.includeArchived ? db.items : db.items.filter((i) => !i.archivedAt) });
    },
    call: async (action, body) => {
      calls.push({ action, body: plain(body) });
      if (s.held) await new Promise((r) => holds.push(r));
      if (action === 'milestone.delete') {
        db.milestones = db.milestones.filter((m) => m.id !== body.id);
        const cleared = db.items.filter((i) => i.milestoneId === body.id);
        cleared.forEach((i) => Object.assign(i, { milestoneId: '', updatedAt: `v${(version += 1)}` }));
        return { id: body.id, items: plain(cleared) };
      }
      if (action === 'milestone.save') {
        const row = db.milestones.find((m) => m.id === body.id);
        Object.assign(row, Object.fromEntries(Object.entries(body).filter(([k]) => !['id', 'baseUpdatedAt', 'force'].includes(k))), { updatedAt: `v${(version += 1)}` });
        return { milestone: plain(row) };
      }
      throw new Error(`unexpected ${action}`);
    },
  };
  s.release = () => { s.held = false; holds.splice(0).forEach((r) => r()); };
  return s;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
async function idle(store) {
  for (let i = 0; i < 50 && store.getState().saving; i += 1) await settle();
  await settle();
}

test('milestone edit: sent with its base; one-field edits merge while waiting, never into the one in flight', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T });
  await store.load();
  s.held = true;
  store.updateMilestone('m1', { title: 'One' }); // sent, held
  store.updateMilestone('m1', { title: 'Two' }); // waits
  store.updateMilestone('m1', { title: 'Three' }); // merges into Two
  store.updateMilestone('m1', { dueDate: '2026-12-01' }); // another field: its own write
  assert.equal(store.getState().data.milestones.find((m) => m.id === 'm1').title, 'Three');
  s.release();
  await idle(store);
  const saves = s.calls.filter((c) => c.action === 'milestone.save').map((c) => c.body);
  assert.deepEqual(saves.map((b) => b.title ?? b.dueDate), ['One', 'Three', '2026-12-01']);
  assert.ok(saves.every((b) => b.baseUpdatedAt));
});

test('milestone delete: gone at once, its cards (archived too) keep going with no milestone', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T });
  await store.load();
  await store.loadArchived();
  store.deleteMilestone('m1');
  let data = store.getState().data;
  assert.deepEqual(data.milestones.map((m) => m.id), ['m2']);
  assert.deepEqual(data.items.filter((i) => i.milestoneId === 'm1'), []);
  assert.equal(data.items.length, 3);
  await idle(store);
  data = store.getState().data;
  assert.deepEqual(data.items.map((i) => i.milestoneId), ['', '', '']);
  assert.equal(s.calls.at(-1).action, 'milestone.delete');
  assert.equal(s.calls.at(-1).body.baseUpdatedAt, 'v1');
});
