// content.xml ⇄ editor document (ProseMirror JSON).
//
// UDF layout (format_id 1.8, a dump of a Java Swing StyledDocument):
//   <template format_id="1.8">
//     <content><![CDATA[ all text; every paragraph ends with "\n" ]]></content>
//     <properties><pageFormat …margins in points…/></properties>
//     <elements resolver="hvl-default">
//       [<header …>paragraphs</header>]
//       <paragraph Alignment LeftIndent … Numbered ListId …>
//         <content|field|space|tab|image startOffset length …char attrs…/>…
//       </paragraph>
//       <table columnCount columnSpans border><row><cell>paragraphs</cell></row></table>
//       [<footer pageNumber-spec …>paragraphs</footer>]
//     </elements>
//     <styles><style name="hvl-default" family size …/>…</styles>
//     [<webID …/>, <data>…</data>]   (UYAP template payloads — kept verbatim)
//   </template>
//
// Import resolves named styles into explicit marks/attributes; export writes
// every run with explicit family+size, so the result never depends on style
// resolution order. Field runs (<field fieldName…>) and unknown attributes are
// carried through so UYAP form templates keep working.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ALIGN, IMAGE_CHAR, PT_TO_PX, javaToHex, hexToJava, jfloat, num, imageMime, uyapLevelType, uyapListType } from './common.js';

const CHAR_KEYS = new Set(['family', 'size', 'bold', 'italic', 'underline', 'strikethrough', 'foreground', 'background', 'subscript', 'superscript']);
const PARA_NUM = [['LeftIndent', 'leftIndent'], ['RightIndent', 'rightIndent'], ['FirstLineIndent', 'firstLineIndent'], ['Hanging', 'hanging'], ['SpaceAbove', 'spaceAbove'], ['SpaceBelow', 'spaceBelow'], ['LineSpacing', 'lineSpacing']];
const LIST_KEYS = ['Numbered', 'Bulleted', 'NumberType', 'BulletType', 'ListId', 'ListLevel', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `SecListTypeLevel${n}`)];
const PARA_KEYS = new Set(['Alignment', 'TabSet', ...PARA_NUM.map((p) => p[0]), ...LIST_KEYS]);
const STYLE_ONLY = new Set(['resolver', 'description', 'name', 'FONT_ATTRIBUTE_KEY']);
const RUN_POS = new Set(['startOffset', 'length']);

export const DEFAULT_STYLES = [
  { name: 'default', description: 'Geçerli', family: 'Dialog', size: '12', bold: 'false', italic: 'false', foreground: '-13421773', FONT_ATTRIBUTE_KEY: 'javax.swing.plaf.FontUIResource[family=Dialog,name=Dialog,style=plain,size=12]' },
  { name: 'hvl-default', family: 'Times New Roman', size: '12', description: 'Gövde' },
];

export const DEFAULT_PAGE = {
  mediaSizeName: '1', leftMargin: '70.875', rightMargin: '70.875', topMargin: '56.7', bottomMargin: '56.7',
  paperOrientation: '1', headerFOffset: '20.0', footerFOffset: '20.0',
};

// ------------------------------------------------------------------ helpers

