import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { unified } = await import('unified');
const remarkParse = (await import('remark-parse')).default;
const remarkGfm = (await import('remark-gfm')).default;
const remarkBreaks = (await import('remark-breaks')).default;
const remarkRehype = (await import('remark-rehype')).default;
const { remarkNoteTokens, remarkNoteExtras, remarkHeadingsToc } = await import('../src/lib/noteSyntax.ts');
const edit = await import('../src/lib/markdownEdit.ts');
const { stripMarkdown } = await import('../src/lib/notes.ts');
const { countWords } = await import('../src/lib/noteStats.ts');
const { noteLinkId } = await import('../src/lib/noteFormat.ts');

/* The same plugin order MarkdownView uses, minus embeds and spacing. */
function noteSyntax() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: ['htmlFlow', 'htmlText', 'setextUnderline', 'codeIndented'] } });
}

function render(md) {
  const processor = unified()
    .use(remarkParse)
    .use(noteSyntax)
    .use(remarkNoteTokens)
    .use(remarkGfm)
    .use(remarkNoteExtras, { untitledToggle: 'Toggle' })
    .use(remarkBreaks)
    .use(remarkHeadingsToc)
    .use(remarkRehype);
  const hast = processor.runSync(processor.parse(md), md);
  const html = (node) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return (node.children ?? []).map(html).join('');
    const p = node.properties;
    const cls = p.className ? `.${[].concat(p.className).join('.')}` : '';
    const id = p.id ? `#${p.id}` : '';
    const callout = p.dataCalloutTitle ? `=${p.dataCalloutTitle}` : '';
    return `<${node.tagName}${cls}${id}${callout}>${node.children.map(html).join('')}</${node.tagName}>`;
  };
  return html(hast).replace(/\n/g, '');
}

const cases = [
  ['highlight', 'a ==hi== b', '<p>a <mark.md-hl.md-hl-yellow>hi</mark> b</p>'],
  ['highlight colour', '==[green]go==', '<p><mark.md-hl.md-hl-green>go</mark></p>'],
  ['unknown highlight colour is text', '==[teal]no==', '<p>==[teal]no==</p>'],
  ['highlight inside a word stays text', 'x==y==z', '<p>x==y==z</p>'],
  ['three equals stay text', 'a===b===c', '<p>a===b===c</p>'],
  ['C++ stays text', 'C++ and C++', '<p>C++ and C++</p>'],
  ['underline', 'a ++u++ b', '<p>a <u.md-u>u</u> b</p>'],
  ['nested bold in highlight', '==**b** h==', '<p><mark.md-hl.md-hl-yellow><strong>b</strong> h</mark></p>'],
  ['text colour', '[t]{red}', '<p><span.md-c.md-c-red>t</span></p>'],
  ['text colour around bold', '[**b** x]{blue}', '<p><span.md-c.md-c-blue><strong>b</strong> x</span></p>'],
  ['unknown colour is text', '[x]{teal} [y]{Red}', '<p>[x]{teal} [y]{Red}</p>'],
  ['escaped bracket is text', '\\[x]{red}', '<p>[x]{red}</p>'],
  ['link untouched', '[a](https://x.y)', '<p><a>a</a></p>'],
  ['inline code is literal', '`==x== ++y++ [z]{red}`', '<p><code>==x== ++y++ [z]{red}</code></p>'],
  ['code block is literal', '```\n==x==\n:::toggle T\n> [!NOTE]\n:::\n```', '<pre><code>==x==:::toggle T> [!NOTE]:::</code></pre>'],
  ['callout', '> [!NOTE]\n> Body', '<div.md-callout.md-callout-note><div=note></div><p>Body</p></div>'],
  ['callout lower case', '> [!warning]\n> w', '<div.md-callout.md-callout-warning><div=warning></div><p>w</p></div>'],
  ['unknown callout is a quote', '> [!NOPE]\n> x', '<blockquote><p>[!NOPE]<br></br>x</p></blockquote>'],
  ['toggle', ':::toggle T\nbody\n:::', '<details.md-toggle><summary.md-toggle-title>T</summary><div.md-toggle-body><p>body</p></div></details>'],
  ['toggle with list', ':::toggle T\n- a\n:::\nafter', '<details.md-toggle><summary.md-toggle-title>T</summary><div.md-toggle-body><ul><li>a</li></ul></div></details><p>after</p>'],
  ['untitled toggle', ':::toggle\nx\n:::', '<details.md-toggle><summary.md-toggle-title>Toggle</summary><div.md-toggle-body><p>x</p></div></details>'],
  ['nested toggles', ':::toggle A\n:::toggle B\nx\n:::\n:::', '<details.md-toggle><summary.md-toggle-title>A</summary><div.md-toggle-body><details.md-toggle><summary.md-toggle-title>B</summary><div.md-toggle-body><p>x</p></div></details></div></details>'],
  ['unclosed toggle is text', ':::toggle T\nx', '<p>:::toggle T</p><p>x</p>'],
  ['stray fence is text', ':::', '<p>:::</p>'],
  ['other ::: is text', ':::note x', '<p>:::note x</p>'],
  ['heading ids', '# A\n## B\n## B', '<nav></nav><h1#h-a>A</h1><h2#h-b>B</h2><h2#h-b-2>B</h2>'],
  ['thai heading id', '# สรุป\n# ข\n# ค', '<nav></nav><h1#h-สรุป>สรุป</h1><h1#h-ข>ข</h1><h1#h-ค>ค</h1>'],
  ['no contents under three', '# A\n# B', '<h1#h-a>A</h1><h1#h-b>B</h1>'],
];

