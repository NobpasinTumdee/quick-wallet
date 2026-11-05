import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  SHORTCUT_NAMES,
  buildWidgetParameter,
  kwgtFormulas,
  parseWidgetParameter,
  quickLinkUrl,
  shortcutBody,
  shortcutRunUrl,
  widgetReadUrl,
} from '../src/lib/widgetSetup.ts';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(resolve(here, '../public/widgets/ios/QuickWallet.scriptable.js'), 'utf8');

/** The code between `// <shared:name>` and `// </shared:name>` in the script. */
function sharedBlock(name) {
  const match = new RegExp(`// <shared:${name}>\\n([\\s\\S]*?)// </shared:${name}>`).exec(
    script.replace(/\r\n/g, '\n'),
  );
  assert.ok(match, `QuickWallet.scriptable.js has no <shared:${name}> block`);
  return match[1];
}

const PARAMS = [
  '',
  null,
  undefined,
  'layout=medium-grid',
  'layout=MEDIUM-LIST; lang=TH',
  'layout=large&buttons=shortcut&hide=1',
  'layout=nope; hide=0; lang=fr; buttons=maybe',
  'wallets= KBank , Cash ,, w3 ; hide=yes',
  'wallets=' + Array.from({ length: 20 }, (_, i) => `w${i}`).join(','),
  'Layout = small-wallets ;\nLANG=en',
  'garbage without equals',
  '=empty-key; hide=true',
];

test('parses widget parameters', () => {
  assert.deepEqual(parseWidgetParameter('layout=medium-grid; wallets=a,b; hide=1; lang=th; buttons=shortcut'), {
    layout: 'medium-grid',
    wallets: ['a', 'b'],
    hide: true,
    lang: 'th',
    buttons: 'shortcut',
  });
  assert.deepEqual(parseWidgetParameter('layout=nope; lang=fr'), {});
  assert.equal(parseWidgetParameter('wallets=' + 'x,'.repeat(30)).wallets.length, 12);
});

test('build and parse round-trip', () => {
  const param = { layout: 'large', wallets: ['a', 'b'], hide: true, lang: 'en', buttons: 'shortcut' };
  assert.equal(buildWidgetParameter(param), 'layout=large; wallets=a,b; hide=1; lang=en; buttons=shortcut');
  assert.deepEqual(parseWidgetParameter(buildWidgetParameter(param)), param);
  assert.equal(buildWidgetParameter({ buttons: 'app' }), '');
});

test('the Scriptable copy of parseWidgetParameter behaves the same', () => {
  const context = vm.createContext({});
  vm.runInContext(`${sharedBlock('parseWidgetParameter')}\nthis.parse = parseWidgetParameter;`, context);
  for (const input of PARAMS) {
    // JSON round-trip: compare plain values, not objects from two realms.
    const fromScript = JSON.parse(JSON.stringify(context.parse(input)));
    assert.deepEqual(fromScript, parseWidgetParameter(input), `differs for ${JSON.stringify(input)}`);
  }
});

test('the Scriptable copy of SHORTCUT_NAMES is the same', () => {
  const context = vm.createContext({});
  vm.runInContext(`${sharedBlock('SHORTCUT_NAMES')}\nthis.names = SHORTCUT_NAMES;`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.names)), SHORTCUT_NAMES);
});

test('URLs', () => {
  assert.equal(
    widgetReadUrl('https://script.google.com/macros/s/X/exec', 'qw_abc', 'th'),
    'https://script.google.com/macros/s/X/exec?action=widget&token=qw_abc&lang=th',
  );
  assert.equal(quickLinkUrl('https://x.app/', 'expense'), 'https://x.app/?quick=expense');
  assert.equal(quickLinkUrl('https://x.app/', 'transfer', 'a', 'b'), 'https://x.app/?quick=transfer&wallet=a&to=b');
  assert.equal(quickLinkUrl('https://x.app/', 'income', 'a', 'b'), 'https://x.app/?quick=income&wallet=a');
  assert.equal(
    shortcutRunUrl(SHORTCUT_NAMES.expense),
    'shortcuts://run-shortcut?name=Quick%20Wallet%3A%20%E0%B8%A3%E0%B8%B2%E0%B8%A2%E0%B8%88%E0%B9%88%E0%B8%B2%E0%B8%A2',
  );
});

test('KWGT formulas and shortcut bodies', () => {
  const formulas = kwgtFormulas(2);
  assert.equal(formulas.find((f) => f.id === 'total').formula, '$wg(gv(url), json, .flat.total)$');
  assert.ok(formulas.some((f) => f.id === 'w2color'));
  assert.ok(!formulas.some((f) => f.id === 'w3name'));

  const body = JSON.parse(
    shortcutBody('qw_x', 'transfer', { amount: 'A', walletId: 'W', toWalletId: 'T', note: 'N', clientId: 'C' }),
  );
  assert.deepEqual(body, {
    action: 'widget.add',
    token: 'qw_x',
    type: 'transfer',
    amount: 'A',
    walletId: 'W',
    toWalletId: 'T',
    note: 'N',
    clientId: 'C',
  });
  const expense = JSON.parse(shortcutBody('qw_x', 'expense', { amount: 'A', walletId: 'W', toWalletId: 'T', clientId: 'C' }));
  assert.equal(expense.toWalletId, undefined);
});

test('fills the script config without touching the token', async () => {
  const { fillScriptConfig } = await import('../src/lib/widgetSetup.ts');
  const filled = fillScriptConfig(script, 'https://script.google.com/macros/s/X/exec', "https://x.app/it's/");
  assert.match(filled, /^const API_URL = 'https:\/\/script\.google\.com\/macros\/s\/X\/exec';/m);
  assert.ok(filled.includes("const APP_URL = 'https://x.app/it\\'s/';"), 'APP_URL not filled and escaped');
  assert.match(filled, /^const TOKEN = '';/m);
  // The filled script is still valid JavaScript.
  assert.doesNotThrow(() => new vm.Script(`(async () => {\n${filled}\n})`));
});
