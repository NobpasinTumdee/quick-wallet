/*
 * Planning (Code.gs) against a fake spreadsheet in memory.
 *
 * The fake copies the Sheets behaviour that matters here: a written string
 * is re-parsed unless it starts with an apostrophe ("=1+1" becomes a formula,
 * "007" the number 7, "2026-01-01" a Date), getValues() pads to the data
 * range, and columns can be moved or inserted. On top of that it runs the
 * same testPlanningRoundTrip() the editor runs on the real sheet, so the
 * real-sheet test itself is exercised here, plus what that one cannot do
 * without touching other tables: `spent` from real linked transactions.
 *
 * Run: npm test   (node --test tests/)
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const gsPath = process.env.QW_CODE_GS || resolve(here, '../../google-apps-script/Code.gs');
/* Values made inside the vm context have that context's prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/* ---- A small fake of SpreadsheetApp ---- */

/** What Sheets does to a value typed into a cell. */
function parseTyped(value) {
  if (typeof value !== 'string') return { value };
  if (value.startsWith("'")) return { value: value.slice(1) };
  if (value.startsWith('=')) return { value: '#ERROR!', formula: value };
  if (/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value.trim())) return { value: Number(value) };
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return { value: new Date(value) };
  if (/^(true|false)$/i.test(value)) return { value: value.toLowerCase() === 'true' };
  return { value };
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = []; // rows of { value, formula }
  }
  getName() { return this.name; }
  cell(r, c) { return (this.cells[r - 1] && this.cells[r - 1][c - 1]) || { value: '' }; }
  put(r, c, v) {
    while (this.cells.length < r) this.cells.push([]);
    const row = this.cells[r - 1];
    while (row.length < c) row.push({ value: '' });
    row[c - 1] = parseTyped(v);
  }
  getLastRow() {
    for (let r = this.cells.length; r >= 1; r -= 1) {
      if (this.cells[r - 1].some((x) => x.value !== '' || x.formula)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this.cells.forEach((row) => row.forEach((x, i) => { if (x.value !== '' || x.formula) last = Math.max(last, i + 1); }));
    return last;
  }
  getMaxRows() { return Math.max(1000, this.cells.length); }
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {}
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, i) => this.put(r, i + 1, v)); }
  deleteRow(n) { this.cells.splice(n - 1, 1); }
  deleteRows(start, count) { this.cells.splice(start - 1, count); }
  insertColumnBefore(n) { this.cells.forEach((row) => { while (row.length < n - 1) row.push({ value: '' }); row.splice(n - 1, 0, { value: '' }); }); }
  /** Sheets: destinationIndex is counted before the move. */
  moveColumns(range, destinationIndex) {
    const from = range.col - 1;
    const to = destinationIndex - 1;
    const width = this.getLastColumn();
    this.cells.forEach((row) => {
      while (row.length < width) row.push({ value: '' });
      const [moved] = row.splice(from, 1);
      row.splice(to > from ? to - 1 : to, 0, moved);
    });
  }
}

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r += 1) {
      const line = [];
      for (let c = 0; c < this.cols; c += 1) line.push(this.sheet.cell(this.row + r, this.col + c).value);
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    assert.equal(values.length, this.rows, 'setValues: row count must match the range');
    values.forEach((line, r) => {
      assert.equal(line.length, this.cols, 'setValues: column count must match the range');
      line.forEach((v, c) => this.sheet.put(this.row + r, this.col + c, v));
    });
    return this;
  }
  getValue() { return this.sheet.cell(this.row, this.col).value; }
  setValue(v) { this.sheet.put(this.row, this.col, v); return this; }
  getFormula() { return this.sheet.cell(this.row, this.col).formula || ''; }
  setFontWeight() { return this; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    assert.ok(!this.getSheetByName(name), 'insertSheet: "' + name + '" already exists');
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
  getSheets() { return this.sheets.slice(); }
  getUrl() { return 'fake://sheet'; }
}

function loadGs() {
  const ss = new FakeSpreadsheet();
  const logs = [];
  const context = vm.createContext({
    console: { log() {}, error() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => randomUUID() },
    Logger: { log: (line) => logs.push(String(line)) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    }
  });
  vm.runInContext(readFileSync(gsPath, 'utf8'), context, { filename: 'Code.gs' });
  return { gs: context, ss, logs };
}

/** A sheet from SHEETS with its header row and rows written as the app would. */
function seed(gs, ss, name, rows) {
  const sheet = ss.insertSheet(name);
  const cols = gs.SHEETS[name].columns;
  sheet.getRange(1, 1, 1, cols.length).setValues([cols.map((c) => c.header)]);
  rows.forEach((row, i) => {
    sheet.getRange(i + 2, 1, 1, cols.length).setValues([cols.map((c) => gs.serialize_(row[c.key], c.type))]);
  });
  return sheet;
}

/* ---- Tests ---- */

