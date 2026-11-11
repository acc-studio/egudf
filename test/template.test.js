// UYAP template merge: synthetic fixture for the binding rules + every real
// sample that carries a <data> payload (read from UDF_SAMPLES / ~/Downloads,
// never committed — client data).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeTemplateData, hasTemplateData } from '../src/udf/template-data.js';
import { parseUdfXml, serializeUdfXml, docText } from '../src/udf/codec.js';
import { readUdf } from '../src/udf/zip.js';

/** Builds content.xml from [tag, attrs, text] runs so offsets are computed, not hand-written. */
function build(blocks, data) {
  let text = '';
  const run = ([tag, attrs, t]) => {
    const s = `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')} startOffset="${text.length}" length="${t.length}" />`;
    text += t;
    return s;
  };
  const block = (b) => (b.table
    ? `<table tableName="${b.table}" border="borderNone">${b.rows.map((r) => `<row${r.rowName ? ` rowType="dataRow" rowName="${r.rowName}"` : ''}>${r.cells.map((c) => `<cell>${c.map(block).join('')}</cell>`).join('')}</row>`).join('')}</table>`
    : `<paragraph${b.group ? ` GroupName="${b.group}"` : ''}>${b.runs.map(run).join('')}</paragraph>`);
  const elements = blocks.map(block).join('');
  return `<?xml version="1.0" encoding="UTF-8" ?><template format_id="1.8"><content><![CDATA[${text}]]></content><properties><pageFormat /></properties><elements resolver="hvl-default">${elements}</elements><styles><style name="hvl-default" family="Arial" size="11" /></styles><data>${data}</data></template>`;
}
const F = (fieldName, group, extra = {}) => ['field', { fieldType: '1', fieldName, ...(group ? { fieldGroupName: group } : {}), ...extra }, fieldName];
const C = (t, group) => ['content', group ? { fieldGroupName: group } : {}, t];
const paras = (xml) => docText(parseUdfXml(xml).doc).split('\n');

test('merge: fields, groups, eol, ceol, missing values', () => {
  const xml = build([
    { runs: [F('il_Ilce'), C('\n')] },
    { group: 'Group5PGrp', runs: [F('auto', 'kisiGrp'), F('ad', 'kisiGrp'), F('tc', 'kisiGrp'), F('eol', 'kisiGrp'), F('adres', 'kisiGrp'), F('eol', 'vGrp'), C('vekili ', 'vGrp'), F('eol', 'vlerGrp'), C('vekilleri ', 'vlerGrp'), F('ceol', 'avGrp'), F('avukat', 'avGrp'), C('\n')] },
    { group: 'Group7PGrp', runs: [F('mirasci', 'mGrp'), C('\n')] },
    { runs: [F('esasNo', 'ilamGrp'), C(' esas sayılı', 'ilamGrp'), C('Yol: '), F('yol'), C('\n')] },
  ], '<il_Ilce>BÜYÜKÇEKMECE</il_Ilce><GroupXfPGrp><kisiGrp><ad>ADNAN, </ad><tc>123 TC Nolu</tc></kisiGrp><vGrp /><avGrp><ceol>false</ceol><avukat>Av. Örnek</avukat></avGrp></GroupXfPGrp><yol>Haciz Yolu</yol>');
  assert.ok(hasTemplateData(xml));
  const { xml: out, merged } = mergeTemplateData(xml);
  assert.equal(merged, true);
  assert.deepEqual(paras(out), ['BÜYÜKÇEKMECE', 'ADNAN, 123 TC Nolu', 'vekili Av. Örnek', 'Yol: Haciz Yolu']);
  assert.ok(!/<data>/.test(out));
  assert.match(out, /<field [^>]*fieldName="il_Ilce"/); // field runs survive, carrying the value
});

test('merge: dataRow tables repeat per instance, nested, scoped; absent table data removes rows', () => {
  const xml = build([
    { table: 'Tablo40', rows: [{ rowName: 'row40', cells: [[
      { group: 'tarafGrp', runs: [F('taraf')] },
      { table: 'Tablo11', rows: [{ rowName: 'row11', cells: [[{ runs: [F('miktar')] }], [{ runs: [F('aciklama')] }]] }] },
    ]] }] },
    { table: 'Tablo9', rows: [{ rowName: 'row9', cells: [[{ runs: [C('yok\n')] }]] }] },
    { runs: [C('son\n')] },
  ], '<TabloXeXa><rowXeXa><tarafGrp><taraf>FURKAN</taraf></tarafGrp><TabloXbXb><rowXbXb><miktar>100,00</miktar><aciklama>Asıl alacak</aciklama></rowXbXb><rowXbXb><miktar>5,00</miktar><aciklama>Faiz</aciklama></rowXbXb></TabloXbXb></rowXeXa></TabloXeXa>');
  const { doc } = parseUdfXml(mergeTemplateData(xml).xml);
  assert.equal(doc.content.length, 2, 'Tablo9 has no data → table removed');
  const inner = doc.content[0].content[0].content[0].content;
  assert.equal(docText({ type: 'doc', content: [inner[0]] }), 'FURKAN');
  const rows = inner[1].content.map((r) => r.content.map((c) => docText({ type: 'doc', content: c.content })));
  assert.deepEqual(rows, [['100,00', 'Asıl alacak'], ['5,00', 'Faiz']]);
});

test('merge: no-op without a data payload', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8" ?><template format_id="1.8"><content><![CDATA[a\n]]></content><elements><paragraph><field fieldName="x" startOffset="0" length="2" /></paragraph></elements><styles /></template>';
  assert.deepEqual(mergeTemplateData(xml), { xml, merged: false });
});

// ------------------------------------------------------------------ real samples

const dir = process.env.UDF_SAMPLES || path.join(os.homedir(), 'Downloads');
const samples = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.udf')) : [];
const templated = samples.map((f) => {
  try { return { f, xml: readUdf(fs.readFileSync(path.join(dir, f))).contentText }; } catch { return null; }
}).filter((s) => s && hasTemplateData(s.xml));

test(`merge: real templated samples (${templated.length})`, { skip: !templated.length && 'no templated samples' }, () => {
  for (const { f, xml } of templated) {
    const { xml: out, merged } = mergeTemplateData(xml);
    assert.equal(merged, true, f);
    const a = parseUdfXml(out);
    const text = docText(a.doc);
    // No placeholder survives: none of the template's field names appear as text.
    for (const m of xml.matchAll(/fieldName="([^"]{6,})"/g)) assert.ok(!text.includes(m[1]), `${f}: placeholder ${m[1]} still visible`);
    // Merged output is an ordinary document: stable through the codec, idempotent under merge.
    assert.equal(mergeTemplateData(out).merged, false, f);
    const b = parseUdfXml(serializeUdfXml(a.doc, a.meta));
    assert.equal(docText(b.doc), text, f);
  }
});
