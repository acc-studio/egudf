// Word (.docx) ⇄ editor document.
//
// exportDocx(doc, meta, review) → Uint8Array: paragraphs (alignment, indents,
// spacing, line spacing), runs (font, size, bold/italic/underline/strike,
// sub/superscript, colour, highlight), lists (numbering.xml), tables (grid,
// spans, borders), inline images, A4 page setup, header/footer with page
// numbers, tracked changes as w:ins/w:del and comments as comments.xml.
//
// importDocx(bytes) → { doc, meta, review }: the same features back, with
// style inheritance (docDefaults → pStyle → rStyle → direct), numbering
// formats mapped to UYAP list types, fields reduced to their result text, and
// line/page breaks turned into paragraph breaks (UDF has no in-paragraph break).
import { readPageNumber, writePageNumber } from '../udf/pagenum.js';
import { DOMParser } from '@xmldom/xmldom';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { listLabel, A4 } from '../udf/common.js';
import { defaultParaAttrs, newDocMeta, cssSizeToPt } from '../udf/codec.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = (pt) => Math.round((pt || 0) * 20);
const EMU_PER_PT = 12700;

// ================================================================== export

const NUMFMT = (type) => {
  const t = String(type || '');
  if (/ROMAN_BIG|ROMAN_UPPER/.test(t)) return 'upperRoman';
  if (/ROMAN/.test(t)) return 'lowerRoman';
  if (/(LETTER|ALPHA)_(BIG|UPPER)/.test(t)) return 'upperLetter';
  if (/LETTER|ALPHA/.test(t)) return 'lowerLetter';
  return 'decimal';
};
const NUMSUFFIX = (type) => (/TRE|DASH/.test(type) ? '-' : /PARAN|PARENT/.test(type) ? ')' : '.');