const elems = (n) => {
  const out = [];
  for (let c = n?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
};
const attrsOf = (el) => {
  const o = {};
  const a = el.attributes;
  for (let i = 0; i < (a?.length || 0); i++) o[a[i].name] = a[i].value;
  return o;
};
const pick = (o, keys) => {
  const r = {};
  for (const k of Object.keys(o || {})) if (keys.has(k)) r[k] = o[k];
  return r;
};
const omit = (o, ...sets) => {
  const r = {};
  for (const k of Object.keys(o || {})) if (!sets.some((s) => s.has(k))) r[k] = o[k];
  return r;
};
const sameMarks = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

// ------------------------------------------------------------------ parse

/**
 * parseUdfXml(xmlString) → { doc, meta }
 * doc  — ProseMirror JSON for the body
 * meta — everything else needed to write the file back (page format, styles,
 *        header/footer docs, verbatim template extras)
 */
export function parseUdfXml(xmlString) {
  const errors = [];
  const dom = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg); } })
    .parseFromString(xmlString, 'text/xml');
  const root = dom.documentElement;
  if (!root || root.tagName !== 'template') throw new Error(`UDF içeriği okunamadı${errors.length ? `: ${errors[0]}` : ''}`);

  const kids = elems(root);
  const byTag = (t) => kids.find((k) => k.tagName === t);
  const text = byTag('content')?.textContent ?? '';
  const styles = elems(byTag('styles')).filter((s) => s.tagName === 'style').map(attrsOf);
  const styleMap = Object.fromEntries(styles.map((s) => [s.name, s]));
  const elementsEl = byTag('elements');
  const elementsAttrs = elementsEl ? attrsOf(elementsEl) : { resolver: 'hvl-default' };
  const baseStyle = { family: 'Times New Roman', size: '12', ...(styleMap['hvl-default'] || {}), ...(styleMap[elementsAttrs.resolver] || {}) };
  const base = { family: baseStyle.family || 'Times New Roman', size: num(baseStyle.size, 12) };
  const pageFormat = { ...DEFAULT_PAGE, ...attrsOf(byTag('properties') ? elems(byTag('properties')).find((e) => e.tagName === 'pageFormat') || { attributes: [] } : { attributes: [] }) };
  const ser = new XMLSerializer();
  const tail = kids.filter((k) => !['content', 'properties', 'elements', 'styles'].includes(k.tagName)).map((k) => ser.serializeToString(k));

  const contentWidthPt = (pageFormat.paperOrientation === '1' || !pageFormat.paperOrientation ? 595.2756 : 841.8898)
    - num(pageFormat.leftMargin, 70.875) - num(pageFormat.rightMargin, 70.875);
  const ctx = { text, styleMap, base, ser, contentWidthPt };

  let header = null, footer = null;
  const unknown = [];
  const body = [];
  for (const el of elems(elementsEl)) {
    if (el.tagName === 'header') header = { attrs: attrsOf(el), content: parseBlocks(el, ctx, null, ctx.contentWidthPt) };
    else if (el.tagName === 'footer') footer = { attrs: attrsOf(el), content: parseBlocks(el, ctx, null, ctx.contentWidthPt) };
    else if (el.tagName === 'paragraph') body.push(parseParagraph(el, ctx));
    else if (el.tagName === 'table') body.push(parseTable(el, ctx, ctx.contentWidthPt));
    else unknown.push({ index: body.length, xml: ser.serializeToString(el) });
  }
  if (!body.length) body.push({ type: 'paragraph', attrs: defaultParaAttrs() });

  return {
    doc: { type: 'doc', content: body },
    meta: {
      formatId: root.getAttribute('format_id') || '1.8',
      pageFormat,
      styles: styles.length ? styles : DEFAULT_STYLES.map((s) => ({ ...s })),
      elementsAttrs,
      base,
      header,
      footer,
      unknown,
      tail,
    },
  };
}

export function defaultParaAttrs() {
  return {
    align: 'left', leftIndent: 0, rightIndent: 0, firstLineIndent: 0, hanging: 0,
    spaceAbove: 0, spaceBelow: 0, lineSpacing: 0, tabSet: null, list: null, extra: null,
    // Word-only paragraph properties (not written to UDF): lineRule 'exact'|'atLeast'
    // with lineHeight in pt; border { top|bottom|left|right: { style, width, color, space } }
    lineRule: null, lineHeight: null, pageBreakBefore: false, keepNext: false, border: null, shading: null,
    // strut { size (pt), family }: the paragraph's own font when it differs from the
    // document's — Word sizes lines from the runs (and empty paragraphs from the mark)
    strut: null,
  };
}

function parseBlocks(parent, ctx, unknownSink, widthPt) {
  const out = [];
  for (const el of elems(parent)) {
    if (el.tagName === 'paragraph') out.push(parseParagraph(el, ctx));
    else if (el.tagName === 'table') out.push(parseTable(el, ctx, widthPt));
    else unknownSink?.push({ index: out.length, xml: ctx.ser.serializeToString(el) });
  }
  return out;
}

