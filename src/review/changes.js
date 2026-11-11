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
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Mapping, ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep, AttrStep } from '@tiptap/pm/transform';

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

// Formatting changes on text: the marks the text had before (Word's rPrChange).
export const FormatChangeMark = Mark.create({
  name: 'formatChange',
  inclusive: false,
  excludes: 'formatChange',
  addAttributes() { return { ...changeAttrs(), before: { default: [] } }; },
  addGlobalAttributes() {
    // pending paragraph formatting change: { author, at, before: {attrs} } (Word's pPrChange)
    return [{ types: ['paragraph'], attributes: { fmtChange: { default: null, rendered: false } } }];
  },
  parseHTML() { return [{ tag: 'span[data-fmt-author]', getAttrs: (el) => ({ author: el.dataset.fmtAuthor, at: el.dataset.at, before: JSON.parse(el.dataset.before || '[]') }) }]; },
  renderHTML({ mark, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'udf-fmt', 'data-fmt-author': mark.attrs.author, 'data-at': mark.attrs.at, 'data-before': JSON.stringify(mark.attrs.before || []), style: `--rev:hsl(${hueOf(mark.attrs.author)} 60% 40%)`, title: `${mark.attrs.author} biçimlendirdi (${describeFormat(mark.attrs.before, null)})` }), 0];
  },
});

/** Marks that describe review state rather than formatting. */
export const REVIEW_MARKS = new Set(['insertion', 'deletion', 'comment', 'formatChange', 'udfRun']);
const fmtMarks = (marks) => marks.filter((m) => !REVIEW_MARKS.has(m.type.name ?? m.type));
const markKey = (m) => JSON.stringify({ t: m.type.name ?? m.type, a: m.attrs && Object.keys(m.attrs).length ? m.attrs : undefined });
const sameFormat = (a, b) => { const x = a.map(markKey).sort(), y = b.map(markKey).sort(); return x.length === y.length && x.every((k, i) => k === y[i]); };

const MARK_NAMES = { bold: 'Kalın', italic: 'İtalik', underline: 'Altı çizili', strike: 'Üstü çizili', subscript: 'Alt simge', superscript: 'Üst simge', highlight: 'Vurgu' };
const STYLE_NAMES = { fontFamily: 'Yazı tipi', fontSize: 'Boyut', color: 'Renk' };
const PARA_NAMES = { align: 'Hizalama', leftIndent: 'Sol girinti', rightIndent: 'Sağ girinti', firstLineIndent: 'İlk satır girintisi', spaceAbove: 'Önce boşluk', spaceBelow: 'Sonra boşluk', lineSpacing: 'Satır aralığı', list: 'Liste', tabSet: 'Sekmeler' };

const flatFormat = (list) => {
  const o = {};
  for (const m of list || []) {
    const t = m.type.name ?? m.type;
    if (REVIEW_MARKS.has(t)) continue;
    if (t === 'textStyle') { for (const [k, v] of Object.entries(m.attrs || {})) if (v) o[k] = v; } else o[t] = t === 'highlight' ? m.attrs?.color || true : true;
  }
  return o;
};

/** "Kalın, Boyut: 14pt": what changed between `before` marks and `after` marks (JSON or Mark). */
export function describeFormat(before = [], after = null) {
  const b = flatFormat(before);
  if (!after) return Object.keys(b).length ? `önceki: ${Object.entries(b).map(([k, v]) => (STYLE_NAMES[k] ? `${STYLE_NAMES[k]} ${v}` : MARK_NAMES[k] || k)).join(', ')}` : 'önceki: düz metin';
  const a = flatFormat(after);
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    if (STYLE_NAMES[k]) out.push(a[k] ? `${STYLE_NAMES[k]}: ${String(a[k]).replace(/["']/g, '')}` : `${STYLE_NAMES[k]} varsayılan`);
    else out.push(a[k] ? (MARK_NAMES[k] || k) : `${MARK_NAMES[k] || k} değil`);
  }
  return out.join(', ') || 'Biçim';
}

export function describePara(before = {}, after = {}) {
  const out = [];
  for (const k of Object.keys(PARA_NAMES)) {
    if (JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null)) continue;
    if (k === 'align') out.push(`${{ left: 'Sola', center: 'Ortaya', right: 'Sağa', justify: 'İki yana' }[after.align] || after.align} hizalı`);
    else if (k === 'list') out.push(after.list ? (after.list.kind === 'number' ? 'Numaralı liste' : 'Madde işaretli liste') : 'Liste kaldırıldı');
    else out.push(PARA_NAMES[k]);
  }
  return out.join(', ') || 'Paragraf biçimi';
}

