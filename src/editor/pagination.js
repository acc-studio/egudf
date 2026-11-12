// Print-layout pagination for a single ProseMirror editor.
//
// The document stays one contenteditable. After every change we measure the
// line boxes in "unbroken" coordinates (current spacer heights subtracted),
// decide where each page must end — at a line boundary inside a paragraph, or
// at a top-level table row — and insert spacers there: a widget before a block,
// or extra top padding on every cell of the row that starts the new page (a
// widget cannot live between <tr>s). An overlay layer (not part
// of the editable DOM) then paints the page gaps, headers, footers and page
// numbers at the spacer positions. Measuring never depends on its own output,
// so the layout converges in one pass.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('pagination');

/**
 * Pagination.configure({ getLayout, onLayout })
 * getLayout() → { pageH, top, bottom, gap } in layout px, plus `sheet` (element containing the editor),
 *   `wordRules` (Word documents: keep with next, keep lines together, widow/orphan control),
 *   `fnHeight(node)` → px a footnote takes at the page bottom, `fnSep` px for the separator line
 *   and optional `firstTop`: page 1's top (no header there, or a taller first-page header)
 * onLayout({ pages, spacers: [{ y, fill }], lastFill }) — called after spacers are placed
 */
export const Pagination = Extension.create({
  name: 'pagination',
  addOptions() { return { getLayout: null, onLayout: null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: paginationKey,
      state: {
        init: () => ({ breaks: [], deco: DecorationSet.empty }),
        apply(tr, val) {
          const m = tr.getMeta(paginationKey);
          if (m) return m;
          return tr.docChanged ? { breaks: val.breaks, deco: val.deco.map(tr.mapping, tr.doc) } : val;
        },
      },
      props: { decorations(state) { return paginationKey.getState(state).deco; } },
      view(view) {
        let timer = null;
        let disposed = false;
        const schedule = (delay = 60) => {
          clearTimeout(timer);
          timer = setTimeout(() => { if (!disposed) run(); }, delay);
        };
        const run = () => {
          const L = opts.getLayout?.();
          if (!L || !view.dom.isConnected || !view.dom.offsetParent) return;
          const result = measure(view, L);
          if (!result) return;
          const cur = paginationKey.getState(view.state);
          const same = cur.breaks.length === result.breaks.length
            && cur.breaks.every((b, i) => b.pos === result.breaks[i].pos && Math.abs(b.fill - result.breaks[i].fill) < 0.5 && Math.abs((b.rep?.h || 0) - (result.breaks[i].rep?.h || 0)) < 0.5);
          if (!same) {
            const decos = [];
            result.breaks.forEach((b, i) => {
              const h = b.fill + L.bottom + (L.gap ?? 0) + L.top;
              if (!b.cells) {
                decos.push(Decoration.widget(b.pos, () => spacer(h, i), { side: -1, ignoreSelection: true, key: `pg-${i}-${Math.round(h * 2)}` } /* the key carries the height: same fill with another gap/margin must redraw */));
                return;
              }
              const hh = h + (b.rep?.h || 0);
              b.cells.forEach(([from, to], k) => decos.push(Decoration.node(from, to, {
                style: `padding-top: calc(1.5pt + ${hh}px)`,
                ...(k ? {} : { class: 'pg-row-break', 'data-pg-h': String(hh), 'data-page': String(i + 1) }),
              })));
            });
            const tr = view.state.tr.setMeta(paginationKey, { breaks: result.breaks, deco: DecorationSet.create(view.state.doc, decos) });
            tr.setMeta('addToHistory', false);
            view.dispatch(tr);
          }
          // the last block's bottom margin (Word spacing after) already takes part of the last page
          const lastEl = view.dom.lastElementChild;
          const tail = lastEl ? parseFloat(getComputedStyle(lastEl).marginBottom) || 0 : 0;
          view.dom.style.paddingBottom = `${Math.max(0, L.bottom + Math.max(0, result.lastFill) - tail)}px`;
          opts.onLayout?.(collectSpacers(view, L, result));
        };
        const onLoad = (e) => { if (e.target?.tagName === 'IMG') schedule(); };
        view.dom.addEventListener('load', onLoad, true);
        document.fonts?.ready?.then(() => schedule(0));
        schedule(0);
        view.dom.__repaginate = () => schedule(0);
        return {
          update(v, prev) { if (v.state.doc !== prev.doc || !paginationKey.getState(prev)) schedule(); },
          destroy() { disposed = true; clearTimeout(timer); view.dom.removeEventListener('load', onLoad, true); },
        };
      },
    })];
  },
  addCommands() {
    return {
      repaginate: () => ({ view }) => {
        // force a fresh pass (layout settings changed, tab shown, zoom)
        const st = paginationKey.getState(view.state);
        st.breaks = [{ pos: -1, fill: -1 }]; // invalidate so the next pass re-places spacers
        view.dom.__repaginate?.();
        return true;
      },
    };
  },
});

