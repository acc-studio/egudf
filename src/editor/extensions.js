// TipTap extensions modelling UYAP documents 1:1: paragraph-level list
// attributes (ListId/NumberType, not nested lists), point-based indents and
// spacing, field runs, inline images, tables with preserved UDF attributes.
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { listLabel } from '../udf/common.js';
import { defaultParaAttrs } from '../udf/codec.js';

const pt = (v) => `${Math.round(v * 100) / 100}pt`;

// ------------------------------------------------------------------ paragraph

export function paraStyle(a) {
  const s = [];
  if (a.align && a.align !== 'left') s.push(`text-align:${a.align}`);
  if (a.leftIndent) s.push(`padding-left:${pt(a.leftIndent)}`);
  if (a.rightIndent) s.push(`padding-right:${pt(a.rightIndent)}`);
  if (a.firstLineIndent) s.push(`text-indent:${pt(a.firstLineIndent)}`);
  if (a.spaceAbove) s.push(`padding-top:${pt(a.spaceAbove)}`);
  if (a.spaceBelow) s.push(`padding-bottom:${pt(a.spaceBelow)}`);
  if (a.lineSpacing) s.push(`--ls:${1 + a.lineSpacing}`);
  // CSS has one tab size per block: use the paragraph's first explicit stop (label columns)
  const stop = parseFloat(String(a.tabSet || '').split(',')[0]);
  if (stop > 0) s.push(`tab-size:${pt(stop - (a.leftIndent || 0) > 6 ? stop - (a.leftIndent || 0) : stop)}`);
  return s.join(';');
}

const PARA_DEFAULTS = defaultParaAttrs();

export const UdfParagraph = Paragraph.extend({
  addAttributes() {
    const attrs = {};
    for (const [k, def] of Object.entries(PARA_DEFAULTS)) {
      attrs[k] = {
        default: def,
        rendered: false,
        parseHTML: (el) => {
          if (el.dataset.p) {
            try { const v = JSON.parse(el.dataset.p)[k]; return v === undefined ? def : v; } catch {}
          }
          if (k === 'align') {
            const a = el.style.textAlign || el.getAttribute('align');
            return ['center', 'right', 'justify'].includes(a) ? a : 'left';
          }
          if (k === 'leftIndent' && el.style.marginLeft) return toPt(el.style.marginLeft);
          if (k === 'firstLineIndent' && el.style.textIndent) return toPt(el.style.textIndent);
          return def;
        },
      };
    }
    return attrs;
  },
  renderHTML({ node }) {
    const a = node.attrs;
    const diff = {};
    for (const k of Object.keys(PARA_DEFAULTS)) if (JSON.stringify(a[k]) !== JSON.stringify(PARA_DEFAULTS[k])) diff[k] = a[k];
    const out = { class: 'udf-p' };
    const style = paraStyle(a);
    if (style) out.style = style;
    if (Object.keys(diff).length) out['data-p'] = JSON.stringify(diff);
    return ['p', out, 0];
  },
});

function toPt(css) {
  const n = parseFloat(css);
  if (!Number.isFinite(n)) return 0;
  if (/px$/.test(css)) return n * 0.75;
  if (/cm$/.test(css)) return n * 28.3465;
  if (/mm$/.test(css)) return n * 2.83465;
  if (/in$/.test(css)) return n * 72;
  return n;
}

// ------------------------------------------------------------------ marks / nodes

/** Carries UDF run metadata (field runs of UYAP templates, unknown attrs). */
export const UdfRun = Mark.create({
  name: 'udfRun',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { tag: { default: 'content' }, extra: { default: {} } };
  },
  parseHTML() {
    return [{ tag: 'span[data-udf-run]', getAttrs: (el) => { try { return JSON.parse(el.dataset.udfRun); } catch { return false; } } }];
  },
  renderHTML({ mark }) {
    const name = mark.attrs.extra?.fieldName;
    return ['span', {
      'data-udf-run': JSON.stringify(mark.attrs),
      class: mark.attrs.tag === 'field' ? 'udf-field' : null,
      title: name ? `Alan: ${name}` : null,
    }, 0];
  },
});

