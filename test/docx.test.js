// Word interop: synthetic export → import round trip, and real .docx files
// (read from UDF_SAMPLES / ~/Downloads, never committed — client data).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { exportDocx, importDocx, isDocx } from '../src/interop/docx.js';
import { newDocMeta, defaultParaAttrs, docText, serializeUdfXml, parseUdfXml } from '../src/udf/codec.js';
import { flattenFootnotes } from '../src/udf/uyapify.js';

const P = (content, attrs = {}) => ({ type: 'paragraph', attrs: { ...defaultParaAttrs(), ...attrs }, ...(content ? { content } : {}) });
const T = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sample = () => ({
  type: 'doc',
  content: [
    P([T('ANKARA 3. İŞ MAHKEMESİ', [{ type: 'bold' }])], { align: 'center', spaceBelow: 12 }),
    P([T('DAVACI\t: ', [{ type: 'bold' }]), T('Örnek A.Ş.', [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '14pt', color: '#c00000' } }])], { tabSet: '113.4:0:0' }),
    P([T('Gövde metni ', null), T('italik', [{ type: 'italic' }]), T(' ve '), T('vurgulu', [{ type: 'highlight', attrs: { color: '#ffff00' } }])], { align: 'justify', firstLineIndent: 35.4, lineSpacing: 0.5 }),
    P([T('Birinci madde')], { list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_PARANTEZ', id: '1', level: 1 }, leftIndent: 36, firstLineIndent: -18 }),
    P([T('Madde işareti')], { list: { kind: 'bullet', type: 'BULLET_TYPE_ELLIPSE', id: '2', level: 2 }, leftIndent: 54, firstLineIndent: -18 }),
    P([T('Eklenen', [{ type: 'insertion', attrs: { author: 'Av. Ayşe', at: '2026-11-11T10:00Z' } }]), T(' sabit '), T('silinen', [{ type: 'deletion', attrs: { author: 'Av. Ayşe', at: '2026-11-11T10:01Z' } }])]),
    P([T('Yorumlu metin', [{ type: 'comment', attrs: { id: 'c1' } }]), T(' devam.')]),
    {
      type: 'table', attrs: { udf: { border: 'borderCell' } },
      content: [{ type: 'tableRow', attrs: { udf: {} }, content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200], udf: {} }, content: [P([T('A1')])] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [400], udf: {} }, content: [P([T('B1')])] },
      ] }],
    },
    P([T('Resim: '), { type: 'image', attrs: { src: `data:image/png;base64,${PNG}`, width: 50, height: 25, extra: null } }]),
  ],
});

test('docx export is a valid package and imports back with formatting', () => {
  const meta = newDocMeta();
  meta.footer = { attrs: { 'pageNumber-spec': 'BSP32_72', 'pageNumber-seperator': '/' }, content: [P(null)] };
  meta.header = { attrs: { startPage: '1' }, content: [P([T('Üst bilgi')])] };
  const bytes = exportDocx(sample(), meta, { comments: [{ id: 'c1', author: 'Ben', at: '2026-11-11T10:00:00Z', text: 'Kontrol et', replies: [{ author: 'Ali', at: '2026-11-11T11:00:00Z', text: 'Tamam' }] }] });
  assert.ok(isDocx(bytes));
  const files = unzipSync(bytes);
  for (const p of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/comments.xml', 'word/header1.xml', 'word/footer1.xml', 'word/media/image1.png']) assert.ok(files[p], p);
  // every XML part is well-formed
  for (const [p, v] of Object.entries(files)) {
    if (!/\.(xml|rels)$/.test(p)) continue;
    const errs = [];
    new DOMParser({ onError: (l, m) => { if (l !== 'warning') errs.push(m); } }).parseFromString(strFromU8(v), 'text/xml');
    assert.deepEqual(errs, [], p);
  }
  const back = importDocx(bytes);
  const c = back.doc.content;
  assert.equal(docText(back.doc).split('\n')[0], 'ANKARA 3. İŞ MAHKEMESİ');
  assert.equal(c[0].attrs.align, 'center');
  assert.equal(c[0].attrs.spaceBelow, 12);
  assert.ok(c[0].content[0].marks.some((m) => m.type === 'bold'));
  assert.equal(c[1].content[1].marks.find((m) => m.type === 'textStyle').attrs.fontSize, '14pt');
  assert.equal(c[1].content[1].marks.find((m) => m.type === 'textStyle').attrs.color, '#c00000');
  assert.equal(c[1].attrs.tabSet, '113.4:0:0');
  assert.equal(c[2].attrs.align, 'justify');
  assert.equal(c[2].attrs.lineSpacing, 0.5);
  assert.equal(c[2].attrs.firstLineIndent, 35.4);
  assert.ok(c[2].content.find((n) => n.text === 'vurgulu').marks.some((m) => m.type === 'highlight'));
  assert.deepEqual({ kind: c[3].attrs.list.kind, type: c[3].attrs.list.type, level: c[3].attrs.list.level }, { kind: 'number', type: 'NUMBER_TYPE_NUMBER_PARANTHESE', level: 1 });
  assert.equal(c[4].attrs.list.kind, 'bullet');
  assert.equal(c[4].attrs.list.level, 2);
  assert.ok(c[5].content[0].marks.some((m) => m.type === 'insertion' && m.attrs.author === 'Av. Ayşe'));
  assert.ok(c[5].content[2].marks.some((m) => m.type === 'deletion'));
  assert.ok(c[6].content[0].marks.some((m) => m.type === 'comment'));
  assert.equal(back.review.comments[0].text, 'Kontrol et');
  assert.deepEqual(back.review.comments[0].replies.map((r) => [r.author, r.text]), [['Ali', 'Tamam']]); // a Word reply thread
  assert.equal(back.review.comments[0].quote, 'Yorumlu metin');
  assert.equal(c[7].type, 'table');
  assert.equal(c[7].attrs.udf.border, 'borderCell');
  assert.deepEqual(c[7].content[0].content.map((x) => x.attrs.colwidth[0]), [200, 400]);
  assert.equal(c[8].content[1].type, 'image');
  assert.equal(c[8].content[1].attrs.width, 50);
  assert.ok(back.meta.footer.attrs['pageNumber-spec']);
  assert.equal(docText({ type: 'doc', content: back.meta.header.content }), 'Üst bilgi');
  // and the imported document serializes to a valid UDF
  assert.ok(parseUdfXml(serializeUdfXml(back.doc, back.meta)).doc.content.length > 5);
});

const dir = process.env.UDF_SAMPLES || path.join(os.homedir(), 'Downloads');
const docs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.docx$/i.test(f) && !f.startsWith('~$')).slice(0, 80) : [];