const paraFmtKey = new PluginKey('paraFormatChanges');

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addStorage() { return { enabled: false, author: 'Ben' }; },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const paraDecos = new Plugin({
      key: paraFmtKey,
      props: {
        decorations(state) {
          const d = [];
          state.doc.descendants((n, pos) => {
            if (n.type.name !== 'paragraph') return true;
            const c = n.attrs.fmtChange;
            if (c) d.push(Decoration.node(pos, pos + n.nodeSize, { class: 'udf-pfmt', style: `--rev:hsl(${hueOf(c.author)} 60% 40%)`, title: `${c.author} paragraf biçimini değiştirdi: ${describePara(c.before, n.attrs)}` }));
            return false;
          });
          return d.length ? DecorationSet.create(state.doc, d) : null;
        },
      },
    });
    return [paraDecos, new Plugin({
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
  const formatted = []; // { a, b (newState), before: marks JSON | null (already tracked) }
  const paraFmt = []; // { pos (newState), before: attrs | null }
  const head0 = oldState.selection.empty ? oldState.selection.head : null;
  steps.forEach(({ step, doc }, k) => {
    const rest = new Mapping(maps.slice(k + 1));
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      if (REVIEW_MARKS.has(step.mark.type.name)) return;
      doc.nodesBetween(step.from, step.to, (n, pos) => {
        if (!n.isText) return true;
        if (n.marks.some((m) => m.type === ins || m.type === del)) return false; // new or removed text: already a change
        const a = Math.max(pos, step.from), b = Math.min(pos + n.nodeSize, step.to);
        const prev = n.marks.find((m) => m.type.name === 'formatChange');
        formatted.push({ a: rest.map(a, 1), b: rest.map(b, -1), before: prev ? null : fmtMarks(n.marks).map((m) => m.toJSON()) });
        return false;
      });
      return;
    }
    if (step instanceof ReplaceAroundStep || step instanceof AttrStep) {
      const pos = step instanceof AttrStep ? step.pos : step.from;
      const old = doc.nodeAt(pos);
      if (!old || old.type.name !== 'paragraph') return;
      if (step instanceof ReplaceAroundStep) {
        const nn = step.slice.content.firstChild;
        if (!(step.structure && step.insert === 1 && step.gapFrom === step.from + 1 && step.gapTo === step.to - 1 && step.slice.content.childCount === 1 && nn?.type === old.type)) return;
      } else if (step.attr === 'fmtChange') return;
      const { fmtChange, ...before } = old.attrs;
      paraFmt.push({ pos: rest.map(pos, 1), before: fmtChange ? null : before });
      return;
    }
    if (!(step instanceof ReplaceStep)) return; // other structure edits: untracked
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
  if (!inserted.length && !deleted.length && !formatted.length && !paraFmt.length) return null;
  const tr = newState.tr.setMeta(SKIP, true);
  const fc = schema.marks.formatChange;
  for (const f of formatted) {
    if (!fc || f.b <= f.a) continue;
    tr.doc.nodesBetween(f.a, f.b, (n, pos) => {
      if (!n.isText) return true;
      const a = Math.max(pos, f.a), b = Math.min(pos + n.nodeSize, f.b);
      if (n.marks.some((m) => m.type === ins || m.type === del)) return false;
      const prev = n.marks.find((m) => m.type === fc);
      const before = prev ? prev.attrs.before : f.before;
      if (!before) return false;
      // formatting put back as it was: nothing left to review
      if (sameFormat(fmtMarks(n.marks), before)) { if (prev) tr.removeMark(a, b, fc); return false; }
      if (!prev) tr.addMark(a, b, fc.create({ author, at, before }));
      return false;
    });
  }
  for (const p of paraFmt) {
    const n = tr.doc.nodeAt(p.pos);
    if (!n || n.type.name !== 'paragraph') continue;
    const { fmtChange, ...now } = n.attrs;
    const before = fmtChange ? fmtChange.before : p.before;
    if (!before) continue;
    const same = Object.keys(now).every((k) => JSON.stringify(now[k] ?? null) === JSON.stringify(before[k] ?? null));
    if (same) { if (fmtChange) tr.setNodeMarkup(p.pos, undefined, { ...now, fmtChange: null }); continue; }
    if (!fmtChange) tr.setNodeMarkup(p.pos, undefined, { ...now, fmtChange: { author, at, before } });
  }
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

/**
 * Grouped tracked changes in document order:
 * [{ kind: 'insertion'|'deletion'|'format'|'paraFormat', author, at, from, to, text, desc? }]
 */
export function changeList(doc) {
  const out = [];
  const lastOf = {};
  doc.descendants((n, pos) => {
    if (n.type.name === 'paragraph' && n.attrs.fmtChange) {
      const c = n.attrs.fmtChange;
      out.push({ kind: 'paraFormat', author: c.author, at: c.at, from: pos, to: pos + n.nodeSize, text: n.textContent, desc: describePara(c.before, n.attrs), pos });
    }
    if (!n.isText) return true;
    for (const kind of ['insertion', 'deletion', 'formatChange']) {
      const m = n.marks.find((x) => x.type.name === kind);
      if (!m) continue;
      const k = kind === 'formatChange' ? 'format' : kind;
      const last = lastOf[k];
      if (last && last.author === m.attrs.author && last.to === pos && (k !== 'format' || JSON.stringify(last.before) === JSON.stringify(m.attrs.before))) { last.to = pos + n.nodeSize; last.text += n.text; } else {
        const it = { kind: k, author: m.attrs.author, at: m.attrs.at, from: pos, to: pos + n.nodeSize, text: n.text };
        if (k === 'format') { it.before = m.attrs.before; it.desc = describeFormat(m.attrs.before, n.marks); }
        out.push(it);
        lastOf[k] = it;
      }
    }
    return false;
  });
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Accepts (true) or rejects (false) every change overlapping [from, to].
 * Paragraph formatting is included when the paragraph lies inside the range,
 * or always with { paragraphs: true }. { kinds } limits the change kinds.
 */
export function resolveChanges(ed, from, to, accept, { kinds = null, paragraphs = false } = {}) {
  const { state } = ed;
  const tr = state.tr.setMeta(SKIP, true);
  const ranges = [];
  const want = (k) => !kinds || kinds.includes(k);
  const fc = state.schema.marks.formatChange;
  let count = 0;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'paragraph' && n.attrs.fmtChange && want('paraFormat') && (paragraphs || (pos >= from && pos + n.nodeSize <= to))) {
      const { fmtChange, ...now } = n.attrs;
      tr.setNodeMarkup(pos, undefined, accept ? { ...now, fmtChange: null } : { ...now, ...fmtChange.before, fmtChange: null });
      count++;
    }
    if (!n.isText) return true;
    for (const kind of ['insertion', 'deletion']) {
      if (want(kind) && n.marks.some((m) => m.type.name === kind)) ranges.push({ kind, a: pos, b: pos + n.nodeSize });
    }
    const f = fc && want('format') && n.marks.find((m) => m.type === fc);
    if (f) {
      const a = Math.max(pos, from), b = Math.min(pos + n.nodeSize, to);
      tr.removeMark(a, b, fc);
      if (!accept) {
        for (const m of fmtMarks(n.marks)) tr.removeMark(a, b, m.type);
        for (const j of f.attrs.before || []) { try { tr.addMark(a, b, state.schema.markFromJSON(j)); } catch {} }
      }
      count++;
    }
    return false;
  });
  count += ranges.length;
  for (const r of ranges.reverse()) {
    const removeText = (r.kind === 'insertion') !== accept; // reject insertion / accept deletion
    if (removeText) tr.delete(tr.mapping.map(r.a), tr.mapping.map(r.b));
    else tr.removeMark(tr.mapping.map(r.a), tr.mapping.map(r.b), state.schema.marks[r.kind]);
  }
  if (tr.docChanged) ed.view.dispatch(tr);
  return count;
}

export function resolveAll(ed, accept) {
  const n = changeList(ed.state.doc).length;
  resolveChanges(ed, 0, ed.state.doc.content.size, accept, { paragraphs: true });
  return n;
}

/** Resolves exactly the given changeList() items. */
export function resolveItems(ed, items, accept) {
  for (const it of [...items].sort((a, b) => b.from - a.from)) {
    if (it.kind === 'paraFormat') {
      const n = ed.state.doc.nodeAt(it.pos);
      if (n?.attrs.fmtChange) resolveChanges(ed, it.pos, it.pos + n.nodeSize, accept, { kinds: ['paraFormat'], paragraphs: true });
    } else resolveChanges(ed, it.from, it.to, accept, { kinds: [it.kind] });
  }
}

/** Changes at the cursor (or in the selection). */
export function changesAt(state) {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return changeList(state.doc).filter((c) => c.to > from && c.from < to);
  const hit = changeList(state.doc).filter((c) => c.from <= $from.pos && c.to >= $from.pos);
  // a text change under the cursor wins over its paragraph's formatting change
  return hit.some((c) => c.kind !== 'paraFormat') ? hit.filter((c) => c.kind !== 'paraFormat') : hit;
}

export function setTracking(ed, on, author) {
  const s = ed.storage.trackChanges;
  s.enabled = on;
  if (author) s.author = author;
}