function paraAttrsFrom(eff, own) {
  const a = defaultParaAttrs();
  a.align = ALIGN[parseInt(eff.Alignment || '0', 10)] || 'left';
  for (const [k, n] of PARA_NUM) a[n] = num(eff[k]);
  a.tabSet = eff.TabSet || null;
  if (eff.Numbered === 'true' || eff.Bulleted === 'true') {
    const numbered = eff.Numbered === 'true';
    const kind = numbered ? 'number' : 'bullet';
    const level = parseInt(eff.ListLevel || '1', 10) || 1;
    // what UYAP shows: SecListTypeLevelN, else the type (level 1) or its level default
    a.list = { kind, type: uyapLevelType(kind, level, numbered ? eff.NumberType : eff.BulletType, eff[`SecListTypeLevel${level}`]), id: String(eff.ListId || '1'), level };
  }
  const extra = omit(own, PARA_KEYS, CHAR_KEYS, STYLE_ONLY);
  a.extra = Object.keys(extra).length ? extra : null;
  return a;
}

function marksFrom(ce, base) {
  const marks = [];
  if (ce.bold === 'true') marks.push({ type: 'bold' });
  if (ce.italic === 'true') marks.push({ type: 'italic' });
  if (ce.strikethrough === 'true') marks.push({ type: 'strike' });
  if (ce.underline === 'true') marks.push({ type: 'underline' });
  if (ce.subscript === 'true') marks.push({ type: 'subscript' });
  if (ce.superscript === 'true') marks.push({ type: 'superscript' });
  const ts = {};
  if (ce.family && ce.family !== base.family) ts.fontFamily = ce.family;
  const size = num(ce.size, base.size);
  if (size !== base.size) ts.fontSize = `${size}pt`;
  const fg = javaToHex(ce.foreground);
  if (fg && fg !== '#000000') ts.color = fg;
  if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: { fontFamily: null, fontSize: null, color: null, ...ts } });
  const bg = javaToHex(ce.background);
  if (bg && bg !== '#ffffff') marks.push({ type: 'highlight', attrs: { color: bg } });
  return marks;
}

function parseParagraph(el, ctx) {
  const own = attrsOf(el);
  const pStyle = ctx.styleMap[own.resolver] || {};
  const eff = { ...pick(pStyle, PARA_KEYS), ...own };
  const node = { type: 'paragraph', attrs: paraAttrsFrom(eff, own) };
  const charBase = { family: ctx.base.family, size: String(ctx.base.size), ...pick(pStyle, CHAR_KEYS), ...pick(own, CHAR_KEYS) };
  const inl = [];
  for (const r of elems(el)) {
    const ra = attrsOf(r);
    const rStyle = ctx.styleMap[ra.resolver] || {};
    const ce = { ...charBase, ...pick(rStyle, CHAR_KEYS), ...pick(ra, CHAR_KEYS) };
    if (r.tagName === 'image') {
      const b64 = (ra.imageData || '').replace(/\s+/g, '');
      if (b64) {
        const extra = omit(ra, CHAR_KEYS, RUN_POS, STYLE_ONLY, PARA_KEYS, new Set(['imageData', 'width', 'height']));
        inl.push({
          type: 'image',
          attrs: {
            src: `data:${imageMime(b64)};base64,${b64}`,
            width: ra.width ? num(ra.width) : null,
            height: ra.height ? num(ra.height) : null,
            extra: Object.keys(extra).length ? extra : null,
          },
        });
      }
      continue;
    }
    const start = parseInt(ra.startOffset || '0', 10);
    let t = ctx.text.substr(start, parseInt(ra.length || '0', 10));
    t = t.replace(/[\r\n]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    if (!t) continue;
    const marks = marksFrom(ce, ctx.base);
    const extra = omit(ra, CHAR_KEYS, RUN_POS, STYLE_ONLY, PARA_KEYS);
    const keepTag = r.tagName === 'field';
    if (keepTag || Object.keys(extra).length) {
      marks.push({ type: 'udfRun', attrs: { tag: keepTag ? 'field' : (r.tagName === 'space' ? 'space' : 'content'), extra } });
    }
    const prev = inl[inl.length - 1];
    if (prev?.type === 'text' && sameMarks(prev.marks, marks)) prev.text += t;
    else inl.push(marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t });
  }
  if (inl.length) node.content = inl;
  return node;
}

