// Editor factory: one TipTap instance per document tab.
import { Editor, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontFamily, FontSize, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {
  UdfParagraph, UdfRun, UdfImage, UdfTable, UdfTableRow, UdfTableCell, TableHeader,
  LegalKeys, UdfCommands, ListLabels, Search, TextEffects,
} from './extensions.js';
import { TabStops } from './tabs.js';
import { Fragment, Slice } from '@tiptap/pm/model';
import { normalizePastedHtml, remapPastedLists } from '../interop/htmlpaste.js';
import { Pagination } from './pagination.js';
import { AutoCorrect } from './autocorrect.js';
import { Spell } from './spell.js';
import { CollabPeers } from '../collab/peers.js';
import { CommentMark } from '../review/comments.js';
import { Footnote, FootnoteNumbers } from './footnote.js';
import { BookmarkMark } from './bookmark.js';
import { InsertionMark, DeletionMark, FormatChangeMark, TrackChanges } from '../review/changes.js';

export function baseExtensions() {
  return [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      hardBreak: { keepMarks: true },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { class: 'udf-link', rel: 'noopener noreferrer', target: null } },
      trailingNode: false,
    }),
    UdfParagraph,
    TextStyle,
    TextEffects,
    FontFamily,
    FontSize,
    Color,
    // pasted spans with a background colour (Word, web) are highlights too
    Highlight.extend({
      parseHTML() {
        return [...(this.parent?.() || []), { tag: 'span', getAttrs: (el) => { const c = el.style.backgroundColor || el.style.background; return c && !/^(transparent|initial|inherit|white|#fff(fff)?|rgba?\(255, 255, 255)/i.test(c) ? { color: c } : false; } }];
      },
    }).configure({ multicolor: true }),
    Subscript,
    Superscript,
    UdfRun,
    UdfImage,
    UdfTable,
    UdfTableRow,
    UdfTableHeader(),
    UdfTableCell,
    UdfCommands,
    ListLabels,
    CommentMark,
    Footnote,
    BookmarkMark,
    InsertionMark,
    DeletionMark,
    FormatChangeMark,
  ];
}

function UdfTableHeader() { return TableHeader; }

/**
 * createEditor({ element, content, getLayout, onLayout, onUpdate, onSelection, onPaste })
 * onPaste(event) → true when it handled the paste itself
 * defaultTab() → default tab stop interval in pt
 */
export function createEditor({ element, content, getLayout, onLayout, onUpdate, onSelection, onPaste, defaultTab, paginate = true }) {
  const editor = new Editor({
    element,
    content,
    extensions: [
      ...baseExtensions(),
      LegalKeys,
      Search,
      TrackChanges,
      AutoCorrect,
      Spell,
      CollabPeers,
      TabStops.configure({ defaultTab: defaultTab || (() => 36) }),
      FootnoteNumbers,
      ...(paginate ? [Pagination.configure({ getLayout, onLayout })] : []),
    ],
    editorProps: {
      attributes: { class: 'udf-doc', spellcheck: 'true', lang: 'tr' },
      handlePaste: (view, event, slice) => onPaste?.(event) === true || pasteIntoEmpty(view, slice),
      // Word / web HTML: lists, class styles, tab stops (see src/interop/htmlpaste.js)
      transformPastedHTML: (html) => normalizePastedHtml(html),
      transformPasted: (slice, view) => remapPastedLists(slice, view.state.doc, Fragment, Slice),
    },
    onUpdate: ({ editor: e, transaction }) => onUpdate?.(e, transaction),
    onSelectionUpdate: ({ editor: e }) => onSelection?.(e),
    onTransaction: ({ editor: e, transaction }) => { if (!transaction.docChanged && transaction.selectionSet) return; onSelection?.(e); },
  });
  return editor;
}

/**
 * Pasting paragraphs into an empty paragraph: they arrive with their own
 * paragraph formatting (list, spacing, tabs…), as in Word. ProseMirror would
 * merge the first one into the empty paragraph and keep the empty one's attributes.
 */
function pasteIntoEmpty(view, slice) {
  const { $from, empty } = view.state.selection;
  const first = slice.content.firstChild;
  if (!empty || !$from.parent.isTextblock || $from.parent.content.size || !first?.isTextblock || slice.openStart === 0) return false;
  const closed = new Slice(slice.content, 0, 0);
  const tr = view.state.tr.replaceRange($from.before(), $from.after(), closed);
  view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
  return true;
}

/** Static HTML for header/footer previews. */
export function staticHTML(blocks) {
  if (!blocks?.length) return '';
  try { return generateHTML({ type: 'doc', content: blocks }, baseExtensions()); } catch { return ''; }
}
