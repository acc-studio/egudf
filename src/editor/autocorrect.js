// Writing aids while typing: AutoCorrect replacements (word list), smart
// quotes (Turkish “…” ‘…’), capitalising the first letter of a sentence, and
// "--" → "–". Each can be turned off; options live in editor storage and are
// set by the renderer from the user's settings. Every change is a normal edit,
// so undo reverts it and track changes records it.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const DEFAULT_AUTOCORRECT = {
  '(c)': '©', '(r)': '®', '(tm)': '™', '->': '→', '<-': '←', '...': '…',
  'hmk': 'HMK', 'tmk': 'TMK', 'tbk': 'TBK', 'ttk': 'TTK', 'iik': 'İİK', 'cmk': 'CMK', 'tck': 'TCK', 'hmk\'nın': 'HMK\'nın',
  'yargıtay': 'Yargıtay', 'anayasa': 'Anayasa', 'danıştay': 'Danıştay',
  'teh': 'the', 'vede': 've de', 'yada': 'ya da', 'herşey': 'her şey', 'birşey': 'bir şey', 'hiçbirşey': 'hiçbir şey',
};

export const autocorrectKey = new PluginKey('autocorrect');
const BOUNDARY = /[\s.,;:!?)\]}"'”’»]/;
const isLetter = (c) => /\p{L}/u.test(c);

export const AutoCorrect = Extension.create({
  name: 'autocorrect',
  addStorage() {
    return { enabled: true, quotes: true, capitalize: true, dashes: true, list: { ...DEFAULT_AUTOCORRECT } };
  },
  addProseMirrorPlugins() {
    const st = this.storage;
    return [new Plugin({
      key: autocorrectKey,
      props: {
        handleTextInput(view, from, to, text) {
          if (text.length !== 1 || from !== to) return false;
          const { state } = view;
          const $from = state.doc.resolve(from);
          if (!$from.parent.isTextblock) return false;
          const before = $from.parent.textBetween(0, $from.parentOffset, '\0', '\0');
          const prev = before.slice(-1);
          // smart quotes
          if (st.quotes && (text === '"' || text === "'")) {
            const opening = !prev || /[\s([{—–-]/.test(prev);
            const q = text === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’');
            view.dispatch(state.tr.insertText(q, from, to).scrollIntoView());
            return true;
          }
          // "--" → en dash
          if (st.dashes && text === '-' && prev === '-' && before.slice(-2, -1) !== '-') {
            view.dispatch(state.tr.insertText('–', from - 1, to).scrollIntoView());
            return true;
          }
          // capitalise the first letter of a sentence
          // (decided on the word's second letter, so enumerations like "a)" stay as typed)
          if (st.capitalize && isLetter(text) && isLetter(prev) && prev === prev.toLocaleLowerCase('tr') && prev !== prev.toLocaleUpperCase('tr')) {
            const head = before.slice(0, -1);
            if (!isLetter(head.slice(-1) || ' ') && !/[\d\p{L}][.']?$/u.test(head)) {
              const trimmed = head.replace(/\s+$/, '');
              const startOfPara = head.trim() === '' && !head.includes('\t');
              const afterStop = head !== trimmed && /[.!?]$/.test(trimmed) && !/(^|[\s(])(\p{L}|vb|vs|bkz|md|mad|no|s|Av|Dr|Prof|Doç|Sn|Ltd|Şti|A\.Ş|Tic|San|Dava|Esas|Karar|Md)\.$/u.test(trimmed) && !/\d\.$/.test(trimmed);
              if (startOfPara || afterStop) {
                view.dispatch(state.tr.insertText(prev.toLocaleUpperCase('tr') + text, from - 1, to).scrollIntoView());
                return true;
              }
            }
          }
          // AutoCorrect list: replace the word just finished
          if (st.enabled && BOUNDARY.test(text)) {
            // symbol entries ("...", "(c)", "->") also match at the end of a word
            const sym = Object.keys(st.list).find((k) => !/\p{L}/u.test(k) && k.length > 1 && before.endsWith(k));
            if (sym) {
              view.dispatch(state.tr.insertText(st.list[sym] + text, from - sym.length, to).scrollIntoView());
              return true;
            }
            const m = /(\S+)$/.exec(before);
            if (m) {
              const word = m[1];
              const hit = st.list[word] ?? st.list[word.toLocaleLowerCase('tr')];
              if (hit && hit !== word) {
                // keep a leading capital if the user typed one and the replacement is lower-case
                const rep = word[0] !== word[0].toLocaleLowerCase('tr') && hit[0] === hit[0].toLocaleLowerCase('tr') ? hit[0].toLocaleUpperCase('tr') + hit.slice(1) : hit;
                const start = from - word.length;
                view.dispatch(state.tr.insertText(rep + text, start, to).scrollIntoView());
                return true;
              }
            }
          }
          return false;
        },
      },
    })];
  },
});
