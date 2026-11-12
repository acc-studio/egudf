// Horizontal ruler: cm scale over the page, margins shaded, draggable indent
// markers for the paragraph(s) in the selection (first line ▽, left/hanging △
// with a box that moves both, right △), tab stops of the current paragraph.
// Drags snap to 0,25 cm (hold Alt for free movement) and apply on release.
// Tab stops as in Word: the corner button picks the type (left, center, right,
// decimal); a click on the scale adds a stop, a stop drags to move, and dragging
// it off the ruler removes it.
import { PT_TO_PX } from './udf/common.js';

const CM_PX = 28.3465 * PT_TO_PX;

export function createRuler(app, tab) {
  const el = document.createElement('div');
  el.className = 'ruler';
  el.innerHTML = '<div class="ruler-inner"><button class="ruler-tabtype" data-t="0" title="Sekme türü: Sol (tıklayınca değişir)">⌊</button><svg class="ruler-scale"></svg><div class="rh rh-first" title="İlk satır girintisi"></div><div class="rh rh-hang" title="Asılı girinti"></div><div class="rh rh-left" title="Sol girinti"></div><div class="rh rh-right" title="Sağ girinti"></div><div class="ruler-tabs"></div></div>';
  tab.host.prepend(el);
  const inner = el.querySelector('.ruler-inner');
  const svg = inner.querySelector('svg');
  const h = { first: inner.querySelector('.rh-first'), hang: inner.querySelector('.rh-hang'), left: inner.querySelector('.rh-left'), right: inner.querySelector('.rh-right') };
  const tabsEl = inner.querySelector('.ruler-tabs');
  const TYPES = [['0', '⌊', 'Sol'], ['2', '⊥', 'Orta'], ['1', '⌋', 'Sağ'], ['4', '⊥.', 'Ondalık']];
  const typeBtn = el.querySelector('.ruler-tabtype');
  typeBtn.onclick = () => {
    const i = (TYPES.findIndex((t) => t[0] === typeBtn.dataset.t) + 1) % TYPES.length;
    [typeBtn.dataset.t, typeBtn.textContent] = TYPES[i];
    typeBtn.title = `Sekme türü: ${TYPES[i][2]} (tıklayınca değişir)`;
  };
  const parseStops = (p) => String(p?.tabSet || '').split(',').map((t) => t.split(':')).filter((t) => parseFloat(t[0]) > 0).map(([pos, al, ld]) => ({ pos: parseFloat(pos), al: al || '0', ld: ld || '0' }));
  const setStops = (stops) => {
    const s = [...stops].sort((a, b) => a.pos - b.pos);
    tab.editor.chain().focus().setParagraphAttrs({ tabSet: s.length ? s.map((t) => `${Math.round(t.pos * 100) / 100}:${t.al}:${t.ld}`).join(',') : null }).run();
    tab.editor.view.dom.__retab?.();
  };
  const snapPt = (pt, free) => (free ? pt : Math.round(pt / (28.3465 / 4)) * (28.3465 / 4));
  const ptAt = (clientX) => (clientX - inner.getBoundingClientRect().left) / z() / PT_TO_PX - tab.geom.left / PT_TO_PX;
  let tabDrag = null;
  let geoKey = '';
  let drag = null;
  const guide = document.createElement('div');
  guide.className = 'ruler-guide hidden';
  tab.host.append(guide);

  const z = () => app.zoom;

  function drawScale() {
    const g = tab.geom;
    const key = `${g.pageW}:${g.left}:${g.right}:${z()}`;
    if (key === geoKey) return;
    geoKey = key;
    const W = g.pageW * z();
    inner.style.width = `${W}px`;
    svg.setAttribute('width', W);
    svg.setAttribute('height', 22);
    const L = g.left * z(), R = (g.pageW - g.right) * z();
    let s = `<rect x="0" y="3" width="${L}" height="16" class="rm"/><rect x="${R}" y="3" width="${W - R}" height="16" class="rm"/>`;
    // ticks every 0,25 cm from the left margin, labelled every cm
    const step = CM_PX * z() / 4;
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let i = dir > 0 ? 0 : 1; ; i++) {
        const x = L + dir * i * step;
        if (x < 0 || x > W) break;
        const q = i % 4;
        if (q === 0 && i) s += `<text x="${x}" y="15">${i / 4}</text>`;
        else s += `<line x1="${x}" x2="${x}" y1="${q === 2 ? 8 : 10}" y2="${q === 2 ? 14 : 12}"/>`;
      }
    }
    svg.innerHTML = s;
  }

  function current() {
    const ed = tab.editor;
    const { $from } = ed.state.selection;
    const p = $from.parent.type.name === 'paragraph' ? $from.parent.attrs : null;
    let inTable = false;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') inTable = true;
    return { p, inTable };
  }

  function place(left, first, right) {
    const g = tab.geom, k = z();
    const xL = (g.left + left * PT_TO_PX) * k;
    const xF = (g.left + (left + first) * PT_TO_PX) * k;
    const xR = (g.pageW - g.right - right * PT_TO_PX) * k;
    h.first.style.left = `${xF}px`;
    h.hang.style.left = `${xL}px`;
    h.left.style.left = `${xL}px`;
    h.right.style.left = `${xR}px`;
  }

  function refresh() {
    if (el.classList.contains('hidden')) return;
    drawScale();
    if (drag) return;
    const { p, inTable } = current();
    inner.classList.toggle('no-para', !p || inTable);
    if (!p) return;
    place(p.leftIndent || 0, p.firstLineIndent || 0, p.rightIndent || 0);
    const g = tab.geom, k = z();
    const stops = parseStops(p);
    const glyph = { 0: '⌊', 2: '⊥', 1: '⌋', 4: '⊥.' };
    tabsEl.innerHTML = stops.map((t, i) => `<b data-i="${i}" class="rt rt-${t.al}" style="left:${(g.left + t.pos * PT_TO_PX) * k}px" title="Sekme: ${(t.pos / 28.3465).toFixed(2).replace('.', ',')} cm — sürükleyin; cetvelden çekip çıkarınca silinir">${glyph[t.al] || '⌊'}</b>`).join('');
  }

  // ---- dragging
  const startDrag = (kind) => (e) => {
    e.preventDefault();
    const { p } = current();
    if (!p) return;
    drag = { kind, x0: e.clientX, left: p.leftIndent || 0, first: p.firstLineIndent || 0, right: p.rightIndent || 0 };
    drag.cur = { ...drag };
    e.target.setPointerCapture(e.pointerId);
    guide.classList.remove('hidden');
    move(e);
  };
  function move(e) {
    if (!drag) return;
    const k = z();
    let dPt = (e.clientX - drag.x0) / k / PT_TO_PX;
    const snapPt = 28.3465 / 4;
    const snap = (v) => (e.altKey ? v : Math.round(v / snapPt) * snapPt);
    const c = { left: drag.left, first: drag.first, right: drag.right };
    const contentPt = (tab.geom.pageW - tab.geom.left - tab.geom.right) / PT_TO_PX;
    if (drag.kind === 'first') c.first = snap(drag.left + drag.first + dPt) - drag.left;
    else if (drag.kind === 'hang') { c.left = Math.max(0, snap(drag.left + dPt)); c.first = drag.left + drag.first - c.left; }
    else if (drag.kind === 'left') c.left = Math.max(0, snap(drag.left + dPt));
    else if (drag.kind === 'right') c.right = Math.max(0, snap(drag.right - dPt));
    c.left = Math.min(c.left, contentPt - c.right - 20);
    if (c.left + c.first < 0) c.first = -c.left;
    drag.cur = c;
    place(c.left, c.first, c.right);
    // vertical guide through the page at the dragged marker
    const handle = h[drag.kind];
    const hr = handle.getBoundingClientRect(), host = tab.host.getBoundingClientRect();
    guide.style.left = `${hr.left + hr.width / 2 - host.left + tab.host.scrollLeft}px`;
    guide.style.top = `${tab.host.scrollTop}px`;
    guide.style.height = `${tab.host.clientHeight}px`;
  }
  function end() {
    if (!drag) return;
    const c = drag.cur;
    drag = null;
    guide.classList.add('hidden');
    tab.editor.chain().focus().setParagraphAttrs({ leftIndent: Math.round(c.left * 100) / 100, firstLineIndent: Math.round(c.first * 100) / 100, rightIndent: Math.round(c.right * 100) / 100 }).run();
    refresh();
  }
  for (const [kind, node] of Object.entries(h)) {
    node.addEventListener('pointerdown', startDrag(kind));
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('lostpointercapture', end);
  }
  svg.addEventListener('dblclick', () => app.run('paragraphDialog'));
  // click on the scale (inside the text column): a new tab stop of the chosen type
  svg.addEventListener('click', (e) => {
    if (e.detail > 1) return;
    const { p, inTable } = current();
    if (!p || inTable) return;
    const pos = snapPt(ptAt(e.clientX), e.altKey);
    const width = (tab.geom.pageW - tab.geom.left - tab.geom.right) / PT_TO_PX;
    if (pos <= 0 || pos >= width) return;
    const stops = parseStops(p).filter((t) => Math.abs(t.pos - pos) > 1);
    stops.push({ pos, al: typeBtn.dataset.t, ld: '0' });
    setStops(stops);
  });
  // drag a stop to move it; off the ruler (up or down) removes it
  tabsEl.addEventListener('pointerdown', (e) => {
    const m = e.target.closest('.rt');
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    try { m.setPointerCapture(e.pointerId); } catch {}
    tabDrag = { i: Number(m.dataset.i), el: m, y0: e.clientY };
  });
  tabsEl.addEventListener('pointermove', (e) => {
    if (!tabDrag) return;
    const pos = snapPt(ptAt(e.clientX), e.altKey);
    tabDrag.el.style.left = `${(tab.geom.left + pos * PT_TO_PX) * z()}px`;
    tabDrag.el.classList.toggle('rt-off', Math.abs(e.clientY - tabDrag.y0) > 18);
  });
  const tabEnd = (e) => {
    if (!tabDrag) return;
    const d = tabDrag;
    tabDrag = null;
    const { p } = current();
    const stops = parseStops(p);
    if (Math.abs(e.clientY - d.y0) > 18) stops.splice(d.i, 1);
    else if (stops[d.i]) stops[d.i].pos = Math.max(1, snapPt(ptAt(e.clientX), e.altKey));
    setStops(stops);
    refresh();
  };
  tabsEl.addEventListener('pointerup', tabEnd);
  tabsEl.addEventListener('lostpointercapture', (e) => tabDrag && tabEnd(e));
  el.addEventListener('mousedown', (e) => { if (!e.target.closest('.rh')) e.preventDefault(); });

  return {
    refresh,
    setVisible(on) { el.classList.toggle('hidden', !on); geoKey = ''; refresh(); },
    invalidate() { geoKey = ''; refresh(); },
  };
}