const CELL_CHROME_PT = 7.5;

function spansToWidths(spans, cols, widthPt) {
  const s = String(spans || '').split(',').map((x) => num(x, NaN));
  const total = s.length === cols && s.every((x) => Number.isFinite(x) && x > 0) ? s.reduce((a, b) => a + b, 0) : 0;
  const want = Array.from({ length: cols }, (_, i) => (total ? s[i] / total : 1 / cols) * widthPt * PT_TO_PX);
  // columns below the 24px minimum are widened at the expense of the others, so the
  // table keeps its width (spans like "1,30" otherwise overflow the parent cell)
  const MIN = 24;
  const target = Math.max(widthPt * PT_TO_PX, MIN * cols);
  const small = want.map((w) => w < MIN);
  const rest = want.reduce((a, w, i) => a + (small[i] ? 0 : w), 0);
  const avail = target - MIN * small.filter(Boolean).length;
  const out = want.map((w, i) => (small[i] ? MIN : Math.max(MIN, rest ? (w / rest) * avail : MIN)));
  // round without growing the total
  let acc = 0, prev = 0;
  return out.map((w) => { acc += w; const r = Math.floor(acc) - prev; prev += r; return r; });
}

function parseTable(tEl, ctx, widthPt) {
  const ta = attrsOf(tEl);
  const rowEls = elems(tEl).filter((r) => r.tagName === 'row' || /^row/i.test(r.tagName));
  const cols = Math.max(1, parseInt(ta.columnCount || '0', 10) || Math.max(1, ...rowEls.map((r) => elems(r).filter((c) => c.tagName === 'cell').length)));
  const widths = spansToWidths(ta.columnSpans, cols, widthPt);
  const rows = rowEls.map((rEl) => {
    const ra = attrsOf(rEl);
    const rowWidths = ra.columnSpans ? spansToWidths(ra.columnSpans, elems(rEl).filter((c) => c.tagName === 'cell').length, widthPt) : widths;
    const cells = elems(rEl).filter((c) => c.tagName === 'cell').map((cEl, i) => {
      // nested tables get the cell's inner width (minus 3pt padding + 0.75pt border each side), or they overflow it
      const content = parseBlocks(cEl, ctx, null, Math.max(24, (rowWidths[i] || widths[0]) / PT_TO_PX - CELL_CHROME_PT));
      return {
        type: 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: [rowWidths[i] || rowWidths[rowWidths.length - 1]], udf: attrsOf(cEl) },
        content: content.length ? content : [{ type: 'paragraph', attrs: defaultParaAttrs() }],
      };
    });
    return { type: 'tableRow', attrs: { udf: { ...ra, _tag: rEl.tagName } }, content: cells.length ? cells : [emptyCell()] };
  });
  const content = rows.length ? rows : [{ type: 'tableRow', attrs: { udf: {} }, content: [emptyCell()] }];
  return { type: 'table', attrs: { udf: { ...ta, _tag: tEl.tagName, _sig: gridSig(content) } }, content };
}

/** Fingerprint of a table grid: unchanged grid ⇒ original column attrs are written back verbatim. */
export const gridSig = (rows) => rows.map((r) => (r.content || []).map((c) => `${c.attrs?.colspan || 1}:${(c.attrs?.colwidth || []).join('+')}`).join(',')).join('|');

const emptyCell = () => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, udf: {} }, content: [{ type: 'paragraph', attrs: defaultParaAttrs() }] });

// ------------------------------------------------------------------ serialize

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const attrStr = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

/**
 * serializeUdfXml(doc, meta) → content.xml string
 * doc — ProseMirror JSON (body); meta — as returned by parseUdfXml (or newDocMeta()).
 */
/**
 * UDF has no line break inside a paragraph (Word's Shift+Enter): one paragraph
 * per line, without paragraph spacing between the lines.
 */