for (const [name, md, expected] of cases) {
  test(`render: ${name}`, () => assert.equal(render(md), expected));
}

test('old Markdown renders as before', () => {
  assert.equal(render('**b** *i* ~~s~~ `c`'), '<p><strong>b</strong> <em>i</em> <del>s</del> <code>c</code></p>');
  assert.equal(render('- [ ] task'), '<ul.contains-task-list><li.task-list-item><input></input> task</li></ul>');
  assert.equal(render('> quote'), '<blockquote><p>quote</p></blockquote>');
});

test('note links: only the exact internal pattern', () => {
  assert.equal(noteLinkId('#/notes?id=abc-123'), 'abc-123');
  assert.equal(noteLinkId('#/notes?id=abc&x=1'), null);
  assert.equal(noteLinkId('#/wallets'), null);
  assert.equal(noteLinkId('javascript:alert(1)//#/notes?id=a'), null);
});

/* ---- Editing ---- */

const at = (value, start, end = start) => ({ value, start, end });
const run = (state, result) => edit.applyTextEdit(state.value, result);

test('colour wraps, swaps and removes without nesting', () => {
  const s = at('say hello now', 4, 9);
  const red = edit.applyColor(s, 'color', 'red', 'text');
  assert.equal(run(s, red), 'say [hello]{red} now');
  const s2 = at(run(s, red), red.selStart, red.selEnd);
  const blue = edit.applyColor(s2, 'color', 'blue', 'text');
  assert.equal(run(s2, blue), 'say [hello]{blue} now');
  const s3 = at(run(s2, blue), blue.selStart, blue.selEnd);
  assert.equal(run(s3, edit.applyColor(s3, 'color', null, 'text')), 'say hello now');
});

test('highlight: yellow is bare, others tagged, swap replaces', () => {
  const s = at('a word b', 2, 6);
  const y = edit.applyColor(s, 'highlight', 'yellow', 'x');
  assert.equal(run(s, y), 'a ==word== b');
  const s2 = at(run(s, y), y.selStart, y.selEnd);
  const g = edit.applyColor(s2, 'highlight', 'green', 'x');
  assert.equal(run(s2, g), 'a ==[green]word== b');
  assert.equal(edit.applyTextEdit(run(s2, g), edit.applyColor(at(run(s2, g), g.selStart, g.selEnd), 'highlight', null, 'x')), 'a word b');
});

test('colour with no selection inserts a selected placeholder', () => {
  const s = at('ab', 1);
  const e = edit.applyColor(s, 'color', 'pink', 'text');
  assert.equal(run(s, e), 'a[text]{pink}b');
  assert.equal(run(s, e).slice(e.selStart, e.selEnd), 'text');
});

test('underline toggles', () => {
  const s = at('x', 0, 1);
  const on = edit.toggleInline(s, 'underline', 'u');
  assert.equal(run(s, on), '++x++');
  const s2 = at('++x++', on.selStart, on.selEnd);
  assert.equal(run(s2, edit.toggleInline(s2, 'underline', 'u')), 'x');
});

test('clear formatting strips every inline mark, keeps line prefixes', () => {
  const value = '- **b** *i* ~~s~~ `c` ++u++ ==h== ==[red]r== [t]{blue}';
  const s = at(value, 0, value.length);
  assert.equal(run(s, edit.clearFormatting(s)), '- b i s c u h r t');
  const word = '**bold**';
  const inside = at(word, 2, 6);
  assert.equal(run(inside, edit.clearFormatting(inside)), 'bold');
});

test('callout wraps lines, swaps type, keeps text after it out', () => {
  const s = at('one\ntwo\nnext', 0, 7);
  const e = edit.insertCallout(s, 'tip', 'x');
  assert.equal(run(s, e), '> [!TIP]\n> one\n> two\n\nnext');
  const v = run(s, e);
  const swap = edit.insertCallout(at(v, 12), 'warning', 'x');
  assert.equal(edit.applyTextEdit(v, swap), '> [!WARNING]\n> one\n> two\n\nnext');
  const empty = edit.insertCallout(at('', 0), 'note', 'Text');
  assert.equal(empty.text, '> [!NOTE]\n> Text');
});

test('toggle: first line is the title', () => {
  const s = at('Title\nbody 1\nbody 2', 0, 19);
  assert.equal(run(s, edit.insertToggle(s, 'T', 'B')), ':::toggle Title\nbody 1\nbody 2\n:::');
  const empty = edit.insertToggle(at('', 0), 'T', 'B');
  assert.equal(empty.text, ':::toggle T\nB\n:::');
});

