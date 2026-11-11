// Table tools for the contextual "Tablo" tab: selecting rows/columns/tables,
// column widths (equal, fit to page, exact), sorting rows, cell alignment and
// text ↔ table conversion. Everything works on the plain TipTap/ProseMirror
// table model (colwidth in CSS px), which the codec turns into UDF columnSpans.
import { TableMap, CellSelection } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { defaultParaAttrs } from '../udf/codec.js';

export const PX_PER_CM = 96 / 2.54;

/** The table around the selection: { node, pos, start, map } or null. */
export function tableAt(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'table') return { node: n, pos: $from.before(d), start: $from.start(d), map: TableMap.get(n), depth: d };
  }
  return null;
}

/** Row/column of the selection's first cell, plus the selected column/row ranges. */
export function cellRect(state) {
  const t = tableAt(state);
  if (!t) return null;
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    const r = t.map.rectBetween(sel.$anchorCell.pos - t.start, sel.$headCell.pos - t.start);
    return { ...t, ...r };
  }
  const { $from } = sel;
  for (let d = $from.depth; d > t.depth; d--) {
    const n = $from.node(d);
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      const r = t.map.findCell($from.before(d) - t.start);
      return { ...t, ...r };
    }
  }
  return null;
}

/** what: 'cell' | 'row' | 'column' | 'table' */
export function selectTablePart(ed, what) {
  const r = cellRect(ed.state);
  if (!r) return false;
  const { map, start } = r;
  const cellPos = (row, col) => start + map.map[row * map.width + col];
  let a, b;
  if (what === 'cell') { a = cellPos(r.top, r.left); b = a; } else if (what === 'row') { a = cellPos(r.top, 0); b = cellPos(r.bottom - 1, map.width - 1); } else if (what === 'column') { a = cellPos(0, r.left); b = cellPos(map.height - 1, r.right - 1); } else { a = cellPos(0, 0); b = cellPos(map.height - 1, map.width - 1); }
  const doc = ed.state.doc;
  ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(doc, a, b)));
  ed.view.focus();
  return true;
}

/** Current column widths in px (missing ones measured from the DOM, else shared equally). */
function columnWidths(ed, t, fallbackTotal) {
  const { map, node } = t;
  const w = Array(map.width).fill(null);
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const cell = node.nodeAt(map.map[row * map.width + col]);
      const { left } = map.findCell(map.map[row * map.width + col]);
      const cw = cell?.attrs.colwidth;
      if (cw && cw[col - left] && w[col] == null) w[col] = cw[col - left];
    }
  }
  if (w.some((x) => x == null)) {
    const dom = ed.view.nodeDOM(t.pos);
    const tbl = dom?.tagName === 'TABLE' ? dom : dom?.querySelector?.('table');
    const first = tbl?.rows?.[0];
    if (first && first.cells.length === map.width) [...first.cells].forEach((c, i) => { if (w[i] == null) w[i] = c.offsetWidth; });
  }
  const known = w.filter((x) => x != null);
  const rest = Math.max(24, ((fallbackTotal || 600) - known.reduce((s, x) => s + x, 0)) / Math.max(1, w.length - known.length));
  return w.map((x) => x ?? rest);
}

/** Writes per-column px widths into every cell's colwidth. */
function applyWidths(ed, t, widths) {
  const tr = ed.state.tr;
  const { map, node, start } = t;
  const seen = new Set();
  for (let i = 0; i < map.map.length; i++) {
    const rel = map.map[i];
    if (seen.has(rel)) continue;
    seen.add(rel);
    const cell = node.nodeAt(rel);
    const { left, right } = map.findCell(rel);
    const cw = widths.slice(left, right).map((x) => Math.max(24, Math.round(x)));
    tr.setNodeMarkup(start + rel, undefined, { ...cell.attrs, colwidth: cw });
  }
  ed.view.dispatch(tr);
}

export function distributeColumns(ed, total) {
  const t = tableAt(ed.state);
  if (!t) return false;
  const w = columnWidths(ed, t, total);
  const sum = w.reduce((s, x) => s + x, 0);
  applyWidths(ed, t, w.map(() => sum / w.length));
  return true;
}

/** Scales the columns so the table is exactly `total` px wide (the text width). */
export function fitColumns(ed, total) {
  const t = tableAt(ed.state);
  if (!t || !total) return false;
  const w = columnWidths(ed, t, total);
  const sum = w.reduce((s, x) => s + x, 0) || 1;
  applyWidths(ed, t, w.map((x) => (x * total) / sum));
  return true;
}

/** Sets the selected column(s) to `px`, taking the difference from the other columns so the table width stays. */
export function setColumnWidth(ed, px, total) {
  const r = cellRect(ed.state);
  if (!r) return false;
  const w = columnWidths(ed, r, total);
  const sum = w.reduce((s, x) => s + x, 0);
  const sel = new Set(Array.from({ length: r.right - r.left }, (_, i) => r.left + i));
  const others = w.map((_, i) => i).filter((i) => !sel.has(i));
  const want = Math.max(24, px);
  const restSum = others.reduce((s, i) => s + w[i], 0);
  const left = sum - want * sel.size;
  const next = w.map((x, i) => (sel.has(i) ? want : others.length && restSum > 0 && left > 24 * others.length ? (x * left) / restSum : x));
  applyWidths(ed, r, next);
  return true;
}