export function exportDocx(doc, meta = newDocMeta(), review = null) {
  const base = meta.base || { family: 'Times New Roman', size: 12 };
  const media = []; // { name, bytes, ext }
  const rels = []; // { id, type, target }
  const lists = new Map(); // key → { numId, kind, type }
  const comments = review?.comments || [];
  const commentIdx = new Map(comments.map((c, i) => [c.id, i]));
  let revId = 1;
  const openComments = new Set();

  const rel = (type, target) => {
    const id = `rId${rels.length + 10}`;
    rels.push({ id, type, target });
    return id;
  };

  function rPr(marks = [], change = null) {
    const o = [];
    let family = null, size = null, color = null, hl = null;
    for (const m of marks) {
      switch (m.type) {
        case 'bold': o.push('<w:b/><w:bCs/>'); break;
        case 'italic': o.push('<w:i/><w:iCs/>'); break;
        case 'underline': o.push('<w:u w:val="single"/>'); break;
        case 'strike': o.push('<w:strike/>'); break;
        case 'subscript': o.push('<w:vertAlign w:val="subscript"/>'); break;
        case 'superscript': o.push('<w:vertAlign w:val="superscript"/>'); break;
        case 'textStyle':
          if (m.attrs?.fontFamily) family = String(m.attrs.fontFamily).split(',')[0].replace(/["']/g, '').trim();
          if (m.attrs?.fontSize) size = cssSizeToPt(m.attrs.fontSize);
          if (m.attrs?.color) color = String(m.attrs.color).replace('#', '');
          break;
        case 'highlight': hl = String(m.attrs?.color || '#ffff00').replace('#', ''); break;
        default:
      }
    }
    // element order follows the schema (rFonts, b, i, strike, color, sz, u, shd, vertAlign)
    const order = ['<w:b/>', '<w:i/>', '<w:strike/>'];
    const pick = (p) => o.filter((s) => s.startsWith(p)).join('');
    let s = '';
    if (family) s += `<w:rFonts w:ascii="${x(family)}" w:hAnsi="${x(family)}" w:cs="${x(family)}"/>`;
    s += pick(order[0]) + pick(order[1]) + pick(order[2]);
    if (color && /^[0-9a-f]{6}$/i.test(color)) s += `<w:color w:val="${color}"/>`;
    if (size) s += `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`;
    s += pick('<w:u ');
    if (hl && /^[0-9a-f]{6}$/i.test(hl)) s += `<w:shd w:val="clear" w:color="auto" w:fill="${hl}"/>`;
    s += pick('<w:vertAlign');
    if (change) s += `<w:rPrChange ${revAttrs(change)}>${rPr(change.attrs?.before || []) || '<w:rPr/>'}</w:rPrChange>`;
    return s ? `<w:rPr>${s}</w:rPr>` : '';
  }

  function textRuns(text, marks, del = false, change = null) {
    const pr = rPr(marks, change);
    const tag = del ? 'w:delText' : 'w:t';
    return text.split('\t').map((part, i) => `${i ? `<w:r>${pr}<w:tab/></w:r>` : ''}${part ? `<w:r>${pr}<${tag} xml:space="preserve">${x(part)}</${tag}></w:r>` : ''}`).join('');
  }

  function imageRun(node) {
    const src = String(node.attrs?.src || '');
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i.exec(src);
    if (!m) return '';
    const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    const name = `image${media.length + 1}.${ext}`;
    media.push({ name, ext, bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) });
    const id = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${name}`);
    const wPt = node.attrs.width || 100, hPt = node.attrs.height || 100;
    const cx = Math.round(wPt * EMU_PER_PT), cy = Math.round(hPt * EMU_PER_PT);
    const n = media.length;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Resim ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  const revAttrs = (m) => `w:id="${revId++}" w:author="${x(m.attrs?.author || 'egUDF')}" w:date="${x(normDate(m.attrs?.at))}"`;

  function commentBoundary(marks) {
    const now = new Set((marks || []).filter((m) => m.type === 'comment' && commentIdx.has(m.attrs?.id)).map((m) => m.attrs.id));
    let s = '';
    for (const id of [...openComments]) {
      if (!now.has(id)) { s += closeComment(id); }
    }
    for (const id of now) {
      if (!openComments.has(id)) { openComments.add(id); s += `<w:commentRangeStart w:id="${commentIdx.get(id)}"/>`; }
    }
    return s;
  }
  function closeComment(id) {
    openComments.delete(id);
    const n = commentIdx.get(id);
    return `<w:commentRangeEnd w:id="${n}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${n}"/></w:r>`;
  }

  function pPr(a, { inCell, inner = false } = {}) {
    let s = '';
    if (a.list) {
      const key = `${a.list.kind}|${a.list.type}|${a.list.id}`;
      if (!lists.has(key)) lists.set(key, { numId: lists.size + 1, kind: a.list.kind, type: a.list.type });
      s += `<w:numPr><w:ilvl w:val="${Math.max(0, (a.list.level || 1) - 1)}"/><w:numId w:val="${lists.get(key).numId}"/></w:numPr>`;
    }
    const tabs = String(a.tabSet || '').split(',').map((t) => parseFloat(t)).filter((v) => Number.isFinite(v) && v > 0);
    if (tabs.length) s += `<w:tabs>${tabs.map((t) => `<w:tab w:val="left" w:pos="${tw(t)}"/>`).join('')}</w:tabs>`;
    const line = Math.round(240 * (1 + (a.lineSpacing || 0)));
    s += `<w:spacing w:before="${tw(a.spaceAbove)}" w:after="${tw(a.spaceBelow)}" w:line="${line}" w:lineRule="auto"/>`;
    const fl = a.firstLineIndent || 0;
    if (a.leftIndent || a.rightIndent || fl || a.list) s += `<w:ind w:left="${tw(a.leftIndent)}" w:right="${tw(a.rightIndent)}"${fl < 0 ? ` w:hanging="${tw(-fl)}"` : ` w:firstLine="${tw(fl)}"`}/>`;
    const jc = { center: 'center', right: 'right', justify: 'both' }[a.align];
    if (jc) s += `<w:jc w:val="${jc}"/>`;
    void inCell;
    if (inner) return s;
    if (a.fmtChange?.before) s += `<w:pPrChange ${revAttrs(a.fmtChange)}><w:pPr>${pPr({ ...defaultParaAttrs(), ...a.fmtChange.before }, { inner: true })}</w:pPr></w:pPrChange>`;
    return `<w:pPr>${s}</w:pPr>`;
  }

  function paragraph(n, opts) {
    const a = { ...defaultParaAttrs(), ...(n.attrs || {}) };
    let body = '';
    for (const c of n.content || []) {
      body += commentBoundary(c.marks);
      if (c.type === 'image') { body += imageRun(c); continue; }
      if (c.type !== 'text') continue;
      const ins = c.marks?.find((m) => m.type === 'insertion');
      const del = c.marks?.find((m) => m.type === 'deletion');
      const fc = c.marks?.find((m) => m.type === 'formatChange');
      const marks = (c.marks || []).filter((m) => !['insertion', 'deletion', 'comment', 'udfRun', 'formatChange'].includes(m.type));
      if (del) body += `<w:del ${revAttrs(del)}>${textRuns(c.text, marks, true)}</w:del>`;
      else if (ins) body += `<w:ins ${revAttrs(ins)}>${textRuns(c.text, marks)}</w:ins>`;
      else body += textRuns(c.text, marks, false, fc);
    }
    return `<w:p>${pPr(a, opts)}${body}</w:p>`;
  }

  function table(n, widthTw) {
    const u = n.attrs?.udf || {};
    const bordered = (u.border || 'borderCell') !== 'borderNone';
    const rows = n.content || [];
    const first = rows[0]?.content || [];
    const grid = [];
    for (const c of first) {
      const span = c.attrs?.colspan || 1;
      const w = (c.attrs?.colwidth?.[0] || 0) * 0.75 * 20; // px → twip
      for (let i = 0; i < span; i++) grid.push(Math.round(w / span) || 0);
    }
    const known = grid.filter(Boolean);
    const fill = grid.length ? Math.round(Math.max(0, widthTw - known.reduce((s, v) => s + v, 0)) / Math.max(1, grid.length - known.length)) : 0;
    const cols = grid.map((g) => g || fill || Math.round(widthTw / Math.max(1, grid.length)));
    const b = bordered ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders>' : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
    let s = `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a2, v) => a2 + v, 0)}" w:type="dxa"/>${b}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>`;
    for (const r of rows) {
      s += '<w:tr>';
      let gi = 0;
      for (const c of r.content || []) {
        const span = c.attrs?.colspan || 1;
        const w = cols.slice(gi, gi + span).reduce((a2, v) => a2 + v, 0);
        gi += span;
        s += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${blocks(c.content || [], w, true) || '<w:p/>'}</w:tc>`;
      }
      s += '</w:tr>';
    }
    return `${s}</w:tbl>`;
  }

  function blocks(list, widthTw, inCell = false) {
    let s = '';
    let last = '';
    for (const n of list) {
      if (n.type === 'paragraph') { s += paragraph(n); last = 'p'; } else if (n.type === 'table') { s += table(n, widthTw); last = 't'; }
    }
    if (last === 't' && inCell) s += '<w:p/>'; // Word requires a paragraph after a table in a cell
    return s;
  }

  const pf = meta.pageFormat || {};
  const land = pf.paperOrientation && pf.paperOrientation !== '1';
  const pageW = tw(land ? A4.h : A4.w), pageH = tw(land ? A4.w : A4.h);
  const margin = (k, d) => tw(parseFloat(pf[k]) || d);
  const contentTw = pageW - margin('leftMargin', 70.875) - margin('rightMargin', 70.875);
  const bodyXml = blocks(doc.content || [], contentTw) + [...openComments].map(closeComment).join('');

  // header / footer
  const parts = {};
  let headerRef = '', footerRef = '';
  const fld = (instr) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const pnPara = (pn) => `<w:p><w:pPr><w:jc w:val="${pn.pos === 'left' ? 'left' : pn.pos === 'center' ? 'center' : 'right'}"/></w:pPr>${pn.prefix ? `<w:r><w:t xml:space="preserve">${x(pn.prefix)}</w:t></w:r>` : ''}${fld('PAGE')}${pn.total ? `<w:r><w:t xml:space="preserve"> ${x(pn.sep)} </w:t></w:r>${fld('NUMPAGES')}` : ''}</w:p>`;
  const hdrXml = (tag, content, pn) => {
    let inner = blocks(content || [], contentTw);
    if (pn) inner = tag === 'hdr' ? pnPara(pn) + inner : inner + pnPara(pn);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}>${inner || '<w:p/>'}</w:${tag}>`;
  };
  const hasContent = (c) => (c || []).some((b) => b.type !== 'paragraph' || (b.content || []).length);
  const pnAll = readPageNumber(meta.footer?.attrs);
  const pnTop = pnAll.on && pnAll.vert === 'top' ? pnAll : null;
  const pnBottom = pnAll.on && pnAll.vert === 'bottom' ? pnAll : null;
  const titlePg = meta.header && parseFloat(meta.header.attrs?.startPage) > 1;
  const HREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
  if ((meta.header && hasContent(meta.header.content)) || pnTop) {
    parts['word/header1.xml'] = hdrXml('hdr', meta.header?.content, pnTop);
    headerRef = `<w:headerReference w:type="default" r:id="${rel(HREL, 'header1.xml')}"/>`;
    // first page without the header text (UDF startPage=2) but with a top page number
    if (titlePg && pnTop) {
      parts['word/header2.xml'] = hdrXml('hdr', [], pnTop);
      headerRef += `<w:headerReference w:type="first" r:id="${rel(HREL, 'header2.xml')}"/>`;
    }
  }
  if (meta.footer && (hasContent(meta.footer.content) || pnBottom)) {
    parts['word/footer1.xml'] = hdrXml('ftr', hasContent(meta.footer.content) ? meta.footer.content : [], pnBottom);
    const fid = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', 'footer1.xml');
    footerRef = `<w:footerReference w:type="default" r:id="${fid}"/>`;
    // UDF's startPage only hides the header: Word's titlePg would hide the footer too
    if (titlePg) footerRef += `<w:footerReference w:type="first" r:id="${fid}"/>`;
  }
  const sect = `<w:sectPr>${headerRef}${footerRef}<w:pgSz w:w="${pageW}" w:h="${pageH}"${land ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin('topMargin', 56.7)}" w:right="${margin('rightMargin', 70.875)}" w:bottom="${margin('bottomMargin', 56.7)}" w:left="${margin('leftMargin', 70.875)}" w:header="${margin('headerFOffset', 20)}" w:footer="${margin('footerFOffset', 20)}" w:gutter="0"/>${titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;

  // numbering
  let numbering = '';
  if (lists.size) {
    let abs = '', nums = '';
    for (const l of lists.values()) {
      let lv = '';
      for (let i = 0; i < 9; i++) {
        const left = 360 * (i + 1) + 360;
        if (l.kind === 'bullet') lv += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${x(listLabel('bullet', l.type, 1))}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
        else lv += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${NUMFMT(l.type)}"/><w:lvlText w:val="%${i + 1}${NUMSUFFIX(l.type)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
      }
      abs += `<w:abstractNum w:abstractNumId="${l.numId}"><w:multiLevelType w:val="hybridMultilevel"/>${lv}</w:abstractNum>`;
      nums += `<w:num w:numId="${l.numId}"><w:abstractNumId w:val="${l.numId}"/></w:num>`;
    }
    numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${abs}${nums}</w:numbering>`;
    rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', 'numbering.xml');
  }

  // comments
  let commentsXml = '';
  if (comments.length) {
    commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${NS}>${comments.map((c, i) => {
      const paras = [c.text || '', ...(c.replies || []).map((r) => `— ${r.author}: ${r.text}`)];
      return `<w:comment w:id="${i}" w:author="${x(c.author)}" w:date="${x(normDate(c.at))}" w:initials="${x((c.author || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 3))}">${paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${x(p)}</w:t></w:r></w:p>`).join('')}</w:comment>`;
    }).join('')}</w:comments>`;
    rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments', 'comments.xml');
  }

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(base.family)}" w:hAnsi="${x(base.family)}" w:cs="${x(base.family)}" w:eastAsia="${x(base.family)}"/><w:sz w:val="${Math.round(base.size * 2)}"/><w:szCs w:val="${Math.round(base.size * 2)}"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}${sect}</w:body></w:document>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')}</Relationships>`;
  const exts = [...new Set(media.map((m) => m.ext))];
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${numbering ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ''}${commentsXml ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}${parts['word/header1.xml'] ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${parts['word/footer1.xml'] ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>egUDF</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

  const files = {
    '[Content_Types].xml': strToU8(ct),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'docProps/core.xml': strToU8(core),
    'word/document.xml': strToU8(docXml),
    'word/styles.xml': strToU8(styles),
    'word/_rels/document.xml.rels': strToU8(relsXml),
  };
  if (numbering) files['word/numbering.xml'] = strToU8(numbering);
  if (commentsXml) files['word/comments.xml'] = strToU8(commentsXml);
  for (const [k, v] of Object.entries(parts)) files[k] = strToU8(v);
  for (const m of media) files[`word/media/${m.name}`] = m.bytes;
  return zipSync(files, { level: 6 });
}

const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

function normDate(at) {
  const d = at ? new Date(at) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().replace(/\.\d+Z$/, 'Z');
}

// ================================================================== import

const kids = (n, name) => {
  const out = [];
  for (let c = n?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!name || c.localName === name)) out.push(c);
  return out;
};
const kid = (n, name) => kids(n, name)[0] || null;
const wa = (el, name) => (el ? el.getAttributeNS(W, name) || el.getAttribute(`w:${name}`) || null : null);
const on = (el) => !!el && !['false', '0', 'off', 'none'].includes(String(wa(el, 'val') ?? 'true'));

