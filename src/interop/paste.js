// Paste from Word with full formatting.
//
// Word's clipboard carries the selection three ways: HTML, RTF and an OLE
// "Embed Source" object whose "Package" stream is the selection as a complete
// .docx. The package goes through the same importer as opening a .docx, so a
// paste looks exactly like the opened document: styles, lists, tables, images,
// tracked changes and comments.
//
// Partial vs. whole paragraphs: the package always holds whole <w:p>s; the
// plain text ends with a line break only if the last paragraph mark was copied.
import { Fragment, Slice } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { readCfb, isCfb } from './cfb.js';
import { importDocx, isDocx } from './docx.js';

/** HTML written by Word (or Outlook's Word editor). */
export const isWordHtml = (html) => /urn:schemas-microsoft-com:office:word|<meta[^>]+content=["']?Word\.Document/i.test(String(html || '').slice(0, 4000));

/** The .docx inside Word's "Embed Source" clipboard object, or null (Excel, PowerPoint…). */
export function wordPackage(embed) {
  try {
    if (!embed || !isCfb(embed)) return null;
    const pkg = readCfb(embed).get('Package');
    return pkg && isDocx(pkg) ? pkg : null;
  } catch { return null; }
}

/**
 * Inserts a .docx package at the selection.
 * opts: { text (clipboard plain text), base (target doc's base font), review (tab.review, gets the comments) }
 * → { blocks, comments } inserted
 */
export function pasteDocx(editor, pkg, { text = '', base = null, review = null } = {}) {
  const r = importDocx(pkg, { base });
  const blocks = r.doc.content || [];
  if (!blocks.length) return { blocks: 0, comments: 0 };
  const { state } = editor;

  // lists continue their own numbering: give them ids unused in this document
  let maxList = 0;
  state.doc.descendants((n) => { const id = parseInt(n.attrs?.list?.id, 10); if (id > maxList) maxList = id; });
  const listMap = {};
  // comments: fresh ids (the importer's w0, w1… would collide with an earlier paste)
  const stamp = Date.now().toString(36);
  const cMap = {};
  for (const c of r.review?.comments || []) cMap[c.id] = `p${stamp}-${c.id}`;
  const fix = (n) => {
    if (n.attrs?.list) n.attrs.list = { ...n.attrs.list, id: (listMap[n.attrs.list.id] ??= String(++maxList)) };
    if (n.marks) n.marks = n.marks.map((m) => (m.type === 'comment' && cMap[m.attrs?.id] ? { ...m, attrs: { ...m.attrs, id: cMap[m.attrs.id] } } : m));
    (n.content || []).forEach(fix);
  };
  blocks.forEach(fix);
  if (review && r.review?.comments?.length) {
    review.comments ||= [];
    for (const c of r.review.comments) review.comments.push({ ...c, id: cMap[c.id] });
  }

  const schema = editor.schema;
  const frag = Fragment.fromArray(blocks.map((b) => schema.nodeFromJSON(b)));
  const endsWithBreak = /\r?\n$/.test(text);
  const firstP = blocks[0].type === 'paragraph';
  const lastP = blocks[blocks.length - 1].type === 'paragraph';
  const { $from, $to } = state.selection;
  const tr = state.tr;
  const sameParent = $from.depth === $to.depth && $from.sharedDepth($to.pos) >= $from.depth - 1;
  const wholeBlocks = $from.parent.isTextblock && $to.parent.isTextblock && sameParent
    && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
  const inline = blocks.length === 1 && firstP && !endsWithBreak; // a few words: keep the target paragraph
  if (wholeBlocks && !inline) {
    // an empty paragraph, or whole paragraphs selected: they become the pasted ones, formatting and all
    const from = $from.before(), to = $to.after();
    tr.replaceWith(from, to, frag);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, Math.min(tr.doc.content.size, from + frag.size - 1))), -1));
  } else {
    tr.replaceSelection(new Slice(frag, firstP ? 1 : 0, !endsWithBreak && lastP ? 1 : 0));
  }
  tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView();
  editor.view.dispatch(tr);
  return { blocks: blocks.length, comments: r.review?.comments?.length || 0 };
}
