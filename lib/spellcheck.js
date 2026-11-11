// Spell checking service for the editor (main process): real Hunspell
// compiled to WebAssembly (hunspell-asm) with the bundled Turkish and English
// dictionaries (assets/hunspell). Words are checked in batches over IPC; the
// editor draws its own underlines. A word is correct when any active language
// accepts it. The user dictionary is a plain word list in userData.
//
// Hunspell's Turkish suggestions are weak for everyday typos, so suggest()
// also tries single edits that are common when typing Turkish: ASCII letters
// for Turkish ones (s→ş, i→ı, c→ç…), swapped/missing/doubled letters, and a
// missing space ("birşey" → "bir şey").
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// legal vocabulary the dictionary doesn't know (checked against tr.dic)
const SEED = ['arabuluculuk', 'arabulucu', 'arabulucunun', 'arabuluculuğa', 'talikli', 'mütalaa', 'mütalaası', 'UYAP', 'e-imza', 'e-tebligat', 'KEP', 'Yargıtay', 'Danıştay', 'Anayasa', 'HMK', 'İİK', 'TBK', 'TMK', 'TTK', 'CMK', 'TCK', 'HUMK', 'İYUK'];

const TR_ALPHA = 'abcçdefgğhıijklmnoöprsştuüvyzqwx';
const ASCII_TR = { s: 'ş', S: 'Ş', c: 'ç', C: 'Ç', g: 'ğ', G: 'Ğ', i: 'ı', I: 'İ', o: 'ö', O: 'Ö', u: 'ü', U: 'Ü', ı: 'i', ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u' };

export function createSpellService({ assetsDir, userFile }) {
  let mod = null;
  const engines = {}; // lang → hunspell instance
  let active = ['tr', 'en'];
  let user = new Set();
  let loading = null;

  const readUser = () => {
    try { user = new Set(fs.readFileSync(userFile, 'utf8').split(/\r?\n/).map((w) => w.trim()).filter(Boolean)); } catch { user = new Set(); }
  };
  const writeUser = () => {
    try { fs.mkdirSync(path.dirname(userFile), { recursive: true }); fs.writeFileSync(userFile, [...user].sort((a, b) => a.localeCompare(b, 'tr')).join('\n')); } catch {}
  };

  async function load(lang) {
    if (engines[lang]) return engines[lang];
    if (!mod) {
      const { loadModule } = require('hunspell-asm');
      mod = await loadModule();
    }
    const aff = mod.mountBuffer(fs.readFileSync(path.join(assetsDir, `${lang}.aff`)), `${lang}.aff`);
    const dic = mod.mountBuffer(fs.readFileSync(path.join(assetsDir, `${lang}.dic`)), `${lang}.dic`);
    const hs = mod.create(aff, dic);
    if (lang === 'tr') for (const w of SEED) hs.addWord(w);
    engines[lang] = hs;
    return hs;
  }
  const ready = () => (loading ??= (async () => { readUser(); for (const l of active) await load(l); })());

  const correctIn = (w) => {
    if (user.has(w) || user.has(w.toLocaleLowerCase('tr'))) return true;
    for (const l of active) {
      const hs = engines[l];
      if (!hs) continue;
      if (hs.spell(w)) return true;
      // sentence-initial capital: "Davacının"
      const low = w[0].toLocaleLowerCase(l === 'tr' ? 'tr' : 'en') + w.slice(1);
      if (low !== w && hs.spell(low)) return true;
    }
    return false;
  };

  function edits(w) {
    const out = new Map(); // candidate → rank (lower is better)
    const add = (c, r) => { if (c && c !== w && (!out.has(c) || out.get(c) > r)) out.set(c, r); };
    for (let i = 0; i < w.length; i++) {
      if (ASCII_TR[w[i]]) add(w.slice(0, i) + ASCII_TR[w[i]] + w.slice(i + 1), 0); // Turkish letter
      if (i < w.length - 1) add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 1); // swap
      add(w.slice(0, i) + w.slice(i + 1), 2); // extra letter
      for (const ch of TR_ALPHA) {
        add(w.slice(0, i) + ch + w.slice(i), 2); // missing letter
        add(w.slice(0, i) + ch + w.slice(i + 1), 3); // wrong letter
      }
    }
    for (const ch of TR_ALPHA) add(w + ch, 2);
    return out;
  }

  return {
    ready,
    /** → the misspelled words of `words` */
    async check(words) {
      await ready();
      return (words || []).filter((w) => !correctIn(String(w)));
    },
    async suggest(word) {
      await ready();
      const w = String(word);
      const ranked = new Map();
      const put = (s, r) => { if (!ranked.has(s) || ranked.get(s) > r) ranked.set(s, r); };
      // two words run together
      for (let i = 2; i <= w.length - 2; i++) {
        const a = w.slice(0, i), b = w.slice(i);
        if (correctIn(a) && correctIn(b)) put(`${a} ${b}`, 1.5);
        // and with one ASCII letter fixed ("birsey" → "bir şey")
        for (let j = 0; j < b.length; j++) {
          if (!ASCII_TR[b[j]]) continue;
          const b2 = b.slice(0, j) + ASCII_TR[b[j]] + b.slice(j + 1);
          if (correctIn(a) && correctIn(b2)) put(`${a} ${b2}`, 1.6);
        }
      }
      for (const [c, r] of edits(w)) if (correctIn(c)) put(c, r);
      // two Turkish-letter fixes ("musteri" → "müşteri")
      for (const [c, r] of edits(w)) if (r === 0) for (const [c2, r2] of edits(c)) if (r2 === 0 && correctIn(c2)) put(c2, 0.5);
      let hun = [];
      for (const l of active) { try { hun = hun.concat(engines[l]?.suggest(w) || []); } catch {} }
      hun.forEach((s, i) => put(s, 2.5 + i * 0.1));
      const keepCase = (s) => (w[0] !== w[0].toLocaleLowerCase('tr') ? s[0].toLocaleUpperCase('tr') + s.slice(1) : s);
      return [...ranked.entries()].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).map(([s]) => keepCase(s)).filter((s, i, a) => a.indexOf(s) === i).slice(0, 8);
    },
    async addWord(w) { await ready(); user.add(String(w)); writeUser(); },
    async removeWord(w) { await ready(); user.delete(String(w)); writeUser(); },
    async words() { await ready(); return [...user]; },
    langs: () => ({ available: ['tr', 'en'], current: [...active] }),
    async setLangs(langs) {
      const ok = (langs || []).filter((l) => ['tr', 'en'].includes(l));
      if (ok.length) active = ok;
      for (const l of active) await load(l);
      return [...active];
    },
  };
}
