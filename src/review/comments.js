// Comments: a `comment` mark (id) anchors each thread to text; the thread data
// lives in tab.review.comments. Neither reaches content.xml — review data is
// stored next to it in the .udf zip (see store.js), so UYAP never sees it.
import { Mark, mergeAttributes } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '', // overlapping threads
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute('data-comment') } };
  },
  parseHTML() { return [{ tag: 'span[data-comment]' }]; },
  renderHTML({ HTMLAttributes, mark }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-comment': mark.attrs.id, class: 'udf-comment' }), 0];
  },
});

export const newId = (p = 'c') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** { id → { from, to } } for every comment mark in the document. */
export function commentRanges(doc) {
  const out = {};
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    for (const m of n.marks) {
      if (m.type.name !== 'comment') continue;
      const r = out[m.attrs.id];
      if (r) { r.from = Math.min(r.from, pos); r.to = Math.max(r.to, pos + n.nodeSize); } else out[m.attrs.id] = { from: pos, to: pos + n.nodeSize };
    }
    return false;
  });
  return out;
}

/** Ids of comments covering the cursor/selection start. */
export function commentsAt(state) {
  const { $from, from, to, empty } = state.selection;
  const ids = new Set();
  const marks = empty ? $from.marks().concat($from.nodeAfter?.marks || []) : [];
  for (const m of marks) if (m.type.name === 'comment') ids.add(m.attrs.id);
  if (!empty) state.doc.nodesBetween(from, to, (n) => { for (const m of n.marks) if (m.type.name === 'comment') ids.add(m.attrs.id); });
  return [...ids];
}

/** Word under the cursor when nothing is selected. */
export function wordRange(state) {
  const { $from } = state.selection;
  const text = $from.parent.textContent;
  let a = $from.parentOffset, b = a;
  while (a > 0 && /[\p{L}\p{N}]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}]/u.test(text[b])) b++;
  return a === b ? null : { from: $from.start() + a, to: $from.start() + b };
}

export function addCommentMark(ed, id) {
  let { from, to, empty } = ed.state.selection;
  if (empty) {
    const w = wordRange(ed.state);
    if (!w) return null;
    ({ from, to } = w);
  }
  const tr = ed.state.tr.addMark(from, to, ed.schema.marks.comment.create({ id })).setMeta('reviewOnly', true);
  ed.view.dispatch(tr);
  return { from, to, quote: ed.state.doc.textBetween(from, to, ' ') };
}

export function removeCommentMark(ed, id) {
  const tr = ed.state.tr;
  ed.state.doc.descendants((n, pos) => {
    if (!n.isText) return true;
    const m = n.marks.find((x) => x.type.name === 'comment' && x.attrs.id === id);
    if (m) tr.removeMark(pos, pos + n.nodeSize, m);
    return false;
  });
  if (tr.docChanged) ed.view.dispatch(tr.setMeta('reviewOnly', true));
}
