// UDF codec tests: synthetic round-trips + idempotency over real UYAP files.
// Real files are read from UDF_SAMPLES (default: ~/Downloads) and never copied
// into the repo — they contain client data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { parseUdfXml, serializeUdfXml, newDocMeta, defaultParaAttrs, docText } from '../src/udf/codec.js';
import { readUdf, writeUdf } from '../src/udf/zip.js';
import { listLabel, javaToHex, hexToJava } from '../src/udf/common.js';

const P = (content, attrs = {}) => ({ type: 'paragraph', attrs: { ...defaultParaAttrs(), ...attrs }, ...(content ? { content } : {}) });
const T = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });

const sample = () => ({
  type: 'doc',
  content: [
    P([T('İSTANBUL ANADOLU 3. ASLİYE TİCARET MAHKEMESİ', [{ type: 'bold' }])], { align: 'center' }),
    P(null),
    P([T('DAVACI\t\t: ', [{ type: 'bold' }]), T('Örnek Şirketi A.Ş.')], { align: 'justify', lineSpacing: 0.5 }),
    P([T('Birinci madde ğüşıöç ĞÜŞİÖÇ')], { list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_DOT', id: '1', level: 1 }, leftIndent: 25, firstLineIndent: -18 }),
    P([T('Renkli', [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '14pt', color: '#c00000' } }]), T(' ve '), T('vurgulu', [{ type: 'italic' }, { type: 'highlight', attrs: { color: '#ffff00' } }])]),
    P([T('Alan', [{ type: 'udfRun', attrs: { tag: 'field', extra: { fieldName: 'dosyaNo', fieldType: '1' } } }])]),
    {
      type: 'table',
      attrs: { udf: { border: 'borderCell' } },
      content: [
        { type: 'tableRow', attrs: { udf: {} }, content: [
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200], udf: {} }, content: [P([T('A1')])] },
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [400], udf: {} }, content: [P([T('B1 ]]> cdata')])] },
        ] },
      ],
    },
    P([T('Sonuç'), { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', width: 100, height: 50, extra: null } }]),
  ],
});

test('round-trip preserves structure, marks, lists, tables, fields, images', () => {
  const doc = sample();
  const meta = newDocMeta();
  const xml = serializeUdfXml(doc, meta);
  const { doc: back } = parseUdfXml(xml);
  // compare semantically (table udf attrs gain defaults on write)
  assert.equal(docText(back), docText(doc));
  assert.deepEqual(back.content[0], doc.content[0]);
  assert.deepEqual(back.content[1].content, undefined);
  assert.deepEqual(back.content[2], doc.content[2]);
  assert.deepEqual(back.content[3].attrs.list, doc.content[3].attrs.list);
  assert.equal(back.content[3].attrs.leftIndent, 25);
  assert.deepEqual(back.content[4].content, doc.content[4].content);
  assert.deepEqual(back.content[5].content, doc.content[5].content);
  assert.equal(back.content[6].type, 'table');
  assert.deepEqual(back.content[6].content[0].content.map((c) => c.attrs.colwidth[0] > 0), [true, true]);
  assert.equal(back.content[7].content[1].type, 'image');
  assert.equal(back.content[7].content[1].attrs.width, 100);
});

test('serialized offsets are consistent and every paragraph ends with \\n', () => {
  const xml = serializeUdfXml(sample(), newDocMeta());
  const dom = new DOMParser().parseFromString(xml, 'text/xml');
  const text = dom.getElementsByTagName('content')[0].textContent;
  let expected = 0;
  const paras = dom.getElementsByTagName('paragraph');
  for (let i = 0; i < paras.length; i++) {
    const runs = [];
    for (let c = paras[i].firstChild; c; c = c.nextSibling) if (c.nodeType === 1) runs.push(c);
    for (const r of runs) {
      assert.equal(+r.getAttribute('startOffset'), expected, 'runs are contiguous');
      expected += +r.getAttribute('length');
    }
    const last = runs[runs.length - 1];
    assert.equal(text[+last.getAttribute('startOffset') + +last.getAttribute('length') - 1], '\n');
  }
  assert.equal(expected, text.length);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" ?>'));
});

test('zip container round-trip', () => {
  const xml = serializeUdfXml(sample(), newDocMeta());
  const bytes = writeUdf({ contentXml: xml, sign: new Uint8Array([1, 2, 3]) });
  const r = readUdf(bytes);
  assert.equal(r.contentText, xml);
  assert.deepEqual([...r.sign], [1, 2, 3]);
});

test('helpers', () => {
  assert.equal(javaToHex('-16777216'), '#000000');
  assert.equal(hexToJava('#000000'), '-16777216');
  assert.equal(javaToHex(hexToJava('#c00000')), '#c00000');
  assert.equal(listLabel('number', 'NUMBER_TYPE_NUMBER_TRE', 3), '3-');
  assert.equal(listLabel('number', 'NUMBER_TYPE_ROMAN_BIG_DOT', 4), 'IV.');
  assert.equal(listLabel('number', 'NUMBER_TYPE_LETTER_SMALL_DOT', 28), 'ab.');
  assert.equal(listLabel('bullet', 'BULLET_TYPE_ELLIPSE', 1), '•');
});

