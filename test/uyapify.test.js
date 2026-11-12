// Word content → .udf as UYAP Doküman Editörü shows it (src/udf/uyapify.js), and the
// codec's table layout for UYAP (row columnSpans, explicit cells under vertical merges).
import test from 'node:test';
import assert from 'node:assert/strict';
import { uyapifyBlocks, uyapifyDoc, uyapFont } from '../src/udf/uyapify.js';
import { serializeUdfXml, parseUdfXml, newDocMeta, defaultParaAttrs } from '../src/udf/codec.js';

const P = (attrs, content = [{ type: 'text', text: 'x' }]) => ({ type: 'paragraph', attrs: { ...defaultParaAttrs(), ...attrs }, content });

test('paragraph spacing: Word takes the larger of after/before, UYAP adds them', () => {
  const out = uyapifyBlocks([P({ spaceBelow: 12 }), P({ spaceAbove: 6, spaceBelow: 6 }), P({ spaceAbove: 18 })]);
  assert.deepEqual(out.map((p) => [p.attrs.spaceAbove, p.attrs.spaceBelow]), [[0, 12], [0, 6], [12, 0]]);
});

test('lists, line spacing, Word-only paragraph properties', () => {
  const [a, b] = uyapifyBlocks([
    P({ leftIndent: 36, firstLineIndent: -18, list: { kind: 'bullet', type: 'BULLET_TYPE_DASH', id: '1', level: 1 }, tabSet: '451:1:1', border: { bottom: { style: 'solid' } }, pageBreakBefore: true, keepNext: true }),
    P({ lineRule: 'exact', lineHeight: 27.6 }, [{ type: 'text', text: 'y', marks: [{ type: 'textStyle', attrs: { fontSize: '12pt' } }] }]),
  ]);
  assert.equal(a.attrs.firstLineIndent, 0);
  assert.equal(a.attrs.list.type, 'BULLET_TYPE_ELLIPSE');
  assert.equal(a.attrs.tabSet, '451:1:0'); // UYAP draws no leaders
  assert.equal(a.attrs.border, null);
  assert.equal(a.attrs.pageBreakBefore, false); // the .udf format has no page breaks
  assert.equal(b.attrs.lineRule, null);
  assert.equal(b.attrs.lineSpacing, 1); // 27.6pt = 2 × 12pt × 1.15
});

test('character effects UYAP lacks become text it has', () => {
  const ts = (attrs) => [{ type: 'textStyle', attrs: { fontFamily: null, fontSize: null, color: null, letterSpacing: null, smallCaps: null, allCaps: null, dstrike: null, ...attrs } }];
  const [p] = uyapifyBlocks([P({ shading: '#d9d9d9' }, [
    { type: 'text', text: 'büyük', marks: ts({ allCaps: true }) },
    { type: 'text', text: 'küçük', marks: ts({ smallCaps: true, fontSize: '10pt' }) },
    { type: 'text', text: 'çift', marks: ts({ dstrike: true, letterSpacing: 2 }) },
    { type: 'text', text: 'aptos', marks: ts({ fontFamily: 'Aptos' }) },
  ])], { base: { family: 'Times New Roman', size: 12 } });
  const [caps, small, dbl, font] = p.content;
  assert.equal(caps.text, 'BÜYÜK');
  assert.equal(small.text, 'KÜÇÜK');
  assert.equal(small.marks.find((m) => m.type === 'textStyle').attrs.fontSize, '8pt');
  assert.ok(dbl.marks.some((m) => m.type === 'strike'));
  assert.ok(!dbl.marks.some((m) => m.type === 'textStyle')); // letter spacing dropped, nothing left
  assert.equal(font.marks.find((m) => m.type === 'textStyle').attrs.fontFamily, 'Calibri');
  assert.ok(p.content.every((c) => c.marks.some((m) => m.type === 'highlight' && m.attrs.color === '#d9d9d9'))); // shading → highlight
  assert.equal(uyapFont('Aptos Display'), 'Calibri Light');
});

