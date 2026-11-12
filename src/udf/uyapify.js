// Word content → what a .udf can hold, as UYAP Doküman Editörü will show it.
//
// Used when a Word document becomes a .udf (Save As .udf, signing) and when Word
// content is pasted into a .udf, so egUDF shows exactly what the official editor
// will show. Every rule below was checked by opening test files in Doküman
// Editörü 5.4.20:
//  - lists: only UYAP's styles, no hanging first-line indent (bullets would sit on the text);
//  - spacing: UYAP adds "after" and the next "before"; Word uses the larger one;
//  - exact / at-least line spacing → UYAP's multiple (LineSpacing);
//  - caps / small caps → uppercase text; double strike → strike; letter spacing dropped;
//  - paragraph shading → text highlight; paragraph borders, page breaks, keep-with-next
//    and tab leaders are not in the format (UYAP drops a <page-break/>, draws no leaders);
//  - tables: one border mode per table (grid / rows / frame / none) — UYAP has no
//    per-side cell borders, cell shading, row heights or vertical alignment;
//  - fonts only Office has (Aptos…) → installed equivalents (UYAP is a Java app).
// The result is the editor's JSON; the codec serializes it as usual.
import { uyapListType } from './common.js';
import { defaultParaAttrs } from './codec.js';

/** Office cloud fonts (not installed in Windows) → the nearest installed font. */
const FONT_FALLBACK = {
  aptos: 'Calibri', 'aptos display': 'Calibri Light', 'aptos narrow': 'Arial Narrow', 'aptos serif': 'Cambria', 'aptos mono': 'Consolas',
  grandview: 'Calibri', 'grandview display': 'Calibri Light', seaford: 'Calibri', 'seaford display': 'Calibri', tenorite: 'Calibri', 'tenorite display': 'Calibri',
  bierstadt: 'Arial', 'bierstadt display': 'Arial', skeena: 'Calibri', 'skeena display': 'Calibri', 'amasis mt pro': 'Cambria', 'avenir next lt pro': 'Century Gothic',
  'gill sans nova': 'Gill Sans MT', 'arial nova': 'Arial', 'georgia pro': 'Georgia', 'verdana pro': 'Verdana', 'segoe ui variable': 'Segoe UI',
};
export const uyapFont = (family) => {
  const f = String(family || '').split(',')[0].replace(/["']/g, '').trim();
  return FONT_FALLBACK[f.toLowerCase()] || f;
};

const SINGLE = 1.15; // UYAP's single line, as the UDF→PDF engine uses

/** opts.base: { family, size } of the target document */
export function uyapifyBlocks(blocks, opts = {}) {
  const base = opts.base || { family: 'Times New Roman', size: 12 };
  let prevBelow = 0;
  return (blocks || []).map((b) => {
    if (b.type === 'table') { prevBelow = 0; return table(b, opts); }
    if (b.type !== 'paragraph') { prevBelow = 0; return b; }
    const p = paragraph(b, base, prevBelow);
    prevBelow = p.attrs.spaceBelow || 0;
    return p;
  });
}

function paragraph(n, base, prevBelow) {
  const a = { ...(n.attrs || {}) };
  if (a.list) {
    a.list = { ...a.list, type: uyapListType(a.list.kind, a.list.type) };
    if ((a.firstLineIndent || 0) < 0) a.firstLineIndent = 0;
  }
  // Word: max(previous after, this before); UYAP adds them
  if (a.spaceAbove) a.spaceAbove = Math.max(0, Math.round((a.spaceAbove - prevBelow) * 100) / 100);
  if ((a.lineRule === 'exact' || a.lineRule === 'atLeast') && a.lineHeight) {
    const size = a.strut?.size || largestRun(n) || base.size;
    const mult = a.lineHeight / (size * SINGLE) - 1;
    a.lineSpacing = Math.max(0, Math.round((a.lineRule === 'atLeast' ? Math.max(0, mult) : mult) * 100) / 100);
  }
  if (a.tabSet) a.tabSet = String(a.tabSet).split(',').map((t) => { const [p, al] = t.split(':'); return `${p}:${al || 0}:0`; }).join(',');
  const shade = a.shading;
  Object.assign(a, { lineRule: null, lineHeight: null, pageBreakBefore: false, keepNext: false, keepLines: false, widowControl: true, border: null, shading: null });
  if (a.strut?.family) a.strut = { ...a.strut, family: uyapFont(a.strut.family) };
  const content = (n.content || []).map((c) => run(c, shade, base));
  return { ...n, attrs: a, ...(n.content ? { content } : {}) };
}

function largestRun(n) {
  let m = 0;
  for (const c of n.content || []) {
    const fs = c.marks?.find((k) => k.type === 'textStyle')?.attrs?.fontSize;
    if (fs) m = Math.max(m, parseFloat(fs));
  }
  return m || null;
}

function run(c, shade, base) {
  if (c.type !== 'text') return c;
  let text = c.text;
  let marks = (c.marks || []).map((m) => ({ ...m, attrs: m.attrs ? { ...m.attrs } : m.attrs }));
  const ts = marks.find((m) => m.type === 'textStyle');
  if (ts) {
    const at = ts.attrs;
    if (at.allCaps || at.smallCaps) text = text.toLocaleUpperCase('tr');
    if (at.smallCaps && !at.allCaps) at.fontSize = `${Math.round((parseFloat(at.fontSize) || base.size) * 0.8 * 10) / 10}pt`;
    if (at.dstrike && !marks.some((m) => m.type === 'strike')) marks.push({ type: 'strike' });
    if (at.fontFamily) at.fontFamily = uyapFont(at.fontFamily);
    Object.assign(at, { letterSpacing: null, smallCaps: null, allCaps: null, dstrike: null });
    if (!at.fontFamily && !at.fontSize && !at.color) marks = marks.filter((m) => m !== ts);
  }
  if (shade && !marks.some((m) => m.type === 'highlight')) marks.push({ type: 'highlight', attrs: { color: shade } });
  return { ...c, text, ...(marks.length ? { marks } : { marks: undefined }) };
}

/** Word's borders → UYAP's border mode; drop cell formatting UYAP doesn't draw. */
function table(t, opts) {
  const rows = t.content || [];
  let inH = false, inV = false, outer = false, any = false;
  rows.forEach((r, ri) => {
    let ci = 0;
    (r.content || []).forEach((c, k) => {
      const b = c.attrs?.fmt?.borders;
      const span = c.attrs?.colspan || 1;
      if (b) {
        const vis = (s) => b[s] && b[s] !== 'none';
        const last = k === (r.content.length - 1);
        if (vis('top')) { any = true; if (ri === 0) outer = true; else inH = true; }
        if (vis('bottom')) { any = true; if (ri === rows.length - 1) outer = true; else inH = true; }
        if (vis('left')) { any = true; if (ci === 0) outer = true; else inV = true; }
        if (vis('right')) { any = true; if (last) outer = true; else inV = true; }
      }
      ci += span;
    });
  });
  const hasFmt = rows.some((r) => (r.content || []).some((c) => c.attrs?.fmt));
  const udf = { ...(t.attrs?.udf || {}) };
  if (hasFmt) udf.border = inV ? 'borderCell' : inH ? 'borderRow' : outer || any ? 'borderTable' : 'borderNone';
  return {
    ...t,
    attrs: { ...t.attrs, udf, fmt: null },
    content: rows.map((r) => ({
      ...r,
      attrs: { ...r.attrs, fmt: null },
      content: (r.content || []).map((c) => ({ ...c, attrs: { ...c.attrs, fmt: null }, content: uyapifyBlocks(c.content, opts) })),
    })),
  };
}

/**
 * UYAP has no footnotes: each becomes a superscript number in the text, and the
 * notes follow at the end of the document under "Dipnotlar".
 */
export function flattenFootnotes(blocks) {
  const notes = [];
  const walk = (list) => (list || []).map((b) => {
    if (b.type === 'table') return { ...b, content: (b.content || []).map((r) => ({ ...r, content: (r.content || []).map((c) => ({ ...c, content: walk(c.content) })) })) };
    if (b.type !== 'paragraph' || !(b.content || []).some((n) => n.type === 'footnote')) return b;
    return { ...b, content: b.content.map((n) => (n.type === 'footnote' ? (notes.push(n.attrs?.content || []), { type: 'text', text: String(notes.length), marks: [...(n.marks || []).filter((m) => m.type !== 'subscript'), { type: 'superscript' }] }) : n)) };
  });
  const out = walk(blocks);
  if (!notes.length) return out;
  out.push({ type: 'paragraph', attrs: { ...defaultParaAttrs(), spaceAbove: 12 }, content: [{ type: 'text', text: 'Dipnotlar', marks: [{ type: 'bold' }] }] });
  notes.forEach((paras, i) => {
    const list = paras.length ? paras : [{ type: 'paragraph', attrs: defaultParaAttrs() }];
    list.forEach((p, k) => out.push(k || p.type !== 'paragraph' ? p : { ...p, attrs: { ...defaultParaAttrs(), ...(p.attrs || {}) }, content: [{ type: 'text', text: `${i + 1} `, marks: [{ type: 'superscript' }] }, ...(p.content || [])] }));
  });
  return out;
}

/** A whole document + meta (header/footer) → .udf-representable. Returns { doc, meta }. */
export function uyapifyDoc(doc, meta) {
  const opts = { base: meta?.base };
  const m = { ...meta };
  if (m.base?.family) m.base = { ...m.base, family: uyapFont(m.base.family) };
  for (const k of ['header', 'footer']) if (m[k]) m[k] = { ...m[k], content: uyapifyBlocks(m[k].content, opts) };
  return { doc: { ...doc, content: uyapifyBlocks(flattenFootnotes(doc.content), opts) }, meta: m };
}
