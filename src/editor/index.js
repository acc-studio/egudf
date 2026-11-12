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
import { Pagination } from './pagination.js';
import { AutoCorrect } from './autocorrect.js';
import { Spell } from './spell.js';
import { CollabPeers } from '../collab/peers.js';
import { CommentMark } from '../review/comments.js';
import { Footnote, FootnoteNumbers } from './footnote.js';
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
    Highlight.configure({ multicolor: true }),
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
      handlePaste: (_view, event) => onPaste?.(event) === true,
    },
    onUpdate: ({ editor: e, transaction }) => onUpdate?.(e, transaction),
    onSelectionUpdate: ({ editor: e }) => onSelection?.(e),
    onTransaction: ({ editor: e, transaction }) => { if (!transaction.docChanged && transaction.selectionSet) return; onSelection?.(e); },
  });
  return editor;
}

/** Static HTML for header/footer previews. */
export function staticHTML(blocks) {
  if (!blocks?.length) return '';
  try { return generateHTML({ type: 'doc', content: blocks }, baseExtensions()); } catch { return ''; }
}