function spacer(h, i) {
  const el = document.createElement('span');
  el.className = 'page-spacer';
  el.contentEditable = 'false';
  el.dataset.page = String(i + 1);
  el.style.height = `${h}px`;
  return el;
}

/** Page gaps in client coords, document order: spacer widgets and padded row-break cells. */
function spacerBoxes(dom) {
  return [...dom.querySelectorAll('.page-spacer, .pg-row-break')].map((el) => {
    const r = el.getBoundingClientRect();
    if (!el.classList.contains('pg-row-break')) return { top: r.top, h: r.height };
    const scale = r.width / (el.offsetWidth || r.width) || 1;
    return { top: r.top, h: (parseFloat(el.dataset.pgH) || 0) * scale, row: true };
  });
}

function measure(view, L) {
  const dom = view.dom;
  const domRect = dom.getBoundingClientRect();
  if (!dom.offsetWidth) return null;
  const scale = domRect.width / dom.offsetWidth || 1;
  const H = L.pageH - L.top - L.bottom;
  const top1 = L.firstTop ?? L.top;
  const H1 = L.pageH - top1 - L.bottom; // page 1 may start lower/higher than the rest
  if (H <= 20 || H1 <= 20) return null;
  const pageOf = (t) => (t < H1 ? 0 : 1 + Math.floor((t - H1) / H));
  const pageStart = (k) => (k ? H1 + (k - 1) * H : 0);
  const pageEnd = (k) => H1 + k * H;
  const spacers = spacerBoxes(dom);
  const origin = domRect.top + top1 * scale;
  const toContent = (y) => {
    let sub = 0;
    for (const s of spacers) if (s.top < y - 0.5) sub += s.h;
    return (y - origin - sub) / scale;
  };

  // units in document order: { pos, top, bottom } in unbroken content px
  const units = [];
  let blk = 0;
  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset);
    if (!el || el.nodeType !== 1) return;
    const r = el.getBoundingClientRect();
    const pTop = toContent(r.top), pBottom = toContent(r.bottom);
    if (node.type.name === 'table') {
      // Word "repeat as header row": the leading header rows are drawn again on each new page
      let hdrN = 0, hdrH = 0;
      if (L.wordRules) {
        for (let k = 0; k < node.childCount && node.child(k).attrs.fmt?.header; k++) hdrN++;
        if (hdrN && hdrN < node.childCount) {
          let off = offset + 1;
          for (let k = 0; k < hdrN; k++) { const d = view.nodeDOM(off); if (d?.getBoundingClientRect) hdrH += d.getBoundingClientRect().height / scale; off += node.child(k).nodeSize; }
        }
      }
      let rowIdx = 0;
      // one unit per row: a long table continues on the next page instead of jumping there whole
      node.forEach((row, rOff) => {
        const ri = rowIdx++;
        const rowPos = offset + 1 + rOff;
        const tr = view.nodeDOM(rowPos);
        if (!tr || tr.nodeType !== 1) return;
        const rr = tr.getBoundingClientRect();
        const cells = [];
        row.forEach((cell, cOff) => cells.push([rowPos + 1 + cOff, rowPos + 1 + cOff + cell.nodeSize]));
        // first row breaks before the whole table (widget), later rows pad their cells
        units.push(rOff === 0 ? { pos: offset, top: pTop, bottom: toContent(rr.bottom), blk, li: 0, tbl: true } : { pos: rowPos, top: toContent(rr.top), bottom: toContent(rr.bottom), cells, blk, li: 1, tbl: true, ...(hdrH && ri >= hdrN ? { rep: { h: hdrH, table: offset, n: hdrN } } : {}) });
      });
      if (units.length) units[units.length - 1].bottom = Math.max(units[units.length - 1].bottom, pBottom);
      blk++;
      return;
    }
    if (node.type.name !== 'paragraph') { units.push({ pos: offset, top: pTop, bottom: pBottom, blk: blk++, li: 0, n: 1 }); return; }
    const force = !!node.attrs.pageBreakBefore; // Word page break: this paragraph starts a page
    const keep = { blk, kn: !!node.attrs.keepNext, kl: !!node.attrs.keepLines, wc: node.attrs.widowControl !== false };
    blk++;
    const lines = lineRects(el);
    if (lines.length <= 1) { units.push({ pos: offset, top: pTop, bottom: pBottom, force, li: 0, n: 1, ...keep }); return; }
    const first = units.length;
    // convert each line edge to content space first, then take midpoints —
    // a midpoint taken in screen space can fall inside a spacer
    const ct = lines.map((l) => ({ top: toContent(l.top), bottom: toContent(l.bottom) }));
    for (let i = 0; i < lines.length; i++) {
      const top = i === 0 ? pTop : (ct[i - 1].bottom + ct[i].top) / 2;
      const bottom = i === lines.length - 1 ? pBottom : (ct[i].bottom + ct[i + 1].top) / 2;
      let pos = offset;
      if (i > 0) {
        let p = -1;
        try { p = lines[i].node ? view.posAtDOM(lines[i].node, lines[i].offset) : -1; } catch {}
        if (!(p > offset + 1 && p < offset + node.nodeSize - 1)) {
          // unresolvable line start: merge it into the previous unit
          if (units.length) units[units.length - 1].bottom = bottom;
          continue;
        }
        pos = p;
      }
      units.push({ pos, top, bottom, ...(i === 0 && force ? { force } : {}), li: units.length - first, ...keep });
    }
    for (let k = first; k < units.length; k++) units[k].n = units.length - first;
  });

  // footnotes: each unit carries the height of the footnotes referenced in it
  if (L.fnHeight) {
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'footnote') return true;
      let k = units.length - 1;
      while (k > 0 && units[k].pos > pos) k--;
      if (units[k]) units[k].fn = (units[k].fn || 0) + L.fnHeight(node);
      return false;
    });
  }
  const SEP = L.fnSep || 0;
  let fnUsed = 0; // footnote area already taken on the current page
  const fnOf = (u) => (u.fn ? u.fn + SEP : 0);
  const fnAdd = (u) => (u.fn ? u.fn + (fnUsed ? 0 : SEP) : 0);

  // The current page only advances when a break is placed: a page is never "entered"
  // by position alone (a line ending a hair past the page end, within tolerance, must
  // not make the next line count as already on the next page — it has no spacer).
  const breaks = [];
  let shift = 0;
  let end = 0;
  let cur = 0;
  // Word moves a break earlier: keep lines together, no single first/last line of a
  // paragraph alone on a page (widow/orphan control), a "keep with next" paragraph
  // goes with the block after it — unless that would start at the page's top
  const keepBack = (j) => {
    let k = j;
    const u = units[j];
    if (!u.tbl && u.li > 0 && u.n >= 2) {
      if (u.kl) k = j - u.li;
      else if (u.wc && (u.li === 1 || u.li === u.n - 1)) {
        k = j - 1;
        if (units[k].li === 1) k -= 1; // moving the last two lines would orphan the first
      }
    }
    while (k > 0 && units[k].li === 0 && units[k - 1].kn) k = k - 1 - units[k - 1].li;
    return units[k].top + shift > pageStart(cur) + 0.5 ? k : j;
  };
  for (let j = 0; j < units.length; j++) {
    const u = units[j];
    const t = u.top + shift, b = u.bottom + shift;
    if (t >= pageEnd(cur) + H) { cur = pageOf(t); fnUsed = 0; } // after a unit taller than a page
    // a unit fits if its text and its footnotes fit above the bottom margin
    if ((u.force || b + fnUsed + fnAdd(u) > pageEnd(cur) + 0.5) && t > pageStart(cur) + 0.5) {
      const k = L.wordRules && !u.force ? keepBack(j) : j;
      const v = units[k];
      const fill = Math.max(0, pageEnd(cur) - (v.top + shift));
      if (!breaks.length || breaks[breaks.length - 1].pos !== v.pos) {
        breaks.push(v.cells ? { pos: v.pos, fill, cells: v.cells, ...(v.rep ? { rep: v.rep } : {}) } : { pos: v.pos, fill });
        shift += fill + (v.rep?.h || 0);
        cur++;
        fnUsed = fnOf(v);
        if (k < j) { j = k; end = Math.max(end, v.bottom + shift); continue; } // re-run the moved units on the new page
        end = Math.max(end, u.bottom + shift);
        continue;
      }
    }
    fnUsed += fnAdd(u);
    end = Math.max(end, u.bottom + shift);
  }
  const pages = Math.max(cur + 1, end - 0.5 <= H1 ? 1 : 1 + Math.ceil((end - 0.5 - H1) / H));
  const lastFill = pageEnd(pages - 1) - end;
  return { breaks, pages, lastFill, H };
}

