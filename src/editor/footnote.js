// Footnotes (Word). A footnote is an inline atom at its reference mark; its text
// is a small block list in attrs.content (edited in a dialog, not inline). The
// number is not stored: footnotes are numbered in document order by a decoration.
// Pagination reserves room at the bottom of the page that holds the reference and
// the renderer's page overlay draws the footnote text there (as in Word).
// .udf has no footnotes: src/udf/uyapify.js turns them into numbered notes at the end.
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null },
      content: {
        default: [],
        parseHTML: (el) => { try { return JSON.parse(el.dataset.fn || '[]'); } catch { return []; } },
        renderHTML: (a) => ({ 'data-fn': JSON.stringify(a.content || []) }),
      },
    };
  },
  parseHTML() { return [{ tag: 'sup[data-fn]' }]; },
  renderHTML({ HTMLAttributes }) { return ['sup', mergeAttributes(HTMLAttributes, { class: 'udf-fnref' })]; },
});

export const footnoteKey = new PluginKey('footnoteNumbers');

/** Footnotes in document order: [{ pos, node, n }] */
export function footnotesOf(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') out.push({ pos, node, n: out.length + 1 });
    return true;
  });
  return out;
}

export const FootnoteNumbers = Extension.create({
  name: 'footnoteNumbers',
  addProseMirrorPlugins() {
    const build = (doc) => DecorationSet.create(doc, footnotesOf(doc).map((f) => Decoration.node(f.pos, f.pos + 1, { 'data-n': String(f.n) })));
    return [new Plugin({
      key: footnoteKey,
      state: { init: (_, { doc }) => build(doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
      props: { decorations(state) { return footnoteKey.getState(state); } },
    })];
  },
});
