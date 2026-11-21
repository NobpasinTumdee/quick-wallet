import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const filters = await import('../src/lib/planning/filters.ts');
const fields = await import('../src/lib/planning/cardFields.ts');
const { PlanningStore } = await import('../src/lib/planning/store.ts');

const plain = (v) => JSON.parse(JSON.stringify(v));
const T = '2026-11-21T10:00:00.000Z';
const item = (id, extra = {}) => ({
  id, projectId: 'p1', statusId: 'todo', milestoneId: '', title: id, description: '', priority: 'none', labels: [],
  startDate: '', dueDate: '', completedAt: '', rank: 1024, checklist: [], budget: null, linkedTxIds: [], linkedNoteId: '',
  archivedAt: '', createdAt: T, updatedAt: 'v1', spent: 0, missingTxIds: [], linkedNoteMissing: false, ...extra,
});
const ctx = { doneStatusIds: new Set(['done']), today: '2026-11-21' }; // a Saturday

/* ---- Search and filters ---- */

test('search: every word, across title, description, labels and checklist; case and width folded', () => {
  const card = item('a', {
    title: 'Book flights', description: 'Window seat **please**', labels: ['Travel'],
    checklist: [{ id: 'c1', text: 'Passport ready', done: false }],
  });
  assert.ok(filters.matchesSearch(card, 'book'));
  assert.ok(filters.matchesSearch(card, 'WINDOW travel'));
  assert.ok(filters.matchesSearch(card, 'passport'));
  assert.ok(filters.matchesSearch(card, '  '));
  assert.ok(!filters.matchesSearch(card, 'book hotel'));
  assert.ok(filters.matchesSearch(item('th', { title: 'จองตั๋วเครื่องบิน' }), 'ตั๋ว'));
});

test('filters: OR inside a group, AND between groups; hide done; no milestone', () => {
  const f = { ...filters.EMPTY_FILTERS, labels: ['travel', 'money'], priorities: ['high'] };
  assert.ok(filters.matchesFilters(item('a', { labels: ['Money'], priority: 'high' }), f, ctx));
  assert.ok(!filters.matchesFilters(item('b', { labels: ['Money'], priority: 'low' }), f, ctx));
  assert.ok(!filters.matchesFilters(item('c', { labels: ['food'], priority: 'high' }), f, ctx));
  const hide = { ...filters.EMPTY_FILTERS, hideDone: true };
  assert.ok(!filters.matchesFilters(item('d', { statusId: 'done' }), hide, ctx));
  const noMs = { ...filters.EMPTY_FILTERS, milestones: [''] };
  assert.ok(filters.matchesFilters(item('e'), noMs, ctx));
  assert.ok(!filters.matchesFilters(item('f', { milestoneId: 'm1' }), noMs, ctx));
  assert.equal(filters.activeFilterCount({ ...f, search: 'x', hideDone: true }), 5);
});