export const UdfImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: null, parseHTML: (el) => numAttr(el.getAttribute('data-w')) ?? (el.width ? el.width * 0.75 : null) },
      height: { default: null, parseHTML: (el) => numAttr(el.getAttribute('data-h')) ?? (el.height ? el.height * 0.75 : null) },
      extra: { default: null, parseHTML: (el) => { try { return JSON.parse(el.dataset.extra || 'null'); } catch { return null; } } },
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    const { src, width, height, extra } = node.attrs;
    const style = [width ? `width:${pt(width)}` : '', height ? `height:${pt(height)}` : ''].filter(Boolean).join(';');
    return ['img', mergeAttributes({ src, style, 'data-w': width, 'data-h': height, 'data-extra': extra ? JSON.stringify(extra) : null, class: 'udf-img' })];
  },
});
const numAttr = (v) => (v == null || v === '' ? null : Number(v));

const udfAttr = {
  udf: {
    default: {},
    rendered: false,
    parseHTML: (el) => { try { return JSON.parse(el.dataset.udf || '{}'); } catch { return {}; } },
  },
};
const withUdf = (ext) => ext.extend({
  addAttributes() { return { ...this.parent?.(), ...udfAttr }; },
  renderHTML(props) {
    const out = this.parent(props);
    const u = props.node.attrs.udf;
    if (u && Object.keys(u).length && Array.isArray(out) && typeof out[1] === 'object') out[1]['data-udf'] = JSON.stringify(u);
    if (props.node.type.name === 'table' && Array.isArray(out) && typeof out[1] === 'object') {
      out[1].class = `${out[1].class || ''} ${(u?.border || 'borderCell') === 'borderNone' ? 'udf-noborder' : ''}`.trim();
    }
    return out;
  },
});
export const UdfTable = withUdf(Table).configure({ resizable: true, cellMinWidth: 24, lastColumnResizable: true });
export const UdfTableRow = withUdf(TableRow);
export const UdfTableCell = withUdf(TableCell).extend({ content: 'block+' });
export { TableHeader };

// ------------------------------------------------------------------ keyboard

export const LegalKeys = Extension.create({
  name: 'legalKeys',
  addKeyboardShortcuts() {
    const ed = this.editor;
    const listPara = () => {
      const { $from } = ed.state.selection;
      return $from.parent.type.name === 'paragraph' && $from.parent.attrs.list ? $from.parent : null;
    };
    return {
      Tab: () => {
        if (ed.isActive('table')) return ed.commands.goToNextCell() || ed.commands.addRowAfter();
        const lp = listPara();
        if (lp && ed.state.selection.$from.parentOffset === 0) return ed.commands.listLevel(1);
        ed.view.dispatch(ed.state.tr.insertText('\t'));
        return true;
      },
      'Shift-Tab': () => {
        if (ed.isActive('table')) return ed.commands.goToPreviousCell();
        if (listPara()) return ed.commands.listLevel(-1);
        return true;
      },
      Enter: () => {
        const lp = listPara();
        if (lp && lp.content.size === 0) return ed.commands.toggleUdfList(lp.attrs.list.kind, lp.attrs.list.type);
        return false;
      },
      Backspace: () => {
        const lp = listPara();
        const { selection } = ed.state;
        if (lp && selection.empty && selection.$from.parentOffset === 0) return ed.commands.toggleUdfList(lp.attrs.list.kind, lp.attrs.list.type);
        return false;
      },
      'Mod-l': () => ed.commands.setParagraphAttrs({ align: 'left' }),
      'Mod-e': () => ed.commands.setParagraphAttrs({ align: 'center' }),
      'Mod-r': () => ed.commands.setParagraphAttrs({ align: 'right' }),
      'Mod-j': () => ed.commands.setParagraphAttrs({ align: 'justify' }),
      'Mod-Shift-.': () => ed.commands.stepFontSize(1),
      'Mod-Shift-,': () => ed.commands.stepFontSize(-1),
    };
  },
});

// ------------------------------------------------------------------ commands

function paragraphsInSelection(state) {
  const out = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph') { out.push({ node, pos }); return false; }
    return true;
  });
  return out;
}

function maxListId(doc) {
  let max = 0;
  doc.descendants((n) => {
    if (n.type.name === 'paragraph' && n.attrs.list) max = Math.max(max, parseInt(n.attrs.list.id, 10) || 0);
  });
  return max;
}

