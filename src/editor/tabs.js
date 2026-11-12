// Word-style tab stops: left / right / center / decimal stops with leaders,
// default stops every `defaultTab` pt, and the implicit stop at a hanging indent.
//
// CSS only knows evenly spaced left tabs, so each '\t' gets an explicit width:
//  - in the editor through inline decorations (re-measured after every layout
//    change until the widths settle — usually one extra pass);
//  - in static HTML (header/footer overlay) by wrapping the tab characters.
//
// Stop positions are measured from the paragraph's box (the text column), not
// from its indent, as in Word. tabSet format (shared with UDF/UYAP, Java Swing
// TabStop codes): "pos:align:leader,…" — align 0 left, 1 right, 2 center, 4 decimal;
// leader 0 none, 1 dots, 2 hyphens, 3 underline, 4 thick line, 5 equals.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const PX = 96 / 72;
const LEADER = { 1: 'dots', 2: 'hyphens', 3: 'line', 4: 'thick', 5: 'equals' };

export function parseTabSet(tabSet) {
  return String(tabSet || '').split(',').map((t) => {
    const [p, a, l] = t.split(':');
    return { pos: parseFloat(p), align: parseInt(a, 10) || 0, leader: parseInt(l, 10) || 0 };
  }).filter((s) => Number.isFinite(s.pos) && s.pos > 0).sort((a, b) => a.pos - b.pos);
}

/** The stop a tab starting at x (pt from the column's left edge) moves to. */
export function nextStop(x, attrs, defaultTab = 35.4) {
  const stops = parseTabSet(attrs?.tabSet);
  if ((attrs?.firstLineIndent || 0) < 0 && attrs?.leftIndent > 0) stops.push({ pos: attrs.leftIndent, align: 0, leader: 0, implicit: true });
  stops.sort((a, b) => a.pos - b.pos);
  const custom = stops.find((s) => s.pos > x + 0.5);
  // default stops resume after the last explicit one; explicit stops clear defaults left of them
  const lastCustom = stops.length ? stops[stops.length - 1].pos : 0;
  const def = Math.max(Math.floor(x / defaultTab) + 1, 1) * defaultTab;
  if (custom && (custom.pos <= def || def <= lastCustom)) return custom;
  return { pos: def > lastCustom ? def : Math.ceil((lastCustom + 0.01) / defaultTab) * defaultTab, align: 0, leader: 0 };
}

/** width (px) of a tab at x (px) followed by a segment `seg` px wide (decimalSeg: up to the separator). */
export function tabWidth(xPx, stop, segPx, decimalPx) {
  const s = stop.pos * PX;
  let w;
  if (stop.align === 1) w = s - xPx - segPx;
  else if (stop.align === 2) w = s - xPx - segPx / 2;
  else if (stop.align === 4) w = s - xPx - (decimalPx ?? segPx);
  else w = s - xPx;
  return Math.max(0, w);
}

const leaderClass = (stop) => (LEADER[stop.leader] ? ` tab-${LEADER[stop.leader]}` : '');

// ------------------------------------------------------------------ editor

export const tabsKey = new PluginKey('tabStops');

export const TabStops = Extension.create({
  name: 'tabStops',
  addOptions() { return { defaultTab: () => 35.4 }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: tabsKey,
      state: {
        init: () => ({ deco: DecorationSet.empty, widths: {} }),
        apply(tr, v) {
          const m = tr.getMeta(tabsKey);
          if (m) return m;
          return tr.docChanged ? { deco: v.deco.map(tr.mapping, tr.doc), widths: v.widths } : v;
        },
      },
      props: { decorations(state) { return tabsKey.getState(state).deco; } },
      view(view) {
        let raf = 0, passes = 0;
        const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); };
        const run = () => {
          if (!view.dom.isConnected || !view.dom.offsetParent) return;
          const cur = tabsKey.getState(view.state);
          const res = measure(view, cur.widths, opts.defaultTab());
          if (!res) return;
          const changed = Object.keys(res.widths).length !== Object.keys(cur.widths).length
            || Object.entries(res.widths).some(([k, w]) => Math.abs((cur.widths[k]?.w ?? -9) - w.w) > 0.5 || cur.widths[k]?.cls !== w.cls);
          if (!changed) { passes = 0; return; }
          if (++passes > 4) { passes = 0; return; } // never oscillate forever
          const decos = Object.entries(res.widths).map(([pos, w]) => Decoration.inline(+pos, +pos + 1, { class: `tab-stop${w.cls}`, style: `width:${w.w.toFixed(2)}px` }));
          const tr = view.state.tr.setMeta(tabsKey, { deco: DecorationSet.create(view.state.doc, decos), widths: res.widths }).setMeta('addToHistory', false);
          view.dispatch(tr);
          view.dom.__repaginate?.(); // widths can move line breaks
        };
        view.dom.__retab = schedule;
        schedule();
        return {
          update(v, prev) { if (v.state.doc !== prev.doc || tabsKey.getState(v.state) !== tabsKey.getState(prev)) schedule(); },
          destroy() { cancelAnimationFrame(raf); },
        };
      },
    })];
  },
});