export function currentColumnWidth(ed, total) {
  const r = cellRect(ed.state);
  if (!r) return null;
  return columnWidths(ed, r, total)[r.left];
}

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
// dates like 05.03.2024 sort by date, not by day
const sortKey = (s) => {
  const t = s.trim();
  const d = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (d) return `${d[3]}${d[2].padStart(2, '0')}${d[1].padStart(2, '0')}`;
  return t;
};

/**
 * Sorts the table's rows by the text of the current column.
 * { desc, header } — header keeps the first row on top. Fails (returns a
 * reason) on vertically merged cells, which can't move row by row.
 */
export function sortRows(ed, { desc = false, header = false, column = null } = {}) {
  const r = cellRect(ed.state);
  if (!r) return 'Tablo yok';
  const { node, map, pos } = r;
  const col = column ?? r.left;
  let merged = false;
  node.descendants((n) => { if (n.attrs?.rowspan > 1) merged = true; return !merged && n.type.name !== 'paragraph'; });
  if (merged) return 'Dikey birleştirilmiş hücreler varken sıralanamaz';
  const rows = [];
  node.forEach((row, _o, i) => {
    const rel = map.map[i * map.width + Math.min(col, map.width - 1)];
    rows.push({ row, key: sortKey(node.nodeAt(rel)?.textContent || ''), i });
  });
  const head = header ? rows.slice(0, 1) : [];
  const body = header ? rows.slice(1) : rows;
  body.sort((a, b) => {
    // empty cells always last
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    return (desc ? -1 : 1) * collator.compare(a.key, b.key) || a.i - b.i;
  });
  const sorted = [...head, ...body];
  if (sorted.every((x, i) => x.i === i)) return true;
  const table = node.type.create(node.attrs, sorted.map((x) => x.row), node.marks);
  ed.view.dispatch(ed.state.tr.replaceWith(pos, pos + node.nodeSize, table));
  return true;
}

/** Paragraphs in the selection → table; cells split at tabs (or ";" when no line has a tab). */
export function textToTable(ed, total) {
  const { state } = ed;
  const { from, to } = state.selection;
  const paras = [];
  state.doc.nodesBetween(from, to, (n, pos, parent) => {
    if (n.type.name === 'paragraph' && parent.type.name === 'doc') { paras.push({ n, pos }); return false; }
    return n.type.name === 'doc';
  });
  if (!paras.length) return false;
  const sepTab = paras.some(({ n }) => n.textContent.includes('\t'));
  const sep = sepTab ? '\t' : ';';
  const split = (n) => {
    // split the paragraph's inline content at separators, keeping marks
    const cells = [[]];
    n.forEach((child) => {
      if (!child.isText) { cells[cells.length - 1].push(child.toJSON()); return; }
      child.text.split(sep).forEach((part, i) => {
        if (i) cells.push([]);
        if (part) cells[cells.length - 1].push({ ...child.toJSON(), text: sepTab ? part : part.trim() || part });
      });
    });
    return cells.map((c) => c.filter((x) => x.type !== 'text' || x.text));
  };
  const rows = paras.map(({ n }) => ({ n, cells: split(n) }));
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const w = Math.floor((total || 600) / cols);
  const json = {
    type: 'table', attrs: { udf: {} },
    content: rows.map(({ n, cells }) => ({
      type: 'tableRow', attrs: { udf: {} },
      content: Array.from({ length: cols }, (_, i) => ({
        type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [w], udf: {} },
        content: [{ type: 'paragraph', attrs: { ...defaultParaAttrs(), align: n.attrs.align === 'justify' ? 'left' : n.attrs.align }, ...(cells[i]?.length ? { content: cells[i] } : {}) }],
      })),
    })),
  };
  const a = paras[0].pos, b = paras[paras.length - 1].pos + paras[paras.length - 1].n.nodeSize;
  const node = state.schema.nodeFromJSON(json);
  const tr = state.tr.replaceWith(a, b, node);
  try { tr.setSelection(TextSelection.near(tr.doc.resolve(a + 4))); } catch {}
  ed.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Table → one paragraph per row, cells joined with tabs. */
export function tableToText(ed) {
  const t = tableAt(ed.state);
  if (!t) return false;
  const { schema } = ed.state;
  const paras = [];
  t.node.forEach((row) => {
    const inl = [];
    row.forEach((cell, _o, ci) => {
      if (ci) inl.push(schema.text('\t'));
      cell.descendants((n) => {
        if (n.type.name === 'paragraph') {
          if (inl.length && inl[inl.length - 1].text !== '\t' && n !== cell.firstChild) inl.push(schema.text(' '));
          n.forEach((c) => inl.push(c));
          return false;
        }
        return true;
      });
    });
    paras.push(schema.nodes.paragraph.create(defaultParaAttrs(), inl));
  });
  const tr = ed.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, paras);
  ed.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Number of rows/columns, for the status of the table tab. */
export function tableSize(state) {
  const t = tableAt(state);
  return t ? { rows: t.map.height, cols: t.map.width } : null;
}

export { CellSelection };
