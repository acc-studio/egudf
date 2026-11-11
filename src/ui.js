// Small UI kit: modal, popup menu, toast, pickers. No framework.
import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ modal
/**
 * modal({ title, icon, body: html|Element, width, actions: [{ label, kind, onClick(close) → false keeps open }], onClose })
 */
export function modal({ title, icon: ic = 'info', body, width = 520, actions = [], onClose, dismissable = true }) {
  const back = h(`<div class="backdrop"><div class="modal" role="dialog" style="width:${width}px">
    <div class="modal-head">${icon(ic)}<span>${esc(title)}</span><button class="icon-btn x" title="Kapat">${icon('close')}</button></div>
    <div class="modal-body"></div><div class="modal-foot"></div></div></div>`);
  const m = back.firstElementChild;
  const bodyEl = $('.modal-body', m);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
  };
  const foot = $('.modal-foot', m);
  for (const a of actions) {
    const b = h(`<button class="btn ${a.kind || ''} ${a.left ? 'left' : ''}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`);
    if (a.id) b.id = a.id;
    b.onclick = async () => {
      if (b.disabled) return;
      const r = await a.onClick?.(close, b);
      if (r !== false) close(a.value ?? a.label);
    };
    foot.append(b);
  }
  if (!actions.length) foot.remove();
  $('.x', m).onclick = () => close(null);
  if (dismissable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
  const onKey = (e) => {
    if (!back.isConnected) { document.removeEventListener('keydown', onKey, true); return; } // removed without close()
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(null); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.mini-editor')) {
      const primary = $('.modal-foot .btn.primary, .modal-foot .btn.ok', m);
      if (primary && !primary.disabled) { e.preventDefault(); primary.click(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').append(back);
  setTimeout(() => $('input:not([type=hidden]), select', bodyEl)?.focus(), 30);
  return { el: m, body: bodyEl, close, foot };
}

export function confirmBox({ title, text, ok = 'Tamam', cancel = 'İptal', kind = 'primary', icon: ic = 'warn', extra }) {
  return new Promise((resolve) => {
    const actions = [];
    if (extra) actions.push({ label: extra.label, kind: extra.kind || '', left: true, value: extra.value });
    actions.push({ label: cancel, value: false }, { label: ok, kind, value: true });
    modal({ title, icon: ic, body: `<p style="margin:4px 0 8px;line-height:1.55">${text}</p>`, actions, onClose: (r) => resolve(r ?? false), width: 460 });
  });
}

/** promptBox({ title, label, value, ok }) → string | null */
export function promptBox({ title, label, value = '', ok = 'Tamam', icon: ic = 'info', placeholder = '' }) {
  return new Promise((resolve) => {
    const body = h(`<div><div class="field"><label>${esc(label)}</label><input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"></div></div>`);
    let result = null;
    modal({ title, icon: ic, body, width: 440, onClose: () => resolve(result), actions: [{ label: 'İptal' }, { label: ok, kind: 'primary', onClick: () => { const v = body.querySelector('input').value.trim(); if (!v) return false; result = v; return true; } }] });
  });
}

// ------------------------------------------------------------------ menu
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);

/** menu(anchor, items | Element). item: { label, icon, checked, onClick, sep, header, html } */
export function menu(anchor, items) {
  closeMenu();
  const m = h('<div class="menu"></div>');
  if (items instanceof Element) m.append(items);
  else {
    for (const it of items) {
      if (it.sep) { m.append(h('<div class="msep"></div>')); continue; }
      if (it.header) { m.append(h(`<div class="mh">${esc(it.header)}</div>`)); continue; }
      const el = h(`<div class="mi ${it.checked ? 'checked' : ''} ${it.disabled ? 'disabled' : ''}">${it.icon ? icon(it.icon) : '<span class="ic-pad"></span>'}<span>${it.html || esc(it.label)}</span>${it.kbd ? `<kbd class="mk">${esc(it.kbd)}</kbd>` : ''}</div>`);
      el.onclick = () => { if (it.disabled) return; closeMenu(); it.onClick?.(); };
      m.append(el);
    }
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  m.style.left = `${Math.min(r.left, window.innerWidth - mr.width - 8)}px`;
  m.style.top = `${r.bottom + mr.height + 4 > window.innerHeight ? Math.max(8, r.top - mr.height - 4) : r.bottom + 4}px`;
  openMenu = m;
  return m;
}

export const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#d9d9d9', '#efefef', '#ffffff',
  '#c00000', '#ff0000', '#ff9900', '#ffff00', '#00b050', '#00b0f0', '#0070c0', '#7030a0',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9',
  '#a61c00', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75',
];

export function colorMenu(anchor, { onPick, noneLabel = 'Otomatik' }) {
  const wrap = h(`<div><div class="mi" data-none>${esc(noneLabel)}</div><div class="swatches"></div></div>`);
  const sw = $('.swatches', wrap);
  for (const c of PALETTE) {
    const b = h(`<button title="${c}" style="background:${c}"></button>`);
    b.onclick = () => { closeMenu(); onPick(c); };
    sw.append(b);
  }
  $('[data-none]', wrap).onclick = () => { closeMenu(); onPick(null); };
  return menu(anchor, wrap);
}

export function gridMenu(anchor, onPick) {
  const wrap = h('<div class="grid-pick"><div class="cells"></div><div class="lbl">Tablo ekle</div></div>');
  const cells = $('.cells', wrap);
  const lbl = $('.lbl', wrap);
  const R = 8, C = 10;
  for (let r = 1; r <= R; r++) {
    for (let c = 1; c <= C; c++) {
      const s = document.createElement('span');
      s.onmouseenter = () => {
        $$('span', cells).forEach((x, i) => x.classList.toggle('on', Math.floor(i / C) < r && (i % C) < c));
        lbl.textContent = `${r} × ${c} tablo`;
      };
      s.onclick = () => { closeMenu(); onPick(r, c); };
      cells.append(s);
    }
  }
  return menu(anchor, wrap);
}

// ------------------------------------------------------------------ toast
export function toast(msg, { type = 'info', actions = [], ms = 4200 } = {}) {
  const ic = { ok: 'check', warn: 'warn', bad: 'warn', info: 'info' }[type];
  const t = h(`<div class="toast ${type}">${icon(ic)}<span>${esc(msg)}</span></div>`);
  for (const a of actions) {
    const b = h(`<button>${esc(a.label)}</button>`);
    b.onclick = () => { t.remove(); a.onClick(); };
    t.append(b);
  }
  $('#toasts').append(t);
  setTimeout(() => t.remove(), actions.length ? ms * 2 : ms);
  return t;
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

/** "12345678901" → "123******01" */
export const maskTckn = (s) => (/^\d{11}$/.test(s || '') ? `${s.slice(0, 3)}******${s.slice(9)}` : (s || ''));