const cell = (text, attrs = {}) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [100], udf: {}, ...attrs }, content: [P({}, [{ type: 'text', text }])] });
const row = (cells) => ({ type: 'tableRow', attrs: { udf: {} }, content: cells });
const tbl = (rows, attrs = {}) => ({ type: 'table', attrs: { udf: {}, ...attrs }, content: rows });
const side = { style: 'solid', width: 0.5, color: '#000000' };
const box = (s) => ({ fmt: { borders: Object.fromEntries(s.map((k) => [k, side])) } });

test('Word borders → one UYAP border mode per table', () => {
  const mode = (cells) => uyapifyBlocks([tbl([row(cells[0]), row(cells[1])])])[0].attrs.udf.border;
  const all = ['top', 'bottom', 'left', 'right'];
  assert.equal(mode([[cell('a', box(all)), cell('b', box(all))], [cell('c', box(all)), cell('d', box(all))]]), 'borderCell');
  assert.equal(mode([[cell('a', box(['top', 'bottom', 'left'])), cell('b', box(['top', 'bottom', 'right']))], [cell('c', box(['bottom', 'left'])), cell('d', box(['bottom', 'right']))]]), 'borderRow');
  assert.equal(mode([[cell('a', box(['top', 'left'])), cell('b', box(['top', 'right']))], [cell('c', box(['bottom', 'left'])), cell('d', box(['bottom', 'right']))]]), 'borderTable');
  assert.equal(mode([[cell('a', { fmt: { bg: '#eee' } }), cell('b')], [cell('c'), cell('d')]]), 'borderNone');
});

test('tables are laid out cell by cell for UYAP (row columnSpans, cells under vertical merges)', () => {
  const doc = { type: 'doc', content: [tbl([
    row([cell('merged', { colspan: 2, colwidth: [100, 100] }), cell('c')]),
    row([cell('tall', { rowspan: 2 }), cell('b'), cell('c')]),
    row([cell('b2'), cell('c2')]),
  ], { udf: { border: 'borderCell' } })] };
  const xml = serializeUdfXml(doc, newDocMeta());
  const rows = [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)];
  assert.deepEqual(rows.map((r) => (r[2].match(/<cell/g) || []).length), [2, 3, 3]); // the merged-down cell gets an empty one below
  assert.match(rows[0][1], /columnSpans="200,100"/);
  // and reading it back gives the horizontal merge again
  const back = parseUdfXml(xml).doc.content[0];
  assert.deepEqual(back.content[0].content.map((c) => c.attrs.colspan), [2, 1]);
});

test('uyapifyDoc maps header/footer and the base font', () => {
  const meta = { ...newDocMeta(), base: { family: 'Aptos', size: 11 }, header: { attrs: {}, content: [P({ spaceAbove: 6, border: { bottom: side } })] } };
  const r = uyapifyDoc({ type: 'doc', content: [P({})] }, meta);
  assert.equal(r.meta.base.family, 'Calibri');
  assert.equal(r.meta.header.content[0].attrs.border, null);
});

test('footnotes: superscript numbers in the text, the notes at the end (UYAP has no footnotes)', () => {
  const fn = (text) => ({ type: 'footnote', attrs: { id: null, content: [P({}, [{ type: 'text', text }])] } });
  const doc = { type: 'doc', content: [P({}, [{ type: 'text', text: 'Madde' }, fn('TBK m. 1'), { type: 'text', text: ' ve' }, fn('HMK m. 2')])] };
  const xml = serializeUdfXml(doc, newDocMeta());
  const back = parseUdfXml(xml).doc.content;
  const text = back.map((p) => (p.content || []).map((c) => c.text).join(''));
  assert.deepEqual(text, ['Madde1 ve2', 'Dipnotlar', '1 TBK m. 1', '2 HMK m. 2']);
  assert.ok(back[0].content.find((c) => c.text === '1').marks.some((m) => m.type === 'superscript'));
});