// ---------------------------------------------------------------- real files
const dir = process.env.UDF_SAMPLES || path.join(os.homedir(), 'Downloads');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.udf')) : [];

test(`real UYAP files: parse → serialize → parse is stable (${files.length} files)`, { skip: !files.length && 'no samples' }, () => {
  for (const f of files) {
    const { contentText } = readUdf(fs.readFileSync(path.join(dir, f)));
    let first = parseUdfXml(contentText);
    // .udf files written by egUDF ≤ 0.14.0 could hold Word-style hanging lists, which UYAP
    // draws with the bullet over the text: the first re-save repairs them, then it is stable
    const hanging = (d) => JSON.stringify(d).match(/"firstLineIndent":-[^}]*"list":\{/g)?.length || 0;
    if (hanging(first.doc)) first = parseUdfXml(serializeUdfXml(first.doc, first.meta));
    const xml2 = serializeUdfXml(first.doc, first.meta);
    const second = parseUdfXml(xml2);
    assert.equal(hanging(second.doc), 0, `${f}: a list paragraph keeps a hanging indent (UYAP draws its bullet over the text)`);
    assert.deepEqual(second.doc, first.doc, `${f}: body changed on re-save`);
    assert.deepEqual(second.meta.header?.content, first.meta.header?.content, `${f}: header changed`);
    assert.deepEqual(second.meta.footer?.content, first.meta.footer?.content, `${f}: footer changed`);
    assert.deepEqual(second.meta.tail, first.meta.tail, `${f}: template extras changed`);
    // no text lost: every non-whitespace char of the original survives
    const orig = (new DOMParser().parseFromString(contentText, 'text/xml')).getElementsByTagName('content')[0].textContent;
    const strip = (s) => s.replace(/[\s¸]/g, '');
    const all = [first.meta.header?.content, first.doc.content, first.meta.footer?.content]
      .filter(Boolean).map((c) => docText({ type: 'doc', content: c })).join('');
    assert.equal(strip(all).length, strip(orig).length, `${f}: text length differs`);
    void xml2;
  }
});

// What UYAP Doküman Editörü 5.4.20 draws (checked by opening test files in it):
// bullets sit ~12pt left of LeftIndent whatever FirstLineIndent says; the style at
// level N is SecListTypeLevelN, else level defaults; there is no dash bullet.
test('lists are written the way UYAP Doküman Editörü draws them', () => {
  const P = (list, extra = {}) => ({ type: 'paragraph', attrs: { ...defaultParaAttrs(), leftIndent: 36, firstLineIndent: -18, ...extra, list }, content: [{ type: 'text', text: 'Madde' }] });
  const doc = { type: 'doc', content: [
    P({ kind: 'bullet', type: 'BULLET_TYPE_DASH', id: '1', level: 1 }),
    P({ kind: 'bullet', type: 'BULLET_TYPE_ELLIPSE', id: '1', level: 2 }),
    P({ kind: 'number', type: 'NUMBER_TYPE_NUMBER_PARANTEZ', id: '2', level: 1 }),
    P({ kind: 'number', type: 'NUMBER_TYPE_LETTER_SMALL_DOT', id: '2', level: 2 }),
  ] };
  const xml = serializeUdfXml(doc, newDocMeta());
  const paras = [...xml.matchAll(/<paragraph\b([^>]*)>/g)].map((m) => m[1]);
  assert.ok(paras.every((a) => !/FirstLineIndent="-/.test(a)), 'no hanging indent on list paragraphs');
  assert.match(paras[0], /BulletType="BULLET_TYPE_ELLIPSE"/); // no dash bullet in UYAP
  assert.match(paras[1], /SecListTypeLevel2="BULLET_TYPE_ELLIPSE"/); // else UYAP draws ■ at level 2
  assert.match(paras[2], /NumberType="NUMBER_TYPE_NUMBER_PARANTHESE"/);
  assert.match(paras[3], /SecListTypeLevel2="NUMBER_TYPE_CHAR_SMALL_DOT"/);
  // reading back: the style per level, UYAP's defaults where a file says nothing
  const back = parseUdfXml(xml).doc.content.map((p) => p.attrs.list.type);
  assert.deepEqual(back, ['BULLET_TYPE_ELLIPSE', 'BULLET_TYPE_ELLIPSE', 'NUMBER_TYPE_NUMBER_PARANTHESE', 'NUMBER_TYPE_CHAR_SMALL_DOT']);
  const native = parseUdfXml(xml.replace(/ SecListTypeLevel\d="[^"]*"/g, '')).doc.content.map((p) => listLabel(p.attrs.list.kind, p.attrs.list.type, 1));
  assert.deepEqual(native, ['•', '■', '1)', 'a.']);
});