export function splitBreaks(n) {
  if (n.type === 'table') {
    return [{ ...n, content: (n.content || []).map((r) => ({ ...r, content: (r.content || []).map((c) => ({ ...c, content: (c.content || []).flatMap(splitBreaks) })) })) }];
  }
  if (n.type !== 'paragraph' || !(n.content || []).some((c) => c.type === 'hardBreak')) return [n];
  const lines = [[]];
  for (const c of n.content) if (c.type === 'hardBreak') lines.push([]); else lines[lines.length - 1].push(c);
  const a = n.attrs || {};
  return lines.map((content, i) => ({
    type: 'paragraph',
    attrs: { ...a, ...(i ? { list: null, firstLineIndent: a.list ? 0 : (a.firstLineIndent || 0), spaceAbove: 0 } : {}), ...(i < lines.length - 1 ? { spaceBelow: 0 } : {}) },
    ...(content.length ? { content } : {}),
  }));
}

export function serializeUdfXml(doc, meta) {
  const base = meta.base || { family: 'Times New Roman', size: 12 };
  const w = { text: '', base };
  const out = [];

  if (meta.header) out.push(`<header${attrStr(meta.header.attrs || {})}>${blocksXml((meta.header.content || []).flatMap(splitBreaks), w)}</header>`);
  const unknown = [...(meta.unknown || [])].sort((a, b) => a.index - b.index);
  let ui = 0;
  (doc.content || []).forEach((n, i) => {
    while (ui < unknown.length && unknown[ui].index <= i) out.push(unknown[ui++].xml);
    for (const piece of splitBreaks(n)) out.push(blockXml(piece, w));
  });
  while (ui < unknown.length) out.push(unknown[ui++].xml);
  if (meta.footer) out.push(`<footer${attrStr(meta.footer.attrs || {})}>${blocksXml((meta.footer.content || []).flatMap(splitBreaks), w)}</footer>`);

  const styles = (meta.styles?.length ? meta.styles : DEFAULT_STYLES).map((s) => `<style${attrStr(s)} />`).join('');
  const cdata = w.text.split(']]>').join(']]]]><![CDATA[>');
  return `<?xml version="1.0" encoding="UTF-8" ?> \n\n<template format_id="${esc(meta.formatId || '1.8')}" >\n`
    + `<content><![CDATA[${cdata}]]></content>\n`
    + `<properties><pageFormat${attrStr(meta.pageFormat || DEFAULT_PAGE)} /></properties>\n`
    + `<elements resolver="hvl-default" >\n${out.join('\n')}\n</elements>\n`
    + `<styles>${styles}</styles>\n`
    + (meta.tail?.length ? `${meta.tail.join('\n')}\n` : '')
    + '</template>';
}

function blocksXml(blocks, w) {
  return blocks.map((b) => blockXml(b, w)).join('');
}

function blockXml(n, w) {
  if (n.type === 'table') return tableXml(n, w);
  if (n.type === 'paragraph') return paragraphXml(n, w);
  // anything else the editor may hold (shouldn't happen): flatten its text into a paragraph
  return paragraphXml({ type: 'paragraph', attrs: defaultParaAttrs(), content: flattenInline(n) }, w);
}

function flattenInline(n) {
  const out = [];
  (function walk(x) {
    if (x.type === 'text' || x.type === 'image') out.push(x);
    else (x.content || []).forEach(walk);
  })(n);
  return out;
}

