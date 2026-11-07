import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

/* A plain in-memory localStorage (fake data only). */
const items = new Map();
let failWrites = false;
globalThis.window = {
  localStorage: {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new Error('QuotaExceededError');
      items.set(k, String(v));
    },
    removeItem: (k) => items.delete(k),
  },
};

const { heightScope, rememberHeights, rememberedHeight } = await import('../src/lib/skeletonHeights.ts');

test('scope: page plus width band (phone New / Classic, tablet, desktop)', () => {
  assert.equal(heightScope('home', 390, true), 'home:pn');
  assert.equal(heightScope('home', 390, false), 'home:pc');
  assert.equal(heightScope('home', 767, true), 'home:pn');
  assert.equal(heightScope('home', 800, true), 'home:t');
  assert.equal(heightScope('home', 999, false), 'home:t');
  assert.equal(heightScope('analytics', 1000, true), 'analytics:d');
});

test('remembers heights per user and scope, to a tenth of a pixel', () => {
  rememberHeights('ua', 'home:d', { budgets: 412.63, wallets: 300 });
  assert.equal(rememberedHeight('ua', 'home:d', 'budgets'), 412.6);
  assert.equal(rememberedHeight('ua', 'home:d', 'wallets'), 300);
  assert.equal(rememberedHeight('ua', 'home:t', 'budgets'), undefined);
  assert.equal(rememberedHeight(undefined, 'home:d', 'budgets'), undefined);
  assert.ok(items.has('qw.skh.ua'));
});

test('another account never reads these, and its write removes them', () => {
  rememberHeights('ua', 'home:d', { budgets: 400 });
  assert.equal(rememberedHeight('ub', 'home:d', 'budgets'), undefined);
  rememberHeights('ub', 'home:d', { budgets: 222 });
  assert.equal(items.has('qw.skh.ua'), false);
  assert.equal(rememberedHeight('ub', 'home:d', 'budgets'), 222);
});

test('ignores changes under half a pixel, and impossible heights', () => {
  rememberHeights('uc', 'home:d', { recent: 500 });
  const before = items.get('qw.skh.uc');
  rememberHeights('uc', 'home:d', { recent: 500.3 });
  assert.equal(items.get('qw.skh.uc'), before);
  rememberHeights('uc', 'home:d', { recent: 501 });
  assert.equal(rememberedHeight('uc', 'home:d', 'recent'), 501);
  rememberHeights('uc', 'home:d', { recent: 502, bad: -4, huge: 90000, nan: Number.NaN });
  assert.equal(rememberedHeight('uc', 'home:d', 'bad'), undefined);
  assert.equal(rememberedHeight('uc', 'home:d', 'huge'), undefined);
  assert.equal(rememberedHeight('uc', 'home:d', 'nan'), undefined);
});

test('stored size stays capped (scopes, ids, characters)', () => {
  for (let s = 0; s < 40; s++) {
    const heights = {};
    for (let i = 0; i < 40; i++) heights['card-with-a-long-name-' + i] = 100 + s + i;
    rememberHeights('ud', 'page-' + s + ':d', heights);
  }
  const text = items.get('qw.skh.ud');
  assert.ok(text.length <= 4000, 'length ' + text.length);
  const stored = JSON.parse(text).s;
  assert.ok(Object.keys(stored).length <= 40);
  for (const scope of Object.values(stored)) assert.ok(Object.keys(scope).length <= 24);
  /* The newest screen is the one kept. */
  assert.equal(rememberedHeight('ud', 'page-39:d', 'card-with-a-long-name-0'), 139);
});

test('blocked storage: no throw, the session keeps its copy', () => {
  failWrites = true;
  assert.doesNotThrow(() => rememberHeights('ue', 'home:d', { inbox: 120 }));
  assert.equal(rememberedHeight('ue', 'home:d', 'inbox'), 120);
  failWrites = false;
});

test('unreadable stored value: starts empty', () => {
  items.set('qw.skh.uf', '{not json');
  assert.equal(rememberedHeight('uf', 'home:d', 'inbox'), undefined);
  items.set('qw.skh.ug', JSON.stringify({ v: 9, s: { 'home:d': { inbox: 5 } } }));
  assert.equal(rememberedHeight('ug', 'home:d', 'inbox'), undefined);
});