const HIGHLIGHT = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' };

export function isDocx(bytes) {
  try { const f = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { filter: (e) => e.name === 'word/document.xml' }); return !!f['word/document.xml']; } catch { return false; }
}

export function importDocx(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const xml = (p) => (files[p] ? new DOMParser({ onError: () => {} }).parseFromString(strFromU8(files[p]), 'text/xml') : null);
  const docDom = xml('word/document.xml');
  if (!docDom) throw new Error('Word belgesi okunamadı (word/document.xml yok).');
  const relsOf = (part) => {
    const dir = part.replace(/[^/]*$/, '');
    const d = xml(`${dir}_rels/${part.slice(dir.length)}.rels`);
    const map = {};
    for (const r of d ? kids(d.documentElement, 'Relationship') : []) map[r.getAttribute('Id')] = { target: r.getAttribute('Target'), type: r.getAttribute('Type'), dir };
    return map;
  };
  const resolveTarget = (r) => (r.target.startsWith('/') ? r.target.slice(1) : (r.dir + r.target).replace(/[^/]+\/\.\.\//g, ''));

  // ---- styles
  const stylesDom = xml('word/styles.xml');
  const styleMap = {};
  let defR = null, defP = null;
  if (stylesDom) {
    const dd = kid(stylesDom.documentElement, 'docDefaults');
    defR = kid(kid(dd, 'rPrDefault'), 'rPr');
    defP = kid(kid(dd, 'pPrDefault'), 'pPr');
    for (const s of kids(stylesDom.documentElement, 'style')) {
      styleMap[wa(s, 'styleId')] = { type: wa(s, 'type'), basedOn: wa(kid(s, 'basedOn'), 'val'), pPr: kid(s, 'pPr'), rPr: kid(s, 'rPr'), isDefault: wa(s, 'default') === '1' };
    }
  }
  const defaultPStyle = Object.entries(styleMap).find(([, s]) => s.type === 'paragraph' && s.isDefault)?.[0];
  const chain = (id, key) => {
    const out = [];
    for (let i = 0; id && styleMap[id] && i < 20; i++) { if (styleMap[id][key]) out.unshift(styleMap[id][key]); id = styleMap[id].basedOn; }
    return out;
  };

  // ---- numbering
  const numDom = xml('word/numbering.xml');
  const abstract = {}, numToAbs = {};
  if (numDom) {
    for (const a of kids(numDom.documentElement, 'abstractNum')) {
      const lv = {};
      for (const l of kids(a, 'lvl')) lv[wa(l, 'ilvl')] = { fmt: wa(kid(l, 'numFmt'), 'val'), text: wa(kid(l, 'lvlText'), 'val') || '', pPr: kid(l, 'pPr') };
      abstract[wa(a, 'abstractNumId')] = lv;
    }
    for (const n of kids(numDom.documentElement, 'num')) numToAbs[wa(n, 'numId')] = wa(kid(n, 'abstractNumId'), 'val');
  }
  const listType = (fmt, text) => {
    if (fmt === 'bullet' || fmt === 'none') {
      if (/[▪■]/.test(text)) return { kind: 'bullet', type: 'BULLET_TYPE_RECTANGLE' };
      if (/[►▶]/.test(text)) return { kind: 'bullet', type: 'BULLET_TYPE_TRIANGLE' };
      if (/[–-]/.test(text)) return { kind: 'bullet', type: 'BULLET_TYPE_DASH' };
      return { kind: 'bullet', type: 'BULLET_TYPE_ELLIPSE' };
    }
    const suffix = /\)\s*$/.test(text) ? 'PARANTEZ' : /-\s*$/.test(text) ? 'TRE' : 'DOT';
    if (fmt === 'upperRoman') return { kind: 'number', type: 'NUMBER_TYPE_ROMAN_BIG_DOT' };
    if (fmt === 'lowerRoman') return { kind: 'number', type: 'NUMBER_TYPE_ROMAN_SMALL_DOT' };
    if (fmt === 'upperLetter') return { kind: 'number', type: 'NUMBER_TYPE_LETTER_BIG_DOT' };
    if (fmt === 'lowerLetter') return { kind: 'number', type: 'NUMBER_TYPE_LETTER_SMALL_DOT' };
    return { kind: 'number', type: `NUMBER_TYPE_NUMBER_${suffix}` };
  };

  // ---- base font from docDefaults / Normal
  const baseR = readRPr([defR, ...chain(defaultPStyle, 'rPr')]);
  const base = { family: baseR.family || 'Calibri', size: baseR.size || 11 };

  function readRPr(list) {
    const o = {};
    for (const r of list) {
      if (!r) continue;
      for (const c of kids(r)) {
        switch (c.localName) {
          case 'rFonts': { const f = wa(c, 'ascii') || wa(c, 'hAnsi') || wa(c, 'cs'); if (f) o.family = f; break; }
          case 'sz': { const v = parseFloat(wa(c, 'val')); if (v) o.size = v / 2; break; }
          case 'b': o.bold = on(c); break;
          case 'i': o.italic = on(c); break;
          case 'u': o.underline = (wa(c, 'val') || 'single') !== 'none'; break;
          case 'strike': case 'dstrike': o.strike = on(c); break;
          case 'vertAlign': o.vert = wa(c, 'val'); break;
          case 'color': { const v = wa(c, 'val'); o.color = v && v !== 'auto' ? `#${v.toLowerCase()}` : null; break; }
          case 'highlight': { const v = wa(c, 'val'); o.hl = HIGHLIGHT[v] || null; break; }
          case 'shd': { const v = wa(c, 'fill'); if (v && v !== 'auto' && !/^f{6}$/i.test(v)) o.hl = o.hl || `#${v.toLowerCase()}`; break; }
          case 'caps': o.caps = on(c); break;
          default:
        }
      }
    }
    return o;
  }

  function readPPr(list) {
    const o = {};
    for (const p of list) {
      if (!p) continue;
      for (const c of kids(p)) {
        switch (c.localName) {
          case 'jc': o.align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[wa(c, 'val')] || 'left'; break;
          case 'ind': {
            const L = wa(c, 'left') ?? wa(c, 'start'), Rr = wa(c, 'right') ?? wa(c, 'end');
            if (L != null) o.leftIndent = parseFloat(L) / 20;
            if (Rr != null) o.rightIndent = parseFloat(Rr) / 20;
            if (wa(c, 'hanging') != null) o.firstLineIndent = -parseFloat(wa(c, 'hanging')) / 20;
            else if (wa(c, 'firstLine') != null) o.firstLineIndent = parseFloat(wa(c, 'firstLine')) / 20;
            break;
          }
          case 'spacing': {
            if (wa(c, 'before') != null) o.spaceAbove = parseFloat(wa(c, 'before')) / 20;
            if (wa(c, 'after') != null) o.spaceBelow = parseFloat(wa(c, 'after')) / 20;
            const line = parseFloat(wa(c, 'line'));
            const rule = wa(c, 'lineRule') || 'auto';
            if (line && rule === 'auto') o.lineSpacing = Math.max(0, Math.round((line / 240 - 1) * 100) / 100);
            break;
          }
          case 'numPr': {
            const id = wa(kid(c, 'numId'), 'val');
            const lvl = parseInt(wa(kid(c, 'ilvl'), 'val') || '0', 10);
            if (id && id !== '0') o.num = { id, lvl };
            else if (id === '0') o.num = null;
            break;
          }
          case 'tabs': o.tabs = kids(c, 'tab').filter((t) => wa(t, 'val') !== 'clear').map((t) => parseFloat(wa(t, 'pos')) / 20).filter((v) => v > 0); break;
          case 'contextualSpacing': o.contextual = on(c); break;
          default:
        }
      }
    }
    return o;
  }

  const marksOf = (r) => {
    const m = [];
    if (r.bold) m.push({ type: 'bold' });
    if (r.italic) m.push({ type: 'italic' });
    if (r.underline) m.push({ type: 'underline' });
    if (r.strike) m.push({ type: 'strike' });
    if (r.vert === 'superscript') m.push({ type: 'superscript' });
    if (r.vert === 'subscript') m.push({ type: 'subscript' });
    const ts = {};
    if (r.family && r.family !== base.family) ts.fontFamily = r.family;
    if (r.size && r.size !== base.size) ts.fontSize = `${r.size}pt`;
    if (r.color && r.color !== '#000000') ts.color = r.color;
    if (Object.keys(ts).length) m.push({ type: 'textStyle', attrs: { fontFamily: null, fontSize: null, color: null, ...ts } });
    if (r.hl) m.push({ type: 'highlight', attrs: { color: r.hl } });
    return m;
  };

  // ---- comments
  const comments = [];
  const cDom = xml('word/comments.xml');
  const cById = {};
  if (cDom) {
    for (const c of kids(cDom.documentElement, 'comment')) {
      const id = `w${wa(c, 'id')}`;
      const text = kids(c, 'p').map((p) => textOf(p)).join('\n').trim();
      cById[id] = { id, author: wa(c, 'author') || 'Word', at: wa(c, 'date') || new Date().toISOString(), text, quote: '', resolved: false, replies: [] };
    }
  }
  function textOf(n) {
    let s = '';
    const walk = (e) => { for (const c of kids(e)) { if (c.localName === 't') s += c.textContent; else if (c.localName === 'tab') s += '\t'; else walk(c); } };
    walk(n);
    return s;
  }

  // ---- blocks
  const docRels = relsOf('word/document.xml');
  const activeComments = new Set();
  let listSeq = 0;
  const listIds = {};

  // usable width for top-level tables (twips); nested tables get their cell's width
  const sect0 = kid(kid(docDom.documentElement, 'body'), 'sectPr');
  const pageTw = (() => {
    const sz = kid(sect0, 'pgSz'), mar = kid(sect0, 'pgMar');
    const w = parseFloat(wa(sz, 'w')) || 11906;
    return w - (parseFloat(wa(mar, 'left')) || 1418) - (parseFloat(wa(mar, 'right')) || 1418);
  })();

  function parseBlocks(container, rels, maxTw = pageTw) {
    const out = [];
    const ctx = []; // contextualSpacing bookkeeping, parallel to out
    const add = (nodes, info) => { for (const n of nodes) { out.push(n); ctx.push(info); } };
    for (const el of kids(container)) {
      if (el.localName === 'p') {
        const r = parseParagraph(el, rels);
        add(r.nodes, r.info);
      } else if (el.localName === 'tbl') add([parseTable(el, rels, maxTw)], null);
      else if (el.localName === 'sdt') add(parseBlocks(kid(el, 'sdtContent'), rels, maxTw), null);
      else if (['ins', 'del', 'customXml', 'smartTag'].includes(el.localName)) add(parseBlocks(el, rels, maxTw), null);
    }
    // "Don't add space between paragraphs of the same style" (w:contextualSpacing)
    for (let i = 1; i < out.length; i++) {
      const a = ctx[i - 1], b = ctx[i];
      if (a && b && a.style === b.style && (a.contextual || b.contextual)) {
        if (a.contextual) out[i - 1].attrs.spaceBelow = 0;
        if (b.contextual) out[i].attrs.spaceAbove = 0;
      }
    }
    return out;
  }

  function parseParagraph(p, rels) {
    const ppr = kid(p, 'pPr');
    const pStyle = wa(kid(ppr, 'pStyle'), 'val') || defaultPStyle;
    const pp = readPPr([defP, ...chain(pStyle, 'pPr'), ppr]);
    const styleR = [defR, ...chain(pStyle, 'rPr')];
    const attrs = defaultParaAttrs();
    if (pp.align) attrs.align = pp.align;
    let num = pp.num;
    if (num) {
      const lv = abstract[numToAbs[num.id]]?.[String(num.lvl)];
      if (lv && lv.fmt !== 'none') {
        const lt = listType(lv.fmt, lv.text);
        listIds[num.id] ??= String(++listSeq);
        attrs.list = { ...lt, id: listIds[num.id], level: num.lvl + 1 };
        const li = readPPr([lv.pPr]);
        if (pp.leftIndent == null && li.leftIndent != null) pp.leftIndent = li.leftIndent;
        if (pp.firstLineIndent == null && li.firstLineIndent != null) pp.firstLineIndent = li.firstLineIndent;
      } else num = null;
    }
    for (const k of ['leftIndent', 'rightIndent', 'firstLineIndent', 'spaceAbove', 'spaceBelow', 'lineSpacing']) if (pp[k] != null) attrs[k] = Math.round(pp[k] * 100) / 100;
    if (pp.tabs?.length) attrs.tabSet = pp.tabs.map((t) => `${t}:0:0`).join(',');
    const pch = kid(ppr, 'pPrChange');
    if (pch) {
      const bp = readPPr([defP, ...chain(wa(kid(kid(pch, 'pPr'), 'pStyle'), 'val') || pStyle, 'pPr'), kid(pch, 'pPr')]);
      const before = { ...attrs, list: bp.num ? attrs.list : null };
      before.align = bp.align || 'left';
      for (const k of ['leftIndent', 'rightIndent', 'firstLineIndent', 'spaceAbove', 'spaceBelow', 'lineSpacing']) before[k] = bp[k] != null ? Math.round(bp[k] * 100) / 100 : defaultParaAttrs()[k];
      attrs.fmtChange = { author: wa(pch, 'author') || 'Word', at: wa(pch, 'date') || '', before };
    }
    const paras = [[]];
    const fields = []; // fldChar stack: 'instr' until separate, then 'result'
    const inInstr = () => fields.includes('instr');
    const cur = () => paras[paras.length - 1];
    const pushText = (text, marks) => {
      if (!text) return;
      for (const id of activeComments) if (cById[id] && cById[id].quote.length < 200) cById[id].quote += text;
      const cm = [...activeComments].map((id) => ({ type: 'comment', attrs: { id } }));
      cur().push({ type: 'text', text, marks: [...marks, ...cm] });
    };
    const run = (r, extraMarks) => {
      const rpr = kid(r, 'rPr');
      const rStyle = wa(kid(rpr, 'rStyle'), 'val');
      const rp = readRPr([...styleR, ...chain(rStyle, 'rPr'), rpr]);
      const marks = [...marksOf(rp), ...extraMarks];
      const rch = kid(rpr, 'rPrChange');
      if (rch) marks.push({ type: 'formatChange', attrs: { author: wa(rch, 'author') || 'Word', at: wa(rch, 'date') || '', before: marksOf(readRPr([...styleR, ...chain(rStyle, 'rPr'), kid(rch, 'rPr')])) } });
      for (const c of kids(r)) {
        switch (c.localName) {
          case 't': case 'delText': if (!inInstr()) pushText(rp.caps ? c.textContent.toLocaleUpperCase('tr') : c.textContent, marks); break;
          case 'tab': if (!inInstr()) pushText('\t', marks); break;
          case 'br': case 'cr': if (!inInstr()) paras.push([]); break;
          case 'noBreakHyphen': pushText('-', marks); break;
          case 'fldChar': { const t = wa(c, 'fldCharType'); if (t === 'begin') fields.push('instr'); else if (t === 'separate') fields[fields.length - 1] = 'result'; else if (t === 'end') fields.pop(); break; }
          case 'drawing': case 'pict': {
            const blip = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0];
            const rid = blip?.getAttributeNS(R, 'embed') || blip?.getAttribute('r:embed');
            const target = rid && rels[rid] ? resolveTarget(rels[rid]) : null;
            const data = target && files[target];
            if (!data) break;
            const ext = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
            const wPt = ext ? parseFloat(ext.getAttribute('cx')) / EMU_PER_PT : null;
            const hPt = ext ? parseFloat(ext.getAttribute('cy')) / EMU_PER_PT : null;
            const mime = /\.png$/i.test(target) ? 'image/png' : /\.gif$/i.test(target) ? 'image/gif' : /\.bmp$/i.test(target) ? 'image/bmp' : 'image/jpeg';
            if (/\.(emf|wmf|svg)$/i.test(target)) break;
            cur().push({ type: 'image', attrs: { src: `data:${mime};base64,${b64(data)}`, width: wPt ? Math.round(wPt) : null, height: hPt ? Math.round(hPt) : null, extra: null } });
            break;
          }
          default:
        }
      }
    };
    const walk = (node, extraMarks) => {
      for (const c of kids(node)) {
        switch (c.localName) {
          case 'r': run(c, extraMarks); break;
          case 'ins': walk(c, [...extraMarks, { type: 'insertion', attrs: { author: wa(c, 'author') || 'Word', at: wa(c, 'date') || '' } }]); break;
          case 'del': walk(c, [...extraMarks, { type: 'deletion', attrs: { author: wa(c, 'author') || 'Word', at: wa(c, 'date') || '' } }]); break;
          case 'hyperlink': case 'smartTag': case 'customXml': case 'fldSimple': case 'sdtContent': walk(c, extraMarks); break;
          case 'sdt': walk(kid(c, 'sdtContent'), extraMarks); break;
          case 'commentRangeStart': activeComments.add(`w${wa(c, 'id')}`); break;
          case 'commentRangeEnd': activeComments.delete(`w${wa(c, 'id')}`); break;
          default:
        }
      }
    };
    walk(p, []);
    const nodes = paras.map((content, i) => {
      const a = i ? { ...attrs, list: null, firstLineIndent: attrs.list ? 0 : attrs.firstLineIndent } : attrs;
      const merged = [];
      for (const n of content) {
        const last = merged[merged.length - 1];
        if (n.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(n.marks)) last.text += n.text;
        else merged.push(n);
      }
      for (const n of merged) if (n.type === 'text' && !n.marks.length) delete n.marks;
      return merged.length ? { type: 'paragraph', attrs: a, content: merged } : { type: 'paragraph', attrs: a };
    });
    return { nodes, info: { style: pStyle || '', contextual: !!pp.contextual } };
  }

  function parseTable(t, rels, maxTw = pageTw) {
    const tblPr = kid(t, 'tblPr');
    const borders = kid(tblPr, 'tblBorders');
    const styleId = wa(kid(tblPr, 'tblStyle'), 'val') || '';
    const visible = borders ? kids(borders).some((b) => !['nil', 'none'].includes(wa(b, 'val'))) : /Grid|Table/i.test(styleId) && !/Normal/i.test(styleId);
    let grid = kids(kid(t, 'tblGrid'), 'gridCol').map((g) => parseFloat(wa(g, 'w')) || 0);
    // Word lets tables hang into the margins (negative tblInd); here they must fit the page/cell
    const total = grid.reduce((a, v) => a + v, 0);
    if (maxTw > 0 && total > maxTw) grid = grid.map((g) => (g * maxTw) / total);
    const rows = [];
    for (const tr of kids(t, 'tr')) {
      let gi = 0;
      const cells = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = parseInt(wa(kid(tcPr, 'gridSpan'), 'val') || '1', 10) || 1;
        const wTw = grid.slice(gi, gi + span).reduce((a, v) => a + v, 0) || parseFloat(wa(kid(tcPr, 'tcW'), 'w')) || 0;
        gi += span;
        const content = parseBlocks(tc, rels, wTw - 216);
        cells.push({ type: 'tableCell', attrs: { colspan: span, rowspan: 1, colwidth: wTw ? [Math.max(24, Math.round(wTw / 15))] : null, udf: {} }, content: content.length ? content : [{ type: 'paragraph', attrs: defaultParaAttrs() }] });
      }
      if (cells.length) rows.push({ type: 'tableRow', attrs: { udf: {} }, content: cells });
    }
    if (!rows.length) rows.push({ type: 'tableRow', attrs: { udf: {} }, content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, udf: {} }, content: [{ type: 'paragraph', attrs: defaultParaAttrs() }] }] });
    return { type: 'table', attrs: { udf: { border: visible ? 'borderCell' : 'borderNone' } }, content: rows };
  }

  const body = kid(docDom.documentElement, 'body');
  const content = parseBlocks(body, docRels);
  if (!content.length) content.push({ type: 'paragraph', attrs: defaultParaAttrs() });

  // ---- section: page setup, header/footer
  const meta = newDocMeta();
  meta.base = base;
  meta.styles = meta.styles.map((s) => (s.name === 'hvl-default' ? { ...s, family: base.family, size: String(base.size) } : s));
  const sect = kid(body, 'sectPr');
  if (sect) {
    const sz = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    const wTw = parseFloat(wa(sz, 'w')), hTw = parseFloat(wa(sz, 'h'));
    if (wa(sz, 'orient') === 'landscape' || (wTw && hTw && wTw > hTw)) meta.pageFormat.paperOrientation = '0';
    const m = (k) => { const v = parseFloat(wa(mar, k)); return Number.isFinite(v) ? String(Math.round(v / 20 * 1000) / 1000) : null; };
    for (const [k, mk] of [['top', 'topMargin'], ['bottom', 'bottomMargin'], ['left', 'leftMargin'], ['right', 'rightMargin'], ['header', 'headerFOffset'], ['footer', 'footerFOffset']]) {
      const v = m(k);
      if (v != null) meta.pageFormat[mk] = String(Math.abs(parseFloat(v)));
    }
    const ref = (tag) => {
      const refs = kids(sect, `${tag}Reference`);
      const r = refs.find((e) => wa(e, 'type') === 'default') || refs[0];
      const id = r && (r.getAttributeNS(R, 'id') || r.getAttribute('r:id'));
      return id && docRels[id] ? resolveTarget(docRels[id]) : null;
    };
    const hp = ref('header'), fp = ref('footer');
    // a PAGE field in the header/footer becomes UYAP's page number; its paragraph is dropped
    let pn = null;
    const takePn = (path, blocks, vert) => {
      const src = strFromU8(files[path]);
      if (!/\bPAGE\b/.test(src) || pn) return blocks;
      const o = { vert, pos: 'right', total: /\bNUMPAGES\b/.test(src), prefix: '', sep: '/' };
      const RE = /^\s*((?:sayfa|page)\s*)?\d+(?:\s*([/|-]|of)\s*\d+)?\s*$/i;
      const rest = blocks.filter((bl) => {
        const m = RE.exec((bl.content || []).map((c) => c.text || '').join(''));
        if (!m) return true;
        if (m[1]) o.prefix = 'Sayfa ';
        if (m[2] && m[2].toLowerCase() !== 'of') o.sep = m[2];
        o.pos = bl.attrs?.align === 'center' ? 'center' : bl.attrs?.align === 'left' ? 'left' : 'right';
        return false;
      });
      if (rest.length < blocks.length || vert === 'bottom') pn = o;
      return rest;
    };
    if (hp && files[hp]) {
      const hc = takePn(hp, parseBlocks(xml(hp).documentElement, relsOf(hp)), 'top');
      if (hc.some((bl) => bl.content?.length)) meta.header = { attrs: { background: '-1', foreground: '-8355712', startPage: kid(sect, 'titlePg') ? '2' : '1' }, content: hc };
    }
    let fc = [];
    if (fp && files[fp]) fc = takePn(fp, parseBlocks(xml(fp).documentElement, relsOf(fp)), 'bottom');
    if (pn || fc.some((bl) => bl.content?.length)) meta.footer = { attrs: writePageNumber({ background: '-1', foreground: '-8355712' }, pn), content: fc.length ? fc : [{ type: 'paragraph', attrs: defaultParaAttrs() }] };
  }
  for (const c of Object.values(cById)) comments.push(c);
  return { doc: { type: 'doc', content }, meta, review: { comments } };
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