function paraXmlAttrs(a = {}) {
  const o = { Alignment: String(Math.max(0, ALIGN.indexOf(a.align || 'left'))) };
  for (const [k, n] of PARA_NUM) if (a[n]) o[k] = jfloat(a[n]);
  // UYAP draws a bullet ~12pt left of LeftIndent whatever FirstLineIndent says, so a
  // Word-style hanging list (LeftIndent 36, FirstLineIndent -18) puts the bullet on
  // the first word. Without the hanging part UYAP shows Word's layout: label in the
  // margin, every line of text at LeftIndent. (Verified in Doküman Editörü 5.4.20.)
  if (a.list && (a.firstLineIndent || 0) < 0) delete o.FirstLineIndent;
  if (a.tabSet) o.TabSet = a.tabSet;
  if (a.list) {
    // only names UYAP knows, and the level's style spelled out (UYAP otherwise uses its own per-level default)
    const type = uyapListType(a.list.kind, a.list.type);
    if (a.list.kind === 'number') { o.Numbered = 'true'; o.NumberType = type; } else { o.Bulleted = 'true'; o.BulletType = type; }
    o.ListLevel = String(a.list.level || 1);
    o.ListId = String(a.list.id || 1);
    o[`SecListTypeLevel${a.list.level || 1}`] = type;
  }
  return { ...o, ...(a.extra || {}) };
}