/**
 * Line boxes of a paragraph in client coords: [{ top, bottom, left, node, offset }]
 * where (node, offset) is the DOM position of the line's first character, found
 * by binary search over character rects (works off-screen, unlike posAtCoords).
 */
function lineRects(el) {
  const frags = []; // { top, bottom, left, node, offset }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n.nodeType === 1) {
        if (n.classList?.contains('page-spacer')) return NodeFilter.FILTER_REJECT;
        return n.tagName === 'IMG' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return n.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const range = document.createRange();
  const charTop = (node, k) => { range.setStart(node, k); range.setEnd(node, k + 1); const r = range.getClientRects(); return r.length ? r[r.length - 1].top : -Infinity; };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      const r = n.getBoundingClientRect();
      frags.push({ top: r.top, bottom: r.bottom, left: r.left, node: n.parentNode, offset: [...n.parentNode.childNodes].indexOf(n) });
      continue;
    }
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.height > 0);
    let lo = 0;
    rects.forEach((r, j) => {
      let k = 0;
      if (j > 0) {
        // first char whose box starts on this line
        let a = lo, b = n.nodeValue.length - 1;
        while (a < b) { const m = (a + b) >> 1; if (charTop(n, m) >= r.top - 1) b = m; else a = m + 1; }
        k = a;
        lo = a;
      }
      frags.push({ top: r.top, bottom: r.bottom, left: r.left, node: n, offset: k });
    });
  }
  // group fragments into visual lines, keeping document order of starts
  const lines = [];
  for (const f of frags) {
    const last = lines[lines.length - 1];
    const overlap = last ? Math.min(last.bottom, f.bottom) - Math.max(last.top, f.top) : -1;
    if (last && overlap > Math.min(last.bottom - last.top, f.bottom - f.top) * 0.5) {
      last.top = Math.min(last.top, f.top);
      last.bottom = Math.max(last.bottom, f.bottom);
      last.left = Math.min(last.left, f.left);
    } else {
      lines.push({ ...f });
    }
  }
  return lines;
}

function collectSpacers(view, L, result) {
  const sheetRect = L.sheet.getBoundingClientRect();
  const scale = sheetRect.width / L.sheet.offsetWidth || 1;
  const breaks = paginationKey.getState(view.state).breaks;
  const spacers = spacerBoxes(view.dom).map((s, i) => ({
    y: (s.top - sheetRect.top) / scale,
    row: !!s.row, // a table split across the break (its cells are padded through the margins)
    fill: breaks[i]?.fill || 0,
    rep: breaks[i]?.rep || null, // header rows to draw at the top of the next page
  }));
  return { pages: spacers.length + 1, spacers, lastFill: result.lastFill };
}

/** 1-based page number of a document position. */
export function pageOfPos(view, pos) {
  try {
    const y = view.coordsAtPos(pos).top;
    let n = 1;
    for (const s of spacerBoxes(view.dom)) if (s.top < y) n++;
    return n;
  } catch { return 1; }
}