test(`docx import: real files (${docs.length})`, { skip: !docs.length && 'no .docx samples' }, () => {
  let withText = 0;
  for (const f of docs) {
    const bytes = fs.readFileSync(path.join(dir, f));
    if (!isDocx(bytes)) continue;
    const r = importDocx(bytes);
    const text = docText(r.doc);
    if (text.trim()) withText++;
    // export what we imported, import again: text is stable
    const again = importDocx(exportDocx(r.doc, r.meta, r.review));
    assert.equal(docText(again.doc), text, f);
    // UDF serialization of an imported Word file round-trips
    const u = parseUdfXml(serializeUdfXml(r.doc, r.meta));
    // footnotes become numbered notes at the end of the .udf
    const want = docText({ type: 'doc', content: flattenFootnotes(r.doc.content) });
    assert.equal(docText(u.doc).replace(/\s+/g, ' ').trim(), want.replace(/\s+/g, ' ').trim(), `${f} → udf`);
  }
  assert.ok(withText > 0);
});

test('Word paragraph styles survive (headings stay headings: navigation pane, TOC)', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/styles.xml': strToU8(`<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Balk1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:next w:val="a"/><w:pPr><w:numPr><w:numId w:val="9"/></w:numPr><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Balk1"/></w:pPr><w:r><w:t>Giriş</w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t> notu</w:t></w:r></w:p><w:p><w:r><w:t>Metin</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`),
  };
  const r = importDocx(zipSync(files));
  assert.equal(r.doc.content[0].attrs.styleId, 'Balk1');
  assert.equal(r.meta.docxStyles.Balk1.outline, 0);
  const out = unzipSync(exportDocx(r.doc, r.meta, r.review));
  const doc = strFromU8(out['word/document.xml']), styles = strFromU8(out['word/styles.xml']);
  assert.match(doc, /<w:pPr><w:pStyle w:val="Balk1"\/>/);
  assert.match(styles, /w:styleId="Balk1"[\s\S]*<w:basedOn w:val="Normal"\/>/); // the localized default style id is ours now
  assert.doesNotMatch(styles, /<w:numId w:val="9"\/>/); // numbering references to parts not written are dropped
  assert.match(doc, /<w:b w:val="0"\/>/); // " notu" is not bold although the style is
  const back = importDocx(exportDocx(r.doc, r.meta, r.review));
  assert.deepEqual(back.doc.content.map((p) => [p.attrs.styleId, p.attrs.align]), [['Balk1', 'center'], [null, 'left']]);
  assert.ok(!back.doc.content[0].content[1].marks?.some((m) => m.type === 'bold'));
});