function runAttrs(marks, base) {
  const o = { family: base.family, size: String(base.size) };
  let tag = 'content';
  let extra = {};
  for (const m of marks || []) {
    switch (m.type) {
      case 'bold': o.bold = 'true'; break;
      case 'italic': o.italic = 'true'; break;
      case 'underline': o.underline = 'true'; break;
      case 'strike': o.strikethrough = 'true'; break;
      case 'subscript': o.subscript = 'true'; break;
      case 'superscript': o.superscript = 'true'; break;
      case 'textStyle': {
        const a = m.attrs || {};
        if (a.fontFamily) o.family = String(a.fontFamily).split(',')[0].replace(/["']/g, '').trim();
        if (a.fontSize) o.size = String(Math.round(cssSizeToPt(a.fontSize) * 2) / 2).replace(/\.0$/, '');
        const fg = hexToJava(a.color);
        if (fg) o.foreground = fg;
        break;
      }
      case 'highlight': {
        const bg = hexToJava(m.attrs?.color || '#ffff00');
        if (bg) o.background = bg;
        break;
      }
      case 'udfRun':
        tag = m.attrs?.tag === 'field' ? 'field' : m.attrs?.tag === 'space' ? 'space' : 'content';
        extra = m.attrs?.extra || {};
        break;
      default:
    }
  }
  return { tag, attrs: { ...o, ...extra } };
}

export function cssSizeToPt(v) {
  const s = String(v).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 12;
  if (s.endsWith('px')) return n * 0.75;
  if (s.endsWith('em') || s.endsWith('rem')) return n * 12;
  return n; // pt
}

const isDeleted = (c) => c.marks?.some((m) => m.type === 'deletion');

function paragraphXml(n, w) {
  const parts = [];
  // tracked deletions are not part of the document text (pending review lives beside content.xml)
  const inl = (n.content || []).filter((c) => !isDeleted(c));
  const emit = (tag, attrs, str) => {
    const start = w.text.length;
    w.text += str;
    parts.push(`<${tag}${attrStr(attrs)} startOffset="${start}" length="${str.length}" />`);
  };
  inl.forEach((c, i) => {
    const last = i === inl.length - 1;
    if (c.type === 'image') {
      const src = String(c.attrs?.src || '');
      const b64 = src.includes('base64,') ? src.slice(src.indexOf('base64,') + 7) : '';
      const start = w.text.length;
      w.text += IMAGE_CHAR;
      const ia = { family: w.base.family, size: String(w.base.size), ...(c.attrs?.extra || {}), imageData: b64 };
      if (c.attrs?.width) ia.width = jfloat(Math.round(c.attrs.width));
      if (c.attrs?.height) ia.height = jfloat(Math.round(c.attrs.height));
      parts.push(`<image${attrStr(ia)} startOffset="${start}" length="1" />`);
      if (last) emit('content', { family: w.base.family, size: String(w.base.size) }, '\n');
      return;
    }
    if (c.type !== 'text') return;
    const { tag, attrs } = runAttrs(c.marks, w.base);
    emit(tag, attrs, last ? `${c.text}\n` : c.text);
  });
  if (!inl.length) emit('content', { family: w.base.family, size: String(w.base.size) }, '\n');
  return `<paragraph${attrStr(paraXmlAttrs(n.attrs))}>${parts.join('')}</paragraph>`;
}

function tableXml(n, w) {
  const ta = { ...(n.attrs?.udf || {}) };
  const imported = !!ta._tag; // came from a file: don't inject defaults it didn't have
  const tag = ta._tag || 'table';
  const untouched = imported && ta._sig === gridSig(n.content || []);
  delete ta._tag;
  delete ta._sig;
  const rows = n.content || [];
  const cols = Math.max(1, ...rows.map((r) => (r.content || []).reduce((s, c) => s + (c.attrs?.colspan || 1), 0)));
  if (untouched) return `<${tag}${attrStr(ta)}>${rowsXml(rows, w)}</${tag}>`;
  if (!imported || ta.columnCount) ta.columnCount = String(cols);
  const widths = (rows[0]?.content || []).flatMap((c) => {
    const cw = c.attrs?.colwidth;
    const span = c.attrs?.colspan || 1;
    return Array.from({ length: span }, (_, k) => (cw && cw[k]) || null);
  });
  const orig = String(ta.columnSpans || '').split(',').map((x) => num(x, NaN));
  const sameProportions = (a, b) => {
    const sa = a.reduce((s, x) => s + x, 0), sb = b.reduce((s, x) => s + x, 0);
    return a.length === b.length && a.every((x, i) => Math.abs(x / sa - b[i] / sb) < 0.01);
  };
  const origOk = orig.length === cols && orig.every((x) => x > 0);
  const even = widths.length > 0 && widths.every((x) => x && Math.abs(x - widths[0]) <= 1);
  if (widths.length === cols && widths.every((x) => x)) {
    if (origOk ? !sameProportions(widths, orig) : !(imported && even)) ta.columnSpans = widths.map((x) => Math.round(x)).join(',');
  } else if (!imported && !origOk) ta.columnSpans = Array(cols).fill('100').join(',');
  if (!imported) {
    if (!ta.border) ta.border = 'borderCell';
    if (!ta.tableName) ta.tableName = 'Sabit';
  }
  return `<${tag}${attrStr(ta)}>${rowsXml(rows, w)}</${tag}>`;
}

function rowsXml(rows, w) {
  return rows.map((r, ri) => {
    const ra = { ...(r.attrs?.udf || {}) };
    const rtag = ra._tag || 'row';
    const rowImported = !!ra._tag;
    delete ra._tag;
    if (!rowImported) {
      if (!ra.rowName) ra.rowName = `row${ri + 1}`;
      if (!ra.rowType) ra.rowType = 'dataRow';
    }
    const cells = (r.content || []).map((c) => {
      const inner = blocksXml(c.content || [], w);
      const cell = `<cell${attrStr(c.attrs?.udf || {})}>${inner}</cell>`;
      // UDF has no spans: repeat empty cells so the grid stays rectangular
      const extraCells = Math.max(0, (c.attrs?.colspan || 1) - 1);
      let pad = '';
      for (let k = 0; k < extraCells; k++) pad += `<cell>${paragraphXml({ type: 'paragraph', attrs: defaultParaAttrs() }, w)}</cell>`;
      return cell + pad;
    }).join('');
    return `<${rtag}${attrStr(ra)}>${cells}</${rtag}>`;
  }).join('');
}

/** Fresh meta for a new document. */
export function newDocMeta() {
  return {
    formatId: '1.8',
    pageFormat: { ...DEFAULT_PAGE },
    styles: DEFAULT_STYLES.map((s) => ({ ...s })),
    elementsAttrs: { resolver: 'hvl-default' },
    base: { family: 'Times New Roman', size: 12 },
    header: null,
    footer: null,
    unknown: [],
    tail: [],
  };
}

/** Plain text of a doc JSON (word count, nav, titles). */
export function docText(doc) {
  const paras = [];
  (function walk(n) {
    if (n.type === 'paragraph') {
      paras.push((n.content || []).map((c) => (c.type === 'text' && !isDeleted(c) ? c.text : c.type === 'hardBreak' ? '\n' : '')).join(''));
      return;
    }
    (n.content || []).forEach(walk);
  })(doc);
  return paras.join('\n');
}
