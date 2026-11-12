// Word bookmarks: a mark over the bookmarked text, so internal links ("#name"),
// and Word's cross-references keep their target through a save. Invisible.
// Zero-length bookmarks (Word's own _GoBack…) are not kept.
import { Mark } from '@tiptap/core';

export const BookmarkMark = Mark.create({
  name: 'bookmark',
  inclusive: false,
  excludes: '', // bookmarks overlap freely
  addAttributes() {
    return { name: { default: null, parseHTML: (el) => el.getAttribute('data-bm') } };
  },
  parseHTML() { return [{ tag: 'span[data-bm]' }]; },
  renderHTML({ mark }) { return ['span', { 'data-bm': mark.attrs.name }, 0]; },
});

/** Position of the bookmark `name` in the document, or null. */
export function findBookmark(doc, name) {
  let at = null;
  doc.descendants((n, pos) => {
    if (at != null) return false;
    if (n.isText && n.marks.some((m) => m.type.name === 'bookmark' && m.attrs.name === name)) at = pos;
    return true;
  });
  return at;
}
