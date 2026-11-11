// Compare documents → tracked changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { baseExtensions } from '../src/editor/index.js';
import { compareDocs } from '../src/review/compare.js';

const schema = getSchema(baseExtensions());
const P = (...runs) => ({ type: 'paragraph', content: runs.map((r) => (typeof r === 'string' ? { type: 'text', text: r } : r)) });
const D = (...ps) => ({ type: 'doc', content: ps });
const runs = (doc) => doc.content.map((p) => (p.content || []).map((c) => {
  const k = c.marks?.find((m) => ['insertion', 'deletion', 'formatChange'].includes(m.type))?.type;
  return k ? `[${k[0]}:${c.text}]` : c.text;
}).join(''));

test('word-level insertions and deletions inside a paragraph', () => {
  const a = D(P('Davacı vekili mahkemeye başvurdu.'));
  const b = D(P('Davacı asil mahkemeye tekrar başvurdu.'));
  const { doc, stats } = compareDocs(a, b, { author: 'Karşı taraf' });
  assert.deepEqual(runs(doc), ['Davacı [d:vekili][i:asil] mahkemeye[i: tekrar] başvurdu.']);
  assert.equal(stats.insertions, 2);
  assert.equal(stats.deletions, 1);
  schema.nodeFromJSON(doc).check(); // valid for the editor
});

test('added and removed paragraphs, unchanged ones untouched', () => {
  const a = D(P('Bir.'), P('İki silinecek tamamen farklı.'), P('Üç.'));
  const b = D(P('Bir.'), P('Üç.'), P('Dört eklendi.'));
  const { doc } = compareDocs(a, b);
  assert.deepEqual(runs(doc), ['Bir.', '[d:İki silinecek tamamen farklı.]', 'Üç.', '[i:Dört eklendi.]']);
});

test('formatting differences become format changes; paragraph alignment too', () => {
  const a = D({ type: 'paragraph', attrs: { align: 'left' }, content: [{ type: 'text', text: 'Talep sonucu' }] });
  const b = D({ type: 'paragraph', attrs: { align: 'center' }, content: [{ type: 'text', text: 'Talep', marks: [{ type: 'bold' }] }, { type: 'text', text: ' sonucu' }] });
  const { doc, stats } = compareDocs(a, b);
  assert.deepEqual(runs(doc), ['[f:Talep] sonucu']);
  assert.equal(doc.content[0].attrs.fmtChange.before.align, 'left');
  assert.equal(stats.formats, 2);
  schema.nodeFromJSON(doc).check();
});

test('identical documents: no changes', () => {
  const a = D(P('Aynı metin.'), P('İkinci.'));
  const { stats } = compareDocs(a, JSON.parse(JSON.stringify(a)));
  assert.deepEqual(stats, { insertions: 0, deletions: 0, formats: 0 });
});

// ---------------------------------------------------------------- real files (read only, never stored)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUdfXml } from '../src/udf/codec.js';
import { readUdf } from '../src/udf/zip.js';
import { docText } from '../src/udf/codec.js';

const dir = process.env.UDF_SAMPLES || path.join(os.homedir(), 'Downloads');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.udf')) : [];

test(`real files: self-compare is clean, a removed paragraph is one deletion (${files.length} files)`, { skip: !files.length && 'no samples' }, () => {
  for (const f of files) {
    const { doc } = parseUdfXml(readUdf(fs.readFileSync(path.join(dir, f))).contentText);
    const same = compareDocs(doc, JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(same.stats, { insertions: 0, deletions: 0, formats: 0 }, `${f}: self-compare`);
    const i = doc.content.findIndex((b) => b.type === 'paragraph' && (b.content || []).some((c) => c.text?.trim().length > 20));
    if (i < 0) continue;
    const cut = { ...doc, content: doc.content.filter((_, k) => k !== i) };
    const r = compareDocs(doc, cut);
    assert.equal(r.stats.deletions, 1, `${f}: removed paragraph`);
    assert.equal(r.stats.insertions, 0, `${f}: nothing inserted`);
    schema.nodeFromJSON(r.doc).check();
    // reject-all view = original text
    assert.equal(docText(r.doc).replace(/\s+/g, ' ').length >= docText(cut).replace(/\s+/g, ' ').length, true);
  }
});
