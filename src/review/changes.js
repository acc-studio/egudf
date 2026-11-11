// Track changes ("Değişiklikleri izle").
//
// While tracking is on, an appendTransaction pass rewrites every edit:
//   - inserted text gets an `insertion` mark (author, time);
//   - deleted text is put back with a `deletion` mark, except text that was
//     itself a pending insertion (deleting your own new text just removes it);
//   - paragraph splits/joins and other structure-only edits stay untracked.
// Undo/redo and accept/reject transactions are never re-tracked. content.xml
// receives the document as if every change were accepted (codec drops
// deletion text); the marked-up document lives in the review entry.
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Mapping, ReplaceStep } from '@tiptap/pm/transform';

export const trackKey = new PluginKey('trackChanges');
const SKIP = 'trackSkip';

const changeAttrs = () => ({
  author: { default: '' },
  at: { default: '' },
});
const hueOf = (n) => [...(n || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 140);

export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: false,
  excludes: 'deletion',
  addAttributes: changeAttrs,
  parseHTML() { return [{ tag: 'ins[data-author]', getAttrs: (el) => ({ author: el.dataset.author, at: el.dataset.at }) }]; },
  renderHTML({ mark, HTMLAttributes }) {
    return ['ins', mergeAttributes(HTMLAttributes, { class: 'udf-ins', 'data-author': mark.attrs.author, 'data-at': mark.attrs.at, style: `--rev:hsl(${hueOf(mark.attrs.author)} 60% 36%)`, title: `${mark.attrs.author} ekledi` }), 0];
  },
});

export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: false,
  excludes: 'insertion',
  addAttributes: changeAttrs,
  parseHTML() { return [{ tag: 'del[data-author]', getAttrs: (el) => ({ author: el.dataset.author, at: el.dataset.at }) }]; },
  renderHTML({ mark, HTMLAttributes }) {
    return ['del', mergeAttributes(HTMLAttributes, { class: 'udf-del', 'data-author': mark.attrs.author, 'data-at': mark.attrs.at, title: `${mark.attrs.author} sildi` }), 0];
  },
});

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addStorage() { return { enabled: false, author: 'Ben' }; },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: trackKey,
      appendTransaction(trs, oldState, newState) {
        if (!storage.enabled) return null;
        const changed = trs.filter((t) => t.docChanged);
        if (!changed.length) return null;
        // undo/redo, accept/reject, comment anchors and silent maintenance edits are not edits by the author
        if (changed.some((t) => t.getMeta(SKIP) || t.getMeta('reviewOnly') || t.getMeta('history$') || t.getMeta('addToHistory') === false)) return null;
        return track(trs, oldState, newState, storage.author);
      },
    })];
  },
});

function track(trs, oldState, newState, author) {
  const schema = newState.schema;
  const ins = schema.marks.insertion, del = schema.marks.deletion;
  const at = `${new Date().toISOString().slice(0, 16)}Z`; // minute precision keeps adjacent edits in one mark
  // every step with the doc it applied to, in order
  const steps = [];
  for (const tr of trs) tr.steps.forEach((s, i) => steps.push({ step: s, doc: tr.docs[i] }));
  const maps = steps.map((s) => s.step.getMap());
  const inserted = []; // [from, to] in newState
  const deleted = []; // { pos (newState), slice, backspace }
  const head0 = oldState.selection.empty ? oldState.selection.head : null;
  steps.forEach(({ step, doc }, k) => {
    if (!(step instanceof ReplaceStep)) return; // marks / wrapping: untracked
    const rest = new Mapping(maps.slice(k + 1));
    const { from, to, slice } = step;
    if (slice.size) {
      const a = rest.map(from, 1), b = rest.map(from + slice.size, -1);
      if (b > a) inserted.push([a, b]);
    }
    if (to > from) {
      const removed = doc.slice(from, to);
      let hasText = false;
      removed.content.descendants((n) => { if (n.isText || n.isLeaf) hasText = true; return !hasText; });
      if (!hasText) return; // structural (paragraph join): untracked
      deleted.push({ pos: rest.map(from, -1), slice: removed, backspace: head0 === to && k === 0 });
    }
  });
  if (!inserted.length && !deleted.length) return null;
  const tr = newState.tr.setMeta(SKIP, true);
  for (const [a, b] of inserted) {
    tr.removeMark(a, b, del);
    tr.addMark(a, b, ins.create({ author, at }));
  }
  let cursor = null;
  // re-insert deletions (last first keeps earlier positions valid)
  for (const d of [...deleted].sort((x, y) => y.pos - x.pos)) {
    const pos = tr.mapping.map(d.pos, -1);
    const before = tr.doc.content.size;
    try { tr.replace(pos, pos, d.slice); } catch { continue; }
    const len = tr.doc.content.size - before;
    if (len <= 0) continue;
    tr.addMark(pos, pos + len, del.create({ author, at }));
    // text that was a pending insertion is really gone
    const drop = [];
    tr.doc.nodesBetween(pos, pos + len, (n, p) => {
      if (n.isText && n.marks.some((m) => m.type === ins)) drop.push([Math.max(p, pos), Math.min(p + n.nodeSize, pos + len)]);
    });
    let kept = len;
    for (const [a, b] of drop.reverse()) { tr.delete(a, b); kept -= b - a; }
    if (oldState.selection.empty && cursor == null) cursor = d.backspace ? pos : pos + kept;
  }
  if (cursor != null) {
    try { tr.setSelection(TextSelection.create(tr.doc, Math.max(0, Math.min(cursor, tr.doc.content.size)))); } catch {}
  }
  return tr.docChanged ? tr : null;
}

// ------------------------------------------------------------------ queries / actions

/** Grouped tracked changes: [{ kind, author, at, from, to, text }] in document order. */
export function changeList(doc) {
  const out = [];
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    for (const kind of ['insertion', 'deletion']) {
      const m = n.marks.find((x) => x.type.name === kind);
      if (!m) continue;
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.author === m.attrs.author && last.to === pos) { last.to = pos + n.nodeSize; last.text += n.text; } else out.push({ kind, author: m.attrs.author, at: m.attrs.at, from: pos, to: pos + n.nodeSize, text: n.text });
    }
    return false;
  });
  return out;
}

/** Accepts (true) or rejects (false) every change overlapping [from, to]. */
export function resolveChanges(ed, from, to, accept) {
  const { state } = ed;
  const tr = state.tr.setMeta(SKIP, true);
  const ranges = [];
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) return true;
    for (const kind of ['insertion', 'deletion']) {
      if (n.marks.some((m) => m.type.name === kind)) ranges.push({ kind, a: pos, b: pos + n.nodeSize });
    }
    return false;
  });
  for (const r of ranges.reverse()) {
    const removeText = (r.kind === 'insertion') !== accept; // reject insertion / accept deletion
    if (removeText) tr.delete(tr.mapping.map(r.a), tr.mapping.map(r.b));
    else tr.removeMark(tr.mapping.map(r.a), tr.mapping.map(r.b), state.schema.marks[r.kind]);
  }
  if (tr.docChanged) ed.view.dispatch(tr);
  return ranges.length;
}

export function resolveAll(ed, accept) {
  return resolveChanges(ed, 0, ed.state.doc.content.size, accept);
}

/** Changes at the cursor (or in the selection). */
export function changesAt(state) {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return changeList(state.doc).filter((c) => c.to > from && c.from < to);
  return changeList(state.doc).filter((c) => c.from <= $from.pos && c.to >= $from.pos);
}

export function setTracking(ed, on, author) {
  const s = ed.storage.trackChanges;
  s.enabled = on;
  if (author) s.author = author;
}
