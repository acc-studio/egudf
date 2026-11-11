// Spell checking drawn by the editor (red wavy underline decorations) instead
// of Chromium's own squiggles, so it can follow document rules: "ignore all",
// skipping ALL-CAPS abbreviations (HMK, İİK), words with digits, UYAP field
// values, tracked deletions, and the word still being typed. The dictionary
// itself is Hunspell in the main process: unknown words are sent in batches
// through storage.checkBatch(words) → Promise<misspelled words>; answers are
// cached (shared by all tabs) and the underlines refresh when they arrive.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const spellKey = new PluginKey('udfSpell');

// letters with inner apostrophes/hyphens: "Ankara'da", "ön-inceleme"
const WORD_RE = /[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;

/** The part of a token the dictionary should see ("Ankara'da" → "Ankara"). */
export function stem(token) {
  return token.split(/['’]/)[0];
}

export function skipWord(w, { skipCaps = true } = {}) {
  if (w.length < 2) return true;
  if (skipCaps && w === w.toLocaleUpperCase('tr') && w !== w.toLocaleLowerCase('tr')) return true; // HMK, İİK, TBMM
  if (/\p{Lu}.*\p{Lu}/u.test(w.slice(1)) && /\p{Ll}/u.test(w)) return true; // camelCase, "UYAPDoküman"
  return false;
}

/** [{ from, to, word }] misspellings in doc (ignoring the word at `skipPos`). */
export function findMisspellings(doc, st, skipPos = -1) {
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        const masked = child.marks.some((m) => m.type.name === 'deletion' || (m.type.name === 'udfRun' && m.attrs.tag === 'field'));
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += masked ? ' '.repeat(child.text.length) : child.text;
      } else { map.push(pos + 1 + offset); text += ' '; }
    });
    for (const m of text.matchAll(WORD_RE)) {
      const before = text[m.index - 1] || ' ', after = text[m.index + m[0].length] || ' ';
      // part of an address, number, e-mail or code ("2024/15", "x@y.com", "www.uyap")
      if (/[\d@/\\_.]/.test(before) && before !== '.' ) continue;
      if (/[\d@_]/.test(after) || (after === '.' && /[\p{L}\d]/u.test(text[m.index + m[0].length + 1] || ''))) continue;
      const w = stem(m[0]);
      if (skipWord(w, st)) continue;
      const from = map[m.index], to = map[m.index + w.length - 1] + 1;
      if (skipPos >= from && skipPos <= to) continue;
      if (st.ignore.has(w) || st.ignore.has(w.toLocaleLowerCase('tr'))) continue;
      const bad = st.cache.get(w);
      if (bad === undefined) { st.pending.add(w); continue; }
      if (bad) out.push({ from, to, word: w });
    }
    return false;
  });
  return out;
}

export const Spell = Extension.create({
  name: 'udfSpell',
  addStorage() {
    return { enabled: false, checkBatch: null, ignore: new Set(), cache: new Map(), pending: new Set(), skipCaps: true, errors: [], held: -1, onChange: null };
  },
  addCommands() {
    return {
      refreshSpelling: () => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(spellKey, { refresh: true }).setMeta('addToHistory', false); return true; },
    };
  },
  addProseMirrorPlugins() {
    const st = this.storage;
    const editor = this.editor;
    let timer = null;
    // ask the dictionary about words seen for the first time, then redraw
    const flush = () => {
      if (st.inflight || !st.pending.size || !st.checkBatch) return;
      const words = [...st.pending].filter((w) => !st.cache.has(w));
      st.pending.clear();
      if (!words.length) return;
      st.inflight = true;
      st.checkBatch(words).then((bad) => {
        const b = new Set(bad || []);
        for (const w of words) st.cache.set(w, b.has(w));
      }).catch(() => { for (const w of words) st.cache.set(w, false); }).finally(() => {
        st.inflight = false;
        if (!editor.isDestroyed) editor.commands.refreshSpelling();
      });
    };
    const compute = (state, typing) => {
      if (!st.enabled) { st.errors = []; return DecorationSet.empty; }
      const head = typing && state.selection.empty ? state.selection.head : -1;
      st.errors = findMisspellings(state.doc, st, head);
      st.held = head;
      if (st.pending.size) queueMicrotask(flush);
      st.onChange?.(st.errors);
      return DecorationSet.create(state.doc, st.errors.map((e) => Decoration.inline(e.from, e.to, { class: 'spell-err', 'data-word': e.word })));
    };
    return [new Plugin({
      key: spellKey,
      state: {
        init: (_, state) => (st.enabled ? compute(state, false) : DecorationSet.empty),
        apply(tr, old, _o, state) {
          const meta = tr.getMeta(spellKey);
          if (meta?.refresh) return compute(state, false);
          if (meta?.typingDone) return compute(state, true);
          if (!tr.docChanged) {
            // the word that was being typed is checked once the cursor leaves it
            if (st.held >= 0 && tr.selectionSet && state.selection.head !== st.held) {
              return compute(state, false);
            }
            return old;
          }
          // map the old underlines now, recheck once typing pauses
          return old.map(tr.mapping, tr.doc).remove(old.find(tr.selection.from - 40, tr.selection.to + 40, () => false));
        },
      },
      view(view) {
        return {
          update(v, prev) {
            if (!st.enabled || v.state.doc === prev.doc) return;
            clearTimeout(timer);
            timer = setTimeout(() => { if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta(spellKey, { typingDone: true }).setMeta('addToHistory', false)); }, 450);
          },
          destroy() { clearTimeout(timer); },
        };
      },
      props: { decorations(state) { return spellKey.getState(state); } },
    })];
  },
});

/** Misspelling covering pos, if any. */
export function misspellingAt(ed, pos) {
  return (ed.storage.udfSpell.errors || []).find((e) => pos >= e.from && pos <= e.to) || null;
}