test('due filters: overdue (not done), this week Mon–Sun, next 7 days, no date', () => {
  assert.deepEqual(filters.weekRange('2026-11-21'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(filters.weekRange('2026-11-16'), { from: '2026-11-16', to: '2026-11-22' });
  const d = (due, statusId = 'todo') => item('x', { dueDate: due, statusId });
  const on = (rules) => ({ ...filters.EMPTY_FILTERS, due: rules });
  assert.ok(filters.matchesFilters(d('2026-11-20'), on(['overdue']), ctx));
  assert.ok(!filters.matchesFilters(d('2026-11-20', 'done'), on(['overdue']), ctx));
  assert.ok(filters.matchesFilters(d('2026-11-16'), on(['week']), ctx));
  assert.ok(!filters.matchesFilters(d('2026-11-23'), on(['week']), ctx));
  assert.ok(filters.matchesFilters(d('2026-11-28'), on(['next7']), ctx));
  assert.ok(!filters.matchesFilters(d('2026-11-29'), on(['next7']), ctx));
  assert.ok(filters.matchesFilters(d(''), on(['none']), ctx));
  assert.ok(filters.matchesFilters(d(''), on(['overdue', 'none']), ctx));
});

test('filtered drop: lands after the visible card above, before the first visible at the top', () => {
  // whole column a b c d e; visible a c e (b, d hidden); moved card already removed.
  const full = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const visible = ['a', 'c', 'e'].map((id) => ({ id }));
  assert.equal(filters.fullDropIndex(full, visible, 0), 0); // before a
  assert.equal(filters.fullDropIndex(full, visible, 1), 1); // right after a, b stays below
  assert.equal(filters.fullDropIndex(full, visible, 2), 3); // right after c, d stays below
  assert.equal(filters.fullDropIndex(full, visible, 3), 5); // after e, at the end
  // the first visible card is not the first in the column: top goes right before it
  assert.equal(filters.fullDropIndex(full, ['c', 'e'].map((id) => ({ id })), 0), 2);
  assert.equal(filters.fullDropIndex(full, [], 0), 5);
  assert.equal(filters.fullDropIndex([], [], 0), 0);
});

test('sorting: empties last both ways, ties by status order then rank', () => {
  const statusOrder = new Map([['todo', 0], ['doing', 1], ['done', 2]]);
  const rows = [
    item('a', { dueDate: '2026-12-01', rank: 1 }),
    item('b', { dueDate: '', rank: 2 }),
    item('c', { dueDate: '2026-11-25', statusId: 'doing', rank: 1 }),
    item('d', { dueDate: '2026-11-25', rank: 3 }),
  ];
  const ids = (key, dir) => rows.slice().sort(filters.compareItems(key, dir, { statusOrder })).map((r) => r.id);
  assert.deepEqual(ids('due', 'asc'), ['d', 'c', 'a', 'b']);
  assert.deepEqual(ids('due', 'desc'), ['a', 'd', 'c', 'b']);
  assert.deepEqual(ids('default', 'asc'), ['a', 'b', 'd', 'c']);
  const pr = [item('l', { priority: 'low' }), item('u', { priority: 'urgent' }), item('n')];
  assert.deepEqual(pr.sort(filters.compareItems('priority', 'asc', { statusOrder })).map((r) => r.id), ['u', 'l', 'n']);
  const money = [item('x', { budget: null }), item('y', { budget: 0 }), item('z', { budget: 500 })];
  assert.deepEqual(money.sort(filters.compareItems('budget', 'desc', { statusOrder })).map((r) => r.id), ['z', 'y', 'x']);
});

test('project labels: most used first, case-insensitive', () => {
  const data = { projects: [], statuses: [], milestones: [], items: [item('a', { labels: ['Travel', 'money'] }), item('b', { labels: ['travel'] }), item('c', { projectId: 'p2', labels: ['other'] })] };
  assert.deepEqual(filters.projectLabels(data, 'p1'), ['Travel', 'money']);
});

/* ---- Card fields ---- */

test('labels: trimmed, no commas, 30 chars, 20 labels, no duplicates ignoring case', () => {
  assert.equal(fields.normalizeLabel('  a,b   c '), 'a b c');
  assert.deepEqual(fields.addLabel(['Travel'], 'travel'), { labels: ['Travel'], error: 'duplicate' });
  assert.equal(fields.addLabel([], ' , ').error, 'empty');
  assert.equal(fields.addLabel([], 'x'.repeat(31)).error, 'tooLong');
  assert.deepEqual(fields.addLabel([], 'x'.repeat(30)).labels, ['x'.repeat(30)]);
  const twenty = Array.from({ length: 20 }, (_, i) => `l${i}`);
  assert.equal(fields.addLabel(twenty, 'new').error, 'tooMany');
  assert.deepEqual(fields.removeLabel(['A', 'b'], 'a'), ['b']);
  assert.deepEqual(fields.labelSuggestions(['Travel', 'Money', 'trip'], ['money'], 'tr'), ['Travel', 'trip']);
});

test('checklist: add within limits, edit, toggle, move up/down and to an index', () => {
  let list = fields.checklistAdd([], ' one ', 'a');
  list = fields.checklistAdd(list, 'two', 'b');
  list = fields.checklistAdd(list, 'three', 'c');
  assert.deepEqual(list.map((c) => c.text), ['one', 'two', 'three']);
  assert.equal(fields.checklistAdd(list, '   '), null);
  assert.equal(fields.checklistAdd(list, 'x'.repeat(400), 'd').at(-1).text.length, 300);
  const full = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, text: 't', done: false }));
  assert.equal(fields.checklistAdd(full, 'more'), null);
  assert.deepEqual(fields.checklistMove(list, 'c', -1).map((c) => c.id), ['a', 'c', 'b']);
  assert.equal(fields.checklistMove(list, 'a', -1), list, 'cannot move above the top');
  assert.deepEqual(fields.checklistMoveTo(list, 'a', 2).map((c) => c.id), ['b', 'c', 'a']);
  assert.equal(fields.checklistToggle(list, 'b')[1].done, true);
  assert.equal(fields.checklistEdit(list, 'b', 'two\nlines')[1].text, 'two lines');
  assert.deepEqual(fields.checklistRemove(list, 'b').map((c) => c.id), ['a', 'c']);
  assert.match(fields.newChecklistId(), /^[A-Za-z0-9_-]{1,40}$/);
});

test('budget: empty is none, 0 is a budget, remaining and over', () => {
  assert.deepEqual(fields.budgetFromInput(''), { value: null });
  assert.deepEqual(fields.budgetFromInput('0'), { value: 0 });
  assert.deepEqual(fields.budgetFromInput('12.345'), { value: 12.35 });
  assert.equal(fields.budgetFromInput('-1').error, 'negative');
  assert.equal(fields.budgetFromInput('2000000000000').error, 'tooBig');
  assert.equal(fields.budgetLeft(null, 50), null);
  assert.deepEqual(fields.budgetLeft(100, 30), { remaining: 70, over: false, percent: 30 });
  assert.deepEqual(fields.budgetLeft(0, 5), { remaining: -5, over: true, percent: 100 });
  assert.deepEqual(fields.budgetLeft(0, 0), { remaining: 0, over: false, percent: 0 });
  assert.ok(fields.datesInOrder('2026-11-01', '2026-11-01'));
  assert.ok(!fields.datesInOrder('2026-11-02', '2026-11-01'));
  assert.ok(fields.datesInOrder('', '2026-11-01'));
});