test('table insert and Tab between cells, adding a row at the end', () => {
  const s = at('', 0);
  const t = edit.insertTable(s, 2, 2, (n) => `C${n}`);
  const v = run(s, t);
  assert.equal(v, '| C1 | C2 |\n| --- | --- |\n|   |   |\n');
  assert.equal(v.slice(t.selStart, t.selEnd), 'C1');
  const n1 = edit.moveTableCell(at(v, t.selStart), false);
  assert.equal(v.slice(n1.selStart, n1.selEnd), 'C2');
  const n2 = edit.moveTableCell(at(v, n1.selStart), false);
  assert.ok(n2.selStart > v.indexOf('---') && n2.selStart < v.length);
  const last = v.lastIndexOf('|') - 1;
  const grow = edit.moveTableCell(at(v, last), false);
  assert.equal(run(at(v, last), grow), '| C1 | C2 |\n| --- | --- |\n|   |   |\n|   |   |\n');
  const back = edit.moveTableCell(at(v, n1.selStart), true);
  assert.equal(v.slice(back.selStart, back.selEnd), 'C1');
  assert.equal(edit.moveTableCell(at('not | a table', 2), false), null);
});

test('slash trigger: start of line or after a space, not in code or URLs', () => {
  assert.deepEqual(edit.slashTrigger('/he', 3), { start: 0, query: 'he' });
  assert.deepEqual(edit.slashTrigger('x /ตา', 5), { start: 2, query: 'ตา' });
  assert.equal(edit.slashTrigger('https://a/b', 11), null);
  assert.equal(edit.slashTrigger('a/b', 3), null);
  assert.equal(edit.slashTrigger('`x /y', 5), null);
  assert.equal(edit.slashTrigger('```\n/h', 6), null);
  assert.equal(edit.slashTrigger('/a b', 4), null);
});

test('chained edits make one replacement', () => {
  const s = at('ab /hea', 7);
  const removed = { from: 3, to: 7, text: '', selStart: 3, selEnd: 3 };
  const e = edit.chainEdits(s, removed, (next) => edit.insertText(next, 'X'));
  assert.equal(run(s, e), 'ab X');
  assert.equal(e.selStart, 4);
});

/* ---- Previews and search ---- */

test('stripper removes the new syntax', () => {
  const body = [
    ':::toggle Hidden title',
    '> [!NOTE]',
    '> ==hi== ==[green]go== ++u++ [t]{red} [n](#/notes?id=a1)',
    ':::',
  ].join('\n');
  assert.equal(stripMarkdown(body), 'Hidden title\n\nhi go u t n\n');
});

test('word count: English by spaces, Thai by the segmenter', () => {
  assert.equal(countWords('one two three', 'en').words, 3);
  const thai = countWords('ฉันชอบกินข้าว', 'th');
  assert.ok(thai.words >= 3 && thai.words <= 5, `got ${thai.words}`);
});

const runAt = (value, start, end, fn) => {
  const e = fn({ value, start, end });
  return edit.applyTextEdit(value, e);
};

test('setHeading sets a level, and the same level again clears it', () => {
  assert.equal(runAt('Title', 0, 0, (s) => edit.setHeading(s, 2)), '## Title');
  assert.equal(runAt('## Title', 3, 3, (s) => edit.setHeading(s, 2)), 'Title');
  assert.equal(runAt('# Title', 2, 2, (s) => edit.setHeading(s, 3)), '### Title');
  assert.equal(runAt('> quoted', 3, 3, (s) => edit.setHeading(s, 1)), '> # quoted');
});

test('codeBlockAction: new block on an empty line, next line after text, around a selection', () => {
  assert.equal(runAt('', 0, 0, (s) => edit.codeBlockAction(s, 'code')), '```\ncode\n```');
  assert.match(runAt('some text', 4, 4, (s) => edit.codeBlockAction(s, 'code')), /^some text\n+```\ncode\n```\n?$/);
  assert.equal(runAt('a\nb', 0, 3, (s) => edit.codeBlockAction(s, 'code')), '```\na\nb\n```');
});

test('marks and colours never swallow a heading, list or quote marker', () => {
  assert.equal(runAt('## Overview', 0, 11, (s) => edit.toggleInline(s, 'bold', 'x')), '## **Overview**');
  assert.equal(runAt('## Overview', 0, 11, (s) => edit.applyColor(s, 'color', 'red', 'x')), '## [Overview]{red}');
  assert.equal(runAt('- [ ] milk', 0, 10, (s) => edit.applyColor(s, 'highlight', 'yellow', 'x')), '- [ ] ==milk==');
  assert.equal(runAt('> quote', 0, 7, (s) => edit.toggleInline(s, 'underline', 'x')), '> ++quote++');
  /* A selection inside the text is left as it is. */
  assert.equal(runAt('## Overview', 3, 7, (s) => edit.toggleInline(s, 'bold', 'x')), '## **Over**view');
});