export const UdfCommands = Extension.create({
  name: 'udfCommands',
  addCommands() {
    return {
      setParagraphAttrs: (patch) => ({ tr, state, dispatch }) => {
        const paras = paragraphsInSelection(state);
        if (!paras.length) return false;
        if (dispatch) for (const { node, pos } of paras) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...(typeof patch === 'function' ? patch(node.attrs) : patch) });
        return true;
      },
      toggleUdfList: (kind, type) => ({ tr, state, dispatch }) => {
        const paras = paragraphsInSelection(state);
        if (!paras.length) return false;
        const allSame = paras.every(({ node }) => node.attrs.list?.kind === kind && (!type || node.attrs.list.type === type));
        // continue the list just above when it is of the same kind
        let id = null;
        const $first = state.doc.resolve(paras[0].pos);
        const idx = $first.index();
        if (idx > 0) {
          const prev = $first.parent.child(idx - 1);
          if (prev.type.name === 'paragraph' && prev.attrs.list?.kind === kind) id = prev.attrs.list.id;
        }
        id = id || String(maxListId(state.doc) + 1);
        if (dispatch) {
          for (const { node, pos } of paras) {
            const a = { ...node.attrs };
            if (allSame) {
              a.list = null;
              if (a.leftIndent === 25 * (node.attrs.list?.level || 1)) a.leftIndent = 0;
              if (a.firstLineIndent === -18) a.firstLineIndent = 0;
            } else {
              const level = node.attrs.list?.level || 1;
              a.list = { kind, type: type || (kind === 'number' ? 'NUMBER_TYPE_NUMBER_DOT' : 'BULLET_TYPE_ELLIPSE'), id: node.attrs.list?.kind === kind ? node.attrs.list.id : id, level };
              if (!a.leftIndent) a.leftIndent = 25 * level;
              if (!a.firstLineIndent) a.firstLineIndent = -18;
            }
            tr.setNodeMarkup(pos, undefined, a);
          }
        }
        return true;
      },
      listLevel: (delta) => ({ tr, state, dispatch }) => {
        const paras = paragraphsInSelection(state).filter(({ node }) => node.attrs.list);
        if (!paras.length) return false;
        if (dispatch) {
          for (const { node, pos } of paras) {
            const level = Math.min(9, Math.max(1, node.attrs.list.level + delta));
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, list: { ...node.attrs.list, level }, leftIndent: Math.max(0, node.attrs.leftIndent + 25 * (level - node.attrs.list.level)) });
          }
        }
        return true;
      },
      indent: (delta) => ({ commands }) => commands.setParagraphAttrs((a) => ({ leftIndent: Math.max(0, (a.leftIndent || 0) + delta) })),
      stepFontSize: (dir) => ({ editor, commands }) => {
        const cur = parseFloat(editor.getAttributes('textStyle').fontSize) || 12;
        const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
        const next = dir > 0 ? SIZES.find((s) => s > cur) || cur + 2 : [...SIZES].reverse().find((s) => s < cur) || Math.max(1, cur - 1);
        return commands.setFontSize(`${next}pt`);
      },
      insertTab: () => ({ tr, dispatch }) => { if (dispatch) tr.insertText('\t'); return true; },
    };
  },
});

// ------------------------------------------------------------------ list labels

export const listLabelsKey = new PluginKey('udfListLabels');

export function computeListLabels(doc) {
  const decos = [];
  const counters = new Map(); // listId → number[] per level
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    const l = node.attrs.list;
    if (!l) return false;
    const c = counters.get(l.id) || [];
    const lvl = Math.max(1, l.level || 1);
    c[lvl - 1] = (c[lvl - 1] || 0) + 1;
    c.length = lvl;
    counters.set(l.id, c);
    const label = listLabel(l.kind, l.type, c[lvl - 1]);
    const width = Math.max(14, -(node.attrs.firstLineIndent || 0));
    decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-label': label, style: `--lw:${width}pt` }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export const ListLabels = Extension.create({
  name: 'udfListLabels',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: listLabelsKey,
      state: {
        init: (_, { doc }) => computeListLabels(doc),
        apply: (tr, old) => (tr.docChanged ? computeListLabels(tr.doc) : old),
      },
      props: { decorations(state) { return listLabelsKey.getState(state); } },
    })];
  },
});

// ------------------------------------------------------------------ find & replace

export const searchKey = new PluginKey('udfSearch');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{N}_]';

/**
 * The search as a RegExp over block text, or { error } for an invalid pattern.
 * Without regex, case-insensitive search lowercases both sides with Turkish
 * rules (I/ı, İ/i), which keeps string lengths (and so positions) intact.
 */