/* ---- Store: coalescing, outcomes, archived ---- */

function server() {
  const calls = [];
  let version = 1;
  const holds = [];
  const db = {
    projects: [{ id: 'p1', name: 'P', updatedAt: 'v1' }],
    statuses: [{ id: 'todo', projectId: 'p1', name: 'To do', order: 0, kind: 'todo', updatedAt: 'v1' }],
    milestones: [],
    items: [item('a'), item('z', { archivedAt: T })],
  };
  const s = { calls, held: false, failNext: null };
  s.transport = {
    list: async (opts) => {
      calls.push({ action: 'list', body: opts ?? {} });
      return plain({ ...db, items: opts?.includeArchived ? db.items : db.items.filter((i) => !i.archivedAt) });
    },
    call: async (action, body) => {
      calls.push({ action, body: plain(body) });
      if (s.held) await new Promise((r) => holds.push(r));
      if (s.failNext === action) {
        s.failNext = null;
        throw Object.assign(new Error('boom'), { status: 500 });
      }
      if (action === 'milestone.save') return { milestone: { id: 'm9', projectId: 'p1', title: body.title, description: '', dueDate: body.dueDate ?? '', state: 'open', order: 0, createdAt: T, updatedAt: 'v9' } };
      const row = db.items.find((i) => i.id === body.id);
      Object.assign(row, Object.fromEntries(Object.entries(body).filter(([k]) => !['id', 'baseUpdatedAt', 'force'].includes(k))), { updatedAt: `v${(version += 1)}` });
      return { item: plain(row) };
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

test('coalescing: one field merges while waiting; never title into description; never into the write in flight', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T });
  await store.load();
  s.held = true;
  store.updateItem('a', { description: 'd1' }); // goes out at once (in flight)
  store.updateItem('a', { description: 'd2' }); // waits
  store.updateItem('a', { description: 'd3' }); // merges into d2
  store.updateItem('a', { title: 'T1' }); // its own write
  store.updateItem('a', { checklist: [{ id: 'c1', text: 'x', done: false }] });
  store.updateItem('a', { checklist: [{ id: 'c1', text: 'x', done: true }] }); // whole list, merged
  assert.equal(store.getState().saving, 4);
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').description, 'd3');
  s.release();
  await idle(store);
  const writes = s.calls.filter((c) => c.action === 'item.save').map((c) => Object.keys(c.body).filter((k) => k !== 'id' && k !== 'baseUpdatedAt').join('+') + '=' + JSON.stringify(c.body.description ?? c.body.title ?? c.body.checklist?.[0]?.done));
  assert.deepEqual(writes, ['description="d1"', 'description="d3"', 'title="T1"', 'checklist=true']);
});

test('outcomes: saved, failed (sheet keeps its draft), dropped (dependent of a failed create)', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T, onError: () => {} });
  await store.load();
  const seen = [];
  store.updateItem('a', { description: 'ok' }, { settled: (o) => seen.push(`ok:${o}`) });
  await idle(store);
  s.failNext = 'item.save';
  store.updateItem('a', { description: 'bad' }, { settled: (o) => seen.push(`bad:${o}`) });
  await idle(store);
  assert.deepEqual(seen, ['ok:saved', 'bad:failed']);
  assert.ok(!store.hasUnsent());
});

test('archived: read only once asked for, then with every read', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T });
  await store.load();
  assert.ok(!store.getState().data.items.some((i) => i.id === 'z'));
  assert.equal(store.getState().archivedLoaded, false);
  await store.loadArchived();
  assert.ok(store.getState().data.items.some((i) => i.id === 'z'));
  assert.equal(store.getState().archivedLoaded, true);
  await store.load(true);
  assert.deepEqual(s.calls.filter((c) => c.action === 'list').map((c) => Boolean(c.body.includeArchived)), [false, true, true]);
});

test('milestone: created with a temp id that resolves', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T });
  await store.load();
  const temp = store.createMilestone('p1', { title: 'Phase 1', dueDate: '2026-12-01' });
  assert.equal(store.getState().data.milestones[0].title, 'Phase 1');
  await idle(store);
  assert.equal(store.resolve(temp), 'm9');
  assert.equal(store.getState().data.milestones[0].id, 'm9');
});

test('milestone picked right after it was created: the card is sent its real id', async () => {
  const s = server();
  const store = new PlanningStore(s.transport, { now: () => T });
  await store.load();
  s.held = true;
  const temp = store.createMilestone('p1', { title: 'Unpack' });
  store.updateItem('a', { milestoneId: temp });
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').milestoneId, temp);
  s.release();
  await idle(store);
  const save = s.calls.find((c) => c.action === 'item.save');
  assert.equal(save.body.milestoneId, 'm9');
  assert.equal(store.getState().data.items.find((i) => i.id === 'a').milestoneId, 'm9');
});
