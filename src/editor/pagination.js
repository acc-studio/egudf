// Print-layout pagination for a single ProseMirror editor.
//
// The document stays one contenteditable. After every change we measure the
// line boxes in "unbroken" coordinates (current spacer heights subtracted),
// decide where each page must end — at a line boundary inside a paragraph, or
// before a table — and insert spacer widgets there. An overlay layer (not part
// of the editable DOM) then paints the page gaps, headers, footers and page
// numbers at the spacer positions. Measuring never depends on its own output,
// so the layout converges in one pass.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('pagination');

/**
 * Pagination.configure({ getLayout, onLayout })
 * getLayout() → { pageH, top, bottom, gap } in layout px, plus `sheet` (element containing the editor)
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
            && cur.breaks.every((b, i) => b.pos === result.breaks[i].pos && Math.abs(b.fill - result.breaks[i].fill) < 0.5);
          if (!same) {
            const decos = result.breaks.map((b, i) => Decoration.widget(b.pos, () => spacer(b.fill + L.bottom + L.gap + L.top, i), {
              side: -1, ignoreSelection: true, key: `pg-${i}-${Math.round(b.fill * 2)}`,
            }));
            const tr = view.state.tr.setMeta(paginationKey, { breaks: result.breaks, deco: DecorationSet.create(view.state.doc, decos) });
            tr.setMeta('addToHistory', false);
            view.dispatch(tr);
          }
          view.dom.style.paddingBottom = `${L.bottom + Math.max(0, result.lastFill)}px`;
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

function measure(view, L) {
  const dom = view.dom;
  const domRect = dom.getBoundingClientRect();
  if (!dom.offsetWidth) return null;
  const scale = domRect.width / dom.offsetWidth || 1;
  const H = L.pageH - L.top - L.bottom;
  if (H <= 20) return null;
  const spacers = [...dom.querySelectorAll('.page-spacer')].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, h: r.height };
  });
  const origin = domRect.top + L.top * scale;
  const toContent = (y) => {
    let sub = 0;
    for (const s of spacers) if (s.top < y - 0.5) sub += s.h;
    return (y - origin - sub) / scale;
  };

  // units in document order: { pos, top, bottom } in unbroken content px
  const units = [];
  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset);
    if (!el || el.nodeType !== 1) return;
    const r = el.getBoundingClientRect();
    const pTop = toContent(r.top), pBottom = toContent(r.bottom);
    if (node.type.name !== 'paragraph') { units.push({ pos: offset, top: pTop, bottom: pBottom }); return; }
    const lines = lineRects(el);
    if (lines.length <= 1) { units.push({ pos: offset, top: pTop, bottom: pBottom }); return; }
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
      units.push({ pos, top, bottom });
    }
  });

  const breaks = [];
  let shift = 0;
  let end = 0;
  for (const u of units) {
    const t = u.top + shift, b = u.bottom + shift;
    const page = Math.floor((t + 0.5) / H);
    if (b > (page + 1) * H + 0.5 && t > page * H + 0.5) {
      const fill = (page + 1) * H - t;
      if (!breaks.length || breaks[breaks.length - 1].pos !== u.pos) {
        breaks.push({ pos: u.pos, fill });
        shift += fill;
      }
    }
    end = Math.max(end, u.bottom + shift);
  }
  const pages = Math.max(1, Math.ceil((end - 0.5) / H));
  const lastFill = pages * H - end;
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
  const spacers = [...view.dom.querySelectorAll('.page-spacer')].map((el, i) => ({
    y: (el.getBoundingClientRect().top - sheetRect.top) / scale,
    fill: breaks[i]?.fill || 0,
  }));
  return { pages: spacers.length + 1, spacers, lastFill: result.lastFill };
}

/** 1-based page number of a document position. */
export function pageOfPos(view, pos) {
  try {
    const y = view.coordsAtPos(pos).top;
    let n = 1;
    for (const el of view.dom.querySelectorAll('.page-spacer')) if (el.getBoundingClientRect().top < y) n++;
    return n;
  } catch { return 1; }
}