export function searchRegex({ query, matchCase = false, wholeWord = false, regex = false }) {
  if (!query) return null;
  let src = regex ? query : escapeRe(matchCase ? query : query.toLocaleLowerCase('tr'));
  if (wholeWord) src = `(?<!${WORD})(?:${src})(?!${WORD})`;
  try { return new RegExp(src, `gu${regex && !matchCase ? 'i' : ''}`); } catch (e) { return { error: e.message }; }
}

export function findMatches(doc, opts) {
  const out = [];
  const re = searchRegex(opts);
  if (!re || re.error) return out;
  const lower = !opts.regex && !opts.matchCase;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // block text with a position map (atoms count as one char; tracked deletions can't match)
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += child.marks.some((m) => m.type.name === 'deletion') ? '\u0000'.repeat(child.text.length) : child.text;
      } else { map.push(pos + 1 + offset); text += '\ufffc'; }
    });
    map.push(pos + node.nodeSize - 1);
    const hay = lower ? text.toLocaleLowerCase('tr') : text;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(hay))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      out.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1, text: text.slice(m.index, m.index + m[0].length) });
    }
    return false;
  });
  return out;
}

/** Replacement text for one match: regex mode expands $1, $& …; plain mode is literal. */
export function replacementFor(opts, match, replacement) {
  if (!opts.regex) return replacement;
  const re = searchRegex({ ...opts, wholeWord: false });
  if (!re || re.error) return replacement;
  re.lastIndex = 0;
  const one = new RegExp(re.source, re.flags.replace('g', ''));
  return match.text.replace(one, replacement);
}

export const Search = Extension.create({
  name: 'udfSearch',
  addStorage() { return { query: '', matchCase: false, wholeWord: false, regex: false, error: null, current: 0, matches: [] }; },
  addCommands() {
    return {
      setSearch: (query, opts = {}) => ({ tr, dispatch, editor }) => {
        const s = editor.storage.udfSearch;
        if (typeof opts === 'boolean') opts = { matchCase: opts };
        s.query = query; s.matchCase = !!opts.matchCase; s.wholeWord = !!opts.wholeWord; s.regex = !!opts.regex;
        const re = searchRegex(s);
        s.error = re?.error || null;
        // start at the first match after the cursor, like Word
        const head = tr.selection.from;
        s.current = Math.max(0, findMatches(tr.doc, s).findIndex((m) => m.from >= head));
        if (dispatch) tr.setMeta(searchKey, { refresh: true });
        return true;
      },
      searchStep: (dir) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.udfSearch;
        if (!s.matches.length) return false;
        s.current = (s.current + dir + s.matches.length) % s.matches.length;
        const m = s.matches[s.current];
        if (dispatch) { tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView(); tr.setMeta(searchKey, { refresh: true }); }
        return true;
      },
      replaceCurrent: (text) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.udfSearch;
        const m = s.matches[s.current];
        if (!m) return false;
        if (dispatch) {
          const rep = replacementFor(s, m, text);
          if (rep) tr.insertText(rep, m.from, m.to); else tr.delete(m.from, m.to);
          // land on the next match
          const end = tr.mapping.map(m.to);
          const next = findMatches(tr.doc, s);
          s.current = Math.max(0, next.findIndex((x) => x.from >= end));
          if (next[s.current]) tr.setSelection(TextSelection.create(tr.doc, next[s.current].from, next[s.current].to)).scrollIntoView();
          tr.setMeta(searchKey, { refresh: true, keepCurrent: true });
        }
        return true;
      },
      replaceAll: (text) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.udfSearch;
        if (!s.matches.length) return false;
        if (dispatch) {
          for (const m of [...s.matches].reverse()) {
            const rep = replacementFor(s, m, text);
            if (rep) tr.insertText(rep, m.from, m.to); else tr.delete(m.from, m.to);
          }
          tr.setMeta(searchKey, { refresh: true });
        }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old, _o, newState) {
          if (!tr.docChanged && !tr.getMeta(searchKey)) return old;
          storage.matches = findMatches(newState.doc, storage);
          if (storage.current >= storage.matches.length) storage.current = 0;
          return DecorationSet.create(newState.doc, storage.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === storage.current ? 'search-hit current' : 'search-hit' })));
        },
      },
      props: { decorations(state) { return searchKey.getState(state); } },
    })];
  },
});