test('testPlanningRoundTrip passes against the fake sheet and cleans up after itself', () => {
  const { gs, ss, logs } = loadGs();
  seed(gs, ss, 'Users', [{ id: 'u-real', username: 'real', createdAt: '2026-01-01T00:00:00.000Z', active: true }]);
  /* A real user's Planning rows must survive the test untouched. */
  const real = { id: 'u-real' };
  const kept = gs.planProjectsSave_(real, {}, { name: 'Real project' });
  const keptCard = gs.planItemsSave_(real, {}, { projectId: kept.project.id, title: 'Real card' }).item;
  gs.PLAN_CACHE_ = {};

  const result = gs.testPlanningRoundTrip();
  const failures = logs.filter((l) => l.startsWith('FAIL'));
  assert.deepEqual(failures, [], 'every check passes');
  assert.ok(result.passed >= 60, 'ran the full set (' + result.passed + ' checks)');
  assert.match(logs[logs.length - 1], /TOTAL: \d+ passed, 0 failed/);

  gs.PLAN_CACHE_ = {};
  const after = gs.planProjectsList_(real, {});
  assert.equal(after.projects.length, 1);
  assert.equal(after.statuses.length, 4);
  assert.deepEqual(plain(after.items.map((i) => i.id)), [keptCard.id], 'the real user\'s rows are untouched');
  for (const name of Object.keys(gs.PLAN_SHEETS_)) {
    const rows = gs.planTable_(name).rows;
    assert.ok(rows.every((r) => r.userId === 'u-real'), name + ' holds no test rows');
  }
  assert.ok(ss.getSheets().every((s) => !s.getName().startsWith('zzPlanTest_')), 'scratch sheets removed');
});

test('spent sums only the user\'s linked expenses; others are missing', () => {
  const { gs, ss } = loadGs();
  const user = { id: 'u1' };
  seed(gs, ss, 'Transactions', [
    { id: 't1', userId: 'u1', walletId: 'w', type: 'expense', amount: 100.1, category: 'Food', date: '2026-01-02' },
    { id: 't2', userId: 'u1', walletId: 'w', type: 'expense', amount: 50.205, category: 'Food', date: '2026-01-03' },
    { id: 't3', userId: 'u1', walletId: 'w', type: 'income', amount: 999, category: 'Pay', date: '2026-01-04' },
    { id: 't4', userId: 'u2', walletId: 'w', type: 'expense', amount: 7, category: 'Food', date: '2026-01-05' }
  ]);
  seed(gs, ss, 'Goals', [{ id: 'g1', userId: 'u1', title: 'Laptop' }]);
  seed(gs, ss, 'Notes', [{ id: 'n1', userId: 'u1', title: 'Plan', createdAt: 'x', updatedAt: 'x' }]);

  const p = gs.planProjectsSave_(user, {}, { name: 'Trip', linkedGoalId: 'g1' });
  assert.equal(p.project.linkedGoalMissing, false);
  const card = gs.planItemsSave_(user, {}, {
    projectId: p.project.id, title: 'Hotel', linkedTxIds: 't1,t2, t3,t4,gone', linkedNoteId: 'n1', budget: 0
  }).item;
  assert.equal(card.spent, 150.31);
  assert.deepEqual(plain(card.missingTxIds), ['t4', 'gone'], 'another user\'s transaction counts as missing');
  assert.equal(card.linkedNoteMissing, false);
  assert.equal(card.budget, 0, 'a budget of 0 is kept, not read as "no budget"');

  gs.PLAN_CACHE_ = {};
  const listed = gs.planProjectsList_(user, {}).items[0];
  assert.equal(listed.spent, 150.31);
  assert.equal(listed.budget, 0);
  const none = gs.planItemsSave_(user, {}, { projectId: p.project.id, title: 'No budget' }).item;
  assert.equal(none.budget, null);
});

test('a conflict answers 409 with the current row; other errors are unchanged', () => {
  const { gs } = loadGs();
  const conflict = JSON.parse(gs.handle_(() => { throw gs.planConflict_('This card', { id: 'c1', updatedAt: 'v2' }); }).text);
  assert.deepEqual(plain(conflict), {
    ok: false, status: 409, code: 'CONFLICT',
    error: 'This card was changed somewhere else since you loaded it',
    current: { id: 'c1', updatedAt: 'v2' }
  });
  const other = JSON.parse(gs.handle_(() => { throw gs.bad_('nope'); }).text);
  assert.deepEqual(Object.keys(other), ['ok', 'status', 'code', 'error'], 'no new field on other errors');
  assert.throws(() => gs.planWriteOnly_('GET'), (err) => err.__code === 'METHOD_NOT_ALLOWED');
});

test('Planning stays out of SHEETS, so health and setup are unchanged', () => {
  const { gs } = loadGs();
  for (const name of Object.keys(gs.PLAN_SHEETS_)) {
    assert.equal(gs.SHEETS[name], undefined, name + ' is not in SHEETS');
  }
});