function measure(view, current, defaultTab) {
  const widths = {};
  let any = false;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!node.textContent.includes('\t')) return false;
    const el = view.nodeDOM(pos);
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    const scale = r.width / (el.offsetWidth || r.width) || 1;
    const origin = r.left + (parseFloat(getComputedStyle(el).borderLeftWidth) || 0) * scale;
    const tabs = [];
    node.forEach((child, off) => {
      if (!child.isText) return;
      for (let i = child.text.indexOf('\t'); i >= 0; i = child.text.indexOf('\t', i + 1)) tabs.push(pos + 1 + off + i);
    });
    const end = pos + node.nodeSize - 1;
    let line = null, carry = 0; // same-line correction: current widths of earlier tabs on this line
    tabs.forEach((tp, k) => {
      let a, b, c;
      try { a = view.coordsAtPos(tp, 1); b = view.coordsAtPos(tp + 1, 1); } catch { return; }
      const segEnd = k + 1 < tabs.length ? tabs[k + 1] : end;
      try { c = view.coordsAtPos(segEnd, -1); } catch { c = b; }
      const top = Math.round(a.top);
      if (line !== top) { line = top; carry = 0; }
      const curW = current[tp]?.w || 0;
      // x as if this line's earlier tabs had their *new* widths
      const x0 = (a.left - origin) / scale - carry;
      const sameLine = Math.abs(c.top - b.top) < 2;
      const seg = sameLine ? Math.max(0, (c.left - b.left) / scale) : 0;
      let dec = null;
      const stop = nextStop(x0 / PX, node.attrs, defaultTab);
      if (stop.align === 4 && sameLine) {
        const txt = view.state.doc.textBetween(tp + 1, segEnd);
        const m = /[.,]/.exec(txt);
        if (m) { try { dec = (view.coordsAtPos(tp + 1 + m.index, 1).left - b.left) / scale; } catch {} }
      }
      const w = tabWidth(x0, stop, seg, dec);
      widths[tp] = { w, cls: leaderClass(stop) };
      carry += curW - w; // later tabs on this line move by the difference
      any = true;
    });
    return false;
  });
  return any || Object.keys(current).length ? { widths } : null;
}

// ------------------------------------------------------------------ static HTML

/**
 * Lays out tabs inside rendered paragraphs (header/footer overlay). `root` must
 * be in the document. Paragraph attrs come from data-p (see UdfParagraph).
 */
export function layoutTabsDom(root, defaultTab = 35.4) {
  for (const p of root.querySelectorAll('p')) {
    if (!p.textContent.includes('\t')) continue;
    let attrs = {};
    try { attrs = JSON.parse(p.dataset.p || '{}'); } catch {}
    // wrap every tab character
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.includes('\t')) texts.push(n);
    for (const t of texts) {
      const parts = t.data.split('\t');
      const frag = document.createDocumentFragment();
      parts.forEach((s, i) => {
        if (i) { const sp = document.createElement('span'); sp.className = 'tab-stop'; sp.textContent = '\t'; frag.append(sp); }
        if (s) frag.append(document.createTextNode(s));
      });
      t.replaceWith(frag);
    }
    const spans = [...p.querySelectorAll('.tab-stop')];
    const pr = p.getBoundingClientRect();
    const scale = pr.width / (p.offsetWidth || pr.width) || 1;
    spans.forEach((sp, k) => {
      const range = document.createRange();
      range.setStartAfter(sp);
      if (spans[k + 1]) range.setEndBefore(spans[k + 1]); else range.setEnd(p, p.childNodes.length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const s0 = sp.getBoundingClientRect();
      const sameLine = rects.length && rects.every((r) => Math.abs(r.top - rects[0].top) < 2);
      const seg = sameLine ? (Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))) / scale : 0;
      const x = (s0.left - pr.left) / scale;
      const stop = nextStop(x / PX, attrs, defaultTab);
      sp.className = `tab-stop${leaderClass(stop)}`;
      sp.style.width = `${tabWidth(x, stop, seg, null).toFixed(2)}px`; // synchronous: the next span measures after this one
    });
  }
}
