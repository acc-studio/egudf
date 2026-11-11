// Review pane (right side): comment threads in document order, plus the
// tracked-change list when there is one (see changes.js → app.changeItems).
import { $, $$, h, esc, toast, confirmBox } from '../ui.js';
import { icon } from '../icons.js';
import { commentRanges, commentsAt, addCommentMark, removeCommentMark, newId } from './comments.js';

const when = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('tr')).join('');
const hue = (n) => [...(n || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 210);
export const author = (app) => app.profile?.name || 'Ben';

let editing = null; // comment id whose body is in edit mode
let showResolved = true;

export function reviewState(tab) {
  tab.review ??= { comments: [] };
  return tab.review;
}

function changed(app, tab) {
  tab.reviewDirty = true;
  app.onReviewChange?.(tab);
  renderReview(app);
}

export function showPane(app, on = true) {
  $('#review-pane').classList.toggle('hidden', !on);
  localStorage.setItem('udf.review', on ? '1' : '0');
  renderReview(app);
  app.ui?.();
}

export function addComment(app) {
  const tab = app.tab();
  const ed = tab?.editor;
  if (!ed) return;
  const id = newId();
  const r = addCommentMark(ed, id);
  if (!r) { toast('Yorum eklemek için metin seçin.', { type: 'warn' }); return; }
  reviewState(tab).comments.push({ id, author: author(app), at: new Date().toISOString(), text: '', quote: r.quote.slice(0, 200), resolved: false, replies: [] });
  editing = id;
  showPane(app, true);
  changed(app, tab);
  setTimeout(() => $(`.rv-card[data-id="${id}"] textarea`)?.focus(), 30);
}

export function deleteComment(app, id) {
  const tab = app.tab();
  if (!tab) return;
  const rv = reviewState(tab);
  rv.comments = rv.comments.filter((c) => c.id !== id);
  removeCommentMark(tab.editor, id);
  if (editing === id) editing = null;
  changed(app, tab);
}

export async function deleteAllComments(app) {
  const tab = app.tab();
  if (!tab || !reviewState(tab).comments.length) return;
  if (!(await confirmBox({ title: 'Tüm yorumları sil', text: `Bu belgedeki ${tab.review.comments.length} yorum silinsin mi?`, ok: 'Sil', kind: 'danger' }))) return;
  for (const c of [...tab.review.comments]) removeCommentMark(tab.editor, c.id);
  tab.review.comments = [];
  changed(app, tab);
}

/** Moves the selection to the next/previous comment anchor. */
export function stepComment(app, dir) {
  const tab = app.tab();
  if (!tab) return;
  const ranges = commentRanges(tab.editor.state.doc);
  const list = reviewState(tab).comments.filter((c) => ranges[c.id]).map((c) => ({ c, r: ranges[c.id] })).sort((a, b) => a.r.from - b.r.from);
  if (!list.length) { toast('Belgede yorum yok.'); return; }
  const pos = tab.editor.state.selection.from;
  const next = dir > 0 ? list.find((x) => x.r.from > pos) || list[0] : [...list].reverse().find((x) => x.r.from < pos) || list[list.length - 1];
  focusComment(app, next.c.id);
}

export function focusComment(app, id) {
  const tab = app.tab();
  const r = commentRanges(tab.editor.state.doc)[id];
  showPane(app, true);
  if (r) tab.editor.chain().focus().setTextSelection(r).scrollIntoView().run();
  renderReview(app);
  $(`.rv-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

/** Comments to strip before signing: returns the count. */
export function openCommentCount(tab) {
  return (tab?.review?.comments || []).filter((c) => !c.resolved).length;
}

export function renderReview(app) {
  const pane = $('#review-pane');
  if (!pane || pane.classList.contains('hidden')) return;
  const tab = app.tab();
  const list = $('.rv-list', pane);
  $('#rv-resolved').classList.toggle('active', showResolved);
  if (!tab) { list.innerHTML = '<div class="nav-empty">Açık belge yok.</div>'; return; }
  const ed = tab.editor;
  const rv = reviewState(tab);
  const ranges = commentRanges(ed.state.doc);
  const active = new Set(commentsAt(ed.state));
  document.querySelectorAll('.udf-comment.active').forEach((e) => e.classList.remove('active'));
  for (const id of active) ed.view.dom.querySelectorAll(`[data-comment="${id}"]`).forEach((e) => e.classList.add('active'));
  for (const c of rv.comments) ed.view.dom.querySelectorAll(`[data-comment="${c.id}"]`).forEach((e) => e.classList.toggle('resolved', !!c.resolved));
  const sorted = [...rv.comments].sort((a, b) => (ranges[a.id]?.from ?? 1e9) - (ranges[b.id]?.from ?? 1e9));
  const changes = app.changeItems?.(tab) || [];
  const shown = sorted.filter((c) => showResolved || !c.resolved);
  $('#rv-count').textContent = `${rv.comments.length} yorum${changes.length ? ` · ${changes.length} değişiklik` : ''}`;
  if (!shown.length && !changes.length) {
    list.innerHTML = `<div class="nav-empty">Yorum yok. Metni seçip <b>Yeni yorum</b>'a (Ctrl+Alt+M) basın.</div>`;
    return;
  }
  const focusEl = document.activeElement?.closest?.('.rv-card');
  const keep = focusEl && document.activeElement.tagName === 'TEXTAREA' ? { id: focusEl.dataset.id, value: document.activeElement.value, cls: document.activeElement.className } : null;
  list.innerHTML = '';
  for (const c of shown) {
    const orphan = !ranges[c.id];
    const card = h(`<div class="rv-card ${active.has(c.id) ? 'active' : ''} ${c.resolved ? 'resolved' : ''} ${orphan ? 'orphan' : ''}" data-id="${esc(c.id)}">
      <div class="rv-head"><span class="av" style="background:hsl(${hue(c.author)} 55% 48%)">${esc(initials(c.author))}</span><div class="who"><b>${esc(c.author)}</b><span>${esc(when(c.at))}${c.resolved ? ' · çözüldü' : ''}</span></div>
        <button class="icon-btn" data-act="resolve" title="${c.resolved ? 'Yeniden aç' : 'Çözüldü olarak işaretle'}">${icon(c.resolved ? 'undo' : 'accept')}</button>
        <button class="icon-btn" data-act="delete" title="Yorumu sil">${icon('reject')}</button></div>
      ${c.quote ? `<div class="rv-quote">${orphan ? '<i>Bağlı metin silindi</i> · ' : ''}${esc(c.quote.length > 90 ? `${c.quote.slice(0, 90)}…` : c.quote)}</div>` : ''}
      ${editing === c.id ? `<textarea class="rv-edit" rows="2" placeholder="Yorumunuz… (Enter kaydeder)">${esc(c.text)}</textarea>` : `<div class="rv-text" title="Düzenlemek için çift tıklayın">${esc(c.text) || '<span class="dim">(boş)</span>'}</div>`}
      ${(c.replies || []).map((r, i) => `<div class="rv-reply-item"><div class="rv-head"><span class="av sm" style="background:hsl(${hue(r.author)} 55% 48%)">${esc(initials(r.author))}</span><div class="who"><b>${esc(r.author)}</b><span>${esc(when(r.at))}</span></div><button class="icon-btn" data-act="delreply" data-i="${i}" title="Yanıtı sil">${icon('reject')}</button></div><div class="rv-text">${esc(r.text)}</div></div>`).join('')}
      ${!c.resolved && editing !== c.id ? '<textarea class="rv-reply" rows="1" placeholder="Yanıtla…"></textarea>' : ''}
    </div>`);
    list.append(card);
  }
  for (const it of changes) {
    const card = h(`<div class="rv-card change ${it.kind}" data-change="${it.from}">
      <div class="rv-head"><span class="av" style="background:hsl(${hue(it.author)} 55% 48%)">${esc(initials(it.author))}</span><div class="who"><b>${esc(it.author)}</b><span>${it.kind === 'insertion' ? 'Ekledi' : it.kind === 'deletion' ? 'Sildi' : 'Biçimlendirdi'} · ${esc(when(it.at))}</span></div>
        <button class="icon-btn" data-act="accept" title="Kabul et">${icon('accept')}</button>
        <button class="icon-btn" data-act="reject" title="Reddet">${icon('reject')}</button></div>
      <div class="rv-text ${it.kind}">${esc(it.text.length > 140 ? `${it.text.slice(0, 140)}…` : it.text)}</div></div>`);
    card._item = it;
    list.append(card);
  }
  if (keep) {
    const ta = $(`.rv-card[data-id="${keep.id}"] textarea.${keep.cls.split(' ')[0]}`, list);
    if (ta) { ta.value = keep.value; ta.focus(); }
  }
}

export function wireReviewPane(app) {
  const pane = $('#review-pane');
  $('#rv-close').innerHTML = icon('close');
  $('#rv-close').onclick = () => showPane(app, false);
  $('#rv-new').innerHTML = `${icon('comment')}<span>Yeni</span>`;
  $('#rv-new').onmousedown = (e) => e.preventDefault();
  $('#rv-new').onclick = () => addComment(app);
  $('#rv-resolved').innerHTML = icon('accept');
  $('#rv-resolved').onclick = () => { showResolved = !showResolved; renderReview(app); };
  const list = $('.rv-list', pane);
  const find = (el) => { const card = el.closest('.rv-card'); const tab = app.tab(); return { card, tab, c: card && tab ? reviewState(tab).comments.find((x) => x.id === card.dataset.id) : null }; };
  list.addEventListener('click', (e) => {
    const { card, tab, c } = find(e.target);
    if (!card) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (card._item) {
      if (act === 'accept' || act === 'reject') app.resolveChange?.(card._item, act === 'accept');
      else app.focusChange?.(card._item);
      return;
    }
    if (!c) return;
    if (act === 'delete') { deleteComment(app, c.id); return; }
    if (act === 'resolve') { c.resolved = !c.resolved; changed(app, tab); return; }
    if (act === 'delreply') { c.replies.splice(Number(e.target.closest('[data-act]').dataset.i), 1); changed(app, tab); return; }
    if (e.target.tagName === 'TEXTAREA') return;
    const r = commentRanges(tab.editor.state.doc)[c.id];
    if (r) tab.editor.chain().focus().setTextSelection(r).scrollIntoView().run();
  });
  list.addEventListener('dblclick', (e) => {
    const { c } = find(e.target);
    if (!c || !e.target.closest('.rv-text') || e.target.closest('.rv-reply-item')) return;
    editing = c.id;
    renderReview(app);
    $(`.rv-card[data-id="${c.id}"] textarea.rv-edit`)?.focus();
  });
  list.addEventListener('keydown', (e) => {
    const ta = e.target;
    if (ta.tagName !== 'TEXTAREA') return;
    const { tab, c } = find(ta);
    if (!c) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ta.classList.contains('rv-edit')) {
        editing = null;
        if (!c.text) { deleteComment(app, c.id); return; }
        renderReview(app);
      } else { ta.value = ''; ta.blur(); }
      tab.editor.commands.focus();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const v = ta.value.trim();
    if (ta.classList.contains('rv-edit')) {
      editing = null;
      if (!v) { deleteComment(app, c.id); return; }
      c.text = v;
      c.editedAt = new Date().toISOString();
    } else if (v) {
      c.replies.push({ author: author(app), at: new Date().toISOString(), text: v });
    } else return;
    changed(app, tab);
    tab.editor.commands.focus();
  });
  list.addEventListener('focusout', (e) => {
    const ta = e.target;
    if (!ta.classList?.contains('rv-edit')) return;
    const { tab, c } = find(ta);
    if (!c) return;
    setTimeout(() => {
      if (!document.body.contains(ta) || editing !== c.id) return;
      const v = ta.value.trim();
      editing = null;
      if (!v && !c.text) { deleteComment(app, c.id); return; }
      if (v) c.text = v;
      changed(app, tab);
    }, 120);
  });
  if (localStorage.getItem('udf.review') === '1') pane.classList.remove('hidden');
}
