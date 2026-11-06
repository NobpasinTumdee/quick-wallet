import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

/* The desktop layout through the shared sync core: it reads exactly what
   useCardLayout read before the core was shared. */
const { gridLayoutFormat } = await import('../src/lib/layout/layoutFormats.ts');
const { HOME_CARDS, HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE } = await import('../src/lib/layout/homeCards.ts');
const { defaultGridLayout, isDefaultGridLayout, migrateV1, sanitizeGridLayout, serializeGridLayout } = await import('../src/lib/layout/gridModel.ts');
const { sanitizeLayout } = await import('../src/lib/layout/layoutModel.ts');
const { serializeV1 } = await import('./support/v1Format.mjs');

const format = gridLayoutFormat(HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HOME_CARDS);
const v1 = (updatedAt) =>
  serializeV1({
    updatedAt,
    cards: [
      { id: 'wallets', w: 8 },
      { id: 'budgets', w: 4 },
      { id: 'breakdown', w: 4, h: 'tall' },
      { id: 'recent', w: 8 },
      { id: 'cashflow', w: 12, collapsed: true },
      { id: 'inbox', w: 6 },
      { id: 'analytics', w: 6 },
    ],
  });
const migrated = (raw) => migrateV1(sanitizeLayout(raw, HOME_CARDS));

test('desktop format: writes home-grid, reads home as an older key', () => {
  assert.equal(format.page, 'home-grid');
  assert.deepEqual(format.legacyPages, ['home']);
});

test('desktop format: nothing stored is the default', () => {
  assert.ok(isDefaultGridLayout(format.readLocal({ 'home-grid': null, home: null }), HOME_CARDS));
});

test('desktop format: a first-version copy alone is migrated', () => {
  const read = format.readLocal({ 'home-grid': null, home: v1(500) });
  assert.equal(serializeGridLayout(read), serializeGridLayout(migrated(v1(500))));
  assert.equal(read.updatedAt, 500);
});

test('desktop format: the newer copy wins, a tie keeps the current format', () => {
  const own = serializeGridLayout({ ...defaultGridLayout(HOME_CARDS), updatedAt: 700 });
  assert.equal(format.readLocal({ 'home-grid': own, home: v1(500) }).updatedAt, 700);
  assert.equal(format.readLocal({ 'home-grid': own, home: v1(900) }).updatedAt, 900);
  assert.ok(isDefaultGridLayout(format.readLocal({ 'home-grid': own, home: v1(700) }), HOME_CARDS));
});

test('desktop format: server copies are read in their own format and take the server time', () => {
  const own = serializeGridLayout({ ...defaultGridLayout(HOME_CARDS), updatedAt: 1 });
  const a = format.fromRemote({ key: 'layout.home-grid', value: own, updatedAt: 1234 }, 'home-grid');
  assert.equal(serializeGridLayout(a), serializeGridLayout({ ...sanitizeGridLayout(own, HOME_CARDS), updatedAt: 1234 }));
  const b = format.fromRemote({ key: 'layout.home', value: v1(5), updatedAt: 999 }, 'home');
  assert.equal(serializeGridLayout(b), serializeGridLayout({ ...migrated(v1(5)), updatedAt: 999 }));
});
