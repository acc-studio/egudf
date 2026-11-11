// Spelling UI: per-tab setup of the Spell extension, the F7 "Yazım denetimi"
// walk-through, dictionary languages, the user dictionary and the spelling
// part of the right-click menu.
import { $, h, esc, modal, menu, toast } from './ui.js';
import { misspellingAt } from './editor/spell.js';

const LANG_NAMES = { en: 'İngilizce', tr: 'Türkçe', 'tr-TR': 'Türkçe', 'en-US': 'İngilizce (ABD)', 'en-GB': 'İngilizce (BK)', de: 'Almanca', 'de-DE': 'Almanca', fr: 'Fransızca', 'fr-FR': 'Fransızca' };
export const langName = (l) => LANG_NAMES[l] || l;

export function spellAvailable() { return !!window.native?.spell?.check; }

/** Connects a tab's editor to the dictionary. */
export function setupSpell(app, tab) {
  const st = tab.editor.storage.udfSpell;
  if (!spellAvailable()) { tab.editor.view.dom.setAttribute('spellcheck', String(app.spell !== false)); return; }
  // our underlines replace Chromium's
  tab.editor.view.dom.setAttribute('spellcheck', 'false');
  st.checkBatch = (words) => native.spell.check(words);
  st.cache = app.spellCache;
  st.skipCaps = app.spellSkipCaps;
  tab.spellIgnore = st.ignore;
  st.onChange = () => { if (tab === app.active) app.scheduleUI?.(); };
  st.enabled = app.spell !== false;
  tab.editor.commands.refreshSpelling();
}

export function applySpellSettings(app) {
  for (const t of app.tabs) {
    const st = t.editor.storage.udfSpell;
    st.enabled = app.spell !== false;
    st.skipCaps = app.spellSkipCaps;
    st.cache = app.spellCache;
    t.editor.commands.refreshSpelling();
  }
}

/** Items for the right-click menu when the click hits an underlined word. */
export async function spellMenuItems(app, ed, p) {
  if (!spellAvailable() || !ed.storage.udfSpell.enabled) return [];
  const hit = ed.view.posAtCoords({ left: p.x, top: p.y });
  const e = hit && misspellingAt(ed, hit.pos);
  if (!e) return [];
  const sugg = ((await native.spell.suggest(e.word)) || []).slice(0, 6);
  const items = sugg.map((s) => ({ html: `<b>${esc(s)}</b>`, onClick: () => replaceWord(ed, e, s) }));
  if (!sugg.length) items.push({ label: 'Öneri yok', disabled: true });
  items.push(
    { label: 'Tümünü yoksay', icon: 'check', onClick: () => ignoreWord(app, e.word) },
    { label: `“${e.word}” sözlüğe ekle`, icon: 'spell', onClick: () => addWord(app, e.word) },
    { label: 'Yazım denetimi…', kbd: 'F7', onClick: () => spellDialog(app) },
    { sep: true },
  );
  return items;
}

function replaceWord(ed, e, s) {
  ed.chain().focus().command(({ tr }) => { tr.insertText(s, e.from, e.to); return true; }).run();
}

export function ignoreWord(app, w) {
  const t = app.tab();
  if (!t) return;
  t.editor.storage.udfSpell.ignore.add(w);
  t.editor.commands.refreshSpelling();
}

export async function addWord(app, w) {
  await native.spell.add(w);
  app.spellCache.set(w, false);
  for (const t of app.tabs) t.editor.commands.refreshSpelling();
  toast(`“${w}” sözlüğe eklendi`, { ms: 1500 });
}

/** Waits until the dictionary has answered for every word on screen. */
export async function settle(st, ms = 3000) {
  const t0 = Date.now();
  while ((st.pending.size || st.inflight) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 40));
}

/** F7: step through misspellings from the cursor, Word style. */
export async function spellDialog(app) {
  const tab = app.tab();
  if (!tab) return;
  const ed = tab.editor;
  const st = ed.storage.udfSpell;
  if (!spellAvailable()) { toast('Yazım denetimi bu sistemde kullanılamıyor.', { type: 'warn' }); return; }
  if (!st.enabled) { app.spell = true; localStorage.setItem('udf.spell', '1'); applySpellSettings(app); }
  ed.commands.refreshSpelling();
  await settle(st);
  const skipped = new Set(); // "Yoksay": this occurrence only (by position, mapped as we go)
  let cur = null;
  const body = h(`<div class="sp-dlg">
    <div class="sp-ctx" id="sp-ctx"></div>
    <div class="field"><label>Değiştir:</label><input type="text" id="sp-to" spellcheck="false"></div>
    <div class="sp-cols"><div class="sp-list" id="sp-list" tabindex="0"></div>
      <div class="sp-btns">
        <button class="btn" data-a="ignore">Yoksay</button>
        <button class="btn" data-a="ignoreAll">Tümünü yoksay</button>
        <button class="btn" data-a="add">Sözlüğe ekle</button>
        <button class="btn primary" data-a="change">Değiştir</button>
        <button class="btn" data-a="changeAll">Tümünü değiştir</button>
      </div></div>
    <p class="note" id="sp-status"></p></div>`);
  const next = (fromPos) => {
    ed.commands.refreshSpelling();
    const list = st.errors.filter((e) => !skipped.has(`${e.from}:${e.word}`));
    if (!list.length) return null;
    return list.find((e) => e.from >= fromPos) || list[0];
  };
  const show = async (e) => {
    cur = e;
    if (!e) {
      $('#sp-ctx', body).innerHTML = '<b>Yazım denetimi tamamlandı.</b> Belgede başka yazım hatası bulunamadı.';
      $('#sp-list', body).innerHTML = '';
      $('#sp-to', body).value = '';
      body.querySelectorAll('.sp-btns button').forEach((b) => { b.disabled = true; });
      $('#sp-status', body).textContent = '';
      return;
    }
    ed.chain().setTextSelection({ from: e.from, to: e.to }).scrollIntoView().run();
    const $p = ed.state.doc.resolve(e.from);
    const para = $p.parent.textContent;
    const off = $p.parentOffset;
    const a = Math.max(0, off - 50), b = Math.min(para.length, off + e.word.length + 50);
    $('#sp-ctx', body).innerHTML = `${a > 0 ? '…' : ''}${esc(para.slice(a, off))}<mark>${esc(para.slice(off, off + e.word.length))}</mark>${esc(para.slice(off + e.word.length, b))}${b < para.length ? '…' : ''}`;
    // until the suggestions arrive, Değiştir must not use the previous word's text
    const btns = [...body.querySelectorAll('[data-a="change"], [data-a="changeAll"]')];
    btns.forEach((x) => { x.disabled = true; });
    $('#sp-to', body).value = e.word;
    $('#sp-list', body).innerHTML = '<div class="dim">Öneriler aranıyor…</div>';
    const sugg = (await native.spell.suggest(e.word)) || [];
    if (cur !== e) return; // moved on meanwhile
    btns.forEach((x) => { x.disabled = false; });
    $('#sp-list', body).innerHTML = sugg.length ? sugg.map((s, i) => `<div class="sp-s ${i ? '' : 'sel'}">${esc(s)}</div>`).join('') : '<div class="dim">(öneri yok)</div>';
    $('#sp-to', body).value = sugg[0] || e.word;
    const n = st.errors.length;
    $('#sp-status', body).textContent = `${n} olası yazım hatası`;
  };
  body.addEventListener('click', async (ev) => {
    const s = ev.target.closest('.sp-s');
    if (s) { body.querySelectorAll('.sp-s').forEach((x) => x.classList.toggle('sel', x === s)); $('#sp-to', body).value = s.textContent; return; }
    const act = ev.target.closest('[data-a]')?.dataset.a;
    if (!act || !cur) return;
    const e = cur;
    const to = $('#sp-to', body).value;
    if (act === 'ignore') { skipped.add(`${e.from}:${e.word}`); await (api.ready = show(next(e.to))); return; }
    if (act === 'ignoreAll') { st.ignore.add(e.word); await (api.ready = show(next(e.from))); return; }
    if (act === 'add') { await native.spell.add(e.word); app.spellCache.set(e.word, false); await (api.ready = show(next(e.from))); return; }
    if (act === 'change') { replaceWord(ed, e, to); await (api.ready = show(next(e.from + to.length))); return; }
    if (act === 'changeAll') {
      const all = st.errors.filter((x) => x.word === e.word).sort((x, y) => y.from - x.from);
      ed.chain().focus().command(({ tr }) => { for (const x of all) tr.insertText(to, x.from, x.to); return true; }).run();
      toast(`${all.length} yer değiştirildi`, { ms: 1500 });
      await (api.ready = show(next(e.from)));
    }
  });
  $('#sp-list', body).addEventListener('dblclick', (ev) => { if (ev.target.closest('.sp-s')) body.querySelector('[data-a="change"]').click(); });
  $('#sp-to', body).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); body.querySelector('[data-a="change"]').click(); } });
  modal({ title: 'Yazım denetimi', icon: 'spell', body, width: 560, actions: [{ label: 'Kapat' }] });
  const first = show(next(ed.state.selection.from));
  const api = { show, next, get current() { return cur; }, body, ready: first };
  app.spellDialogApi = api;
}

export async function spellLangMenu(app, el) {
  const info = await native.spell.langs();
  const avail = info.available || [];
  const cur = new Set(info.current || []);
  const choices = ['tr', 'en'].filter((l) => avail.includes(l));
  const items = [{ header: 'Sözlük dilleri' }];
  for (const l of choices) {
    items.push({ label: `${langName(l)} (${l})`, checked: cur.has(l), onClick: async () => {
      const next = new Set(cur);
      if (next.has(l)) next.delete(l); else next.add(l);
      if (!next.size) { toast('En az bir dil seçili olmalı.', { type: 'warn' }); return; }
      const set = await native.spell.setLangs([...next]);
      localStorage.setItem('udf.spellLangs', JSON.stringify(set));
      app.spellCache.clear();
      applySpellSettings(app);
      app.scheduleUI?.();
    } });
  }
  if (!choices.length) items.push({ label: 'Bu sistemde sözlük dili bulunamadı', disabled: true });
  items.push({ sep: true },
    { label: 'BÜYÜK HARFLİ sözcükleri atla (HMK, İİK)', checked: app.spellSkipCaps, onClick: () => { app.spellSkipCaps = !app.spellSkipCaps; localStorage.setItem('udf.spellCaps', app.spellSkipCaps ? '1' : '0'); applySpellSettings(app); } },
    { label: 'Yazım denetimi açık', checked: app.spell !== false, onClick: () => app.run('spellcheck') },
    { label: 'Kullanıcı sözlüğü…', icon: 'spell', onClick: () => dictionaryDialog(app) });
  menu(el, items);
}

export async function restoreSpellLangs() {
  if (!spellAvailable()) return;
  try {
    const saved = JSON.parse(localStorage.getItem('udf.spellLangs') || 'null');
    if (Array.isArray(saved) && saved.length) await native.spell.setLangs(saved);
  } catch {}
}

export async function dictionaryDialog(app) {
  const words = (await native.spell.words()).sort((a, b) => a.localeCompare(b, 'tr'));
  const body = h(`<div><p class="note" style="margin-top:0">Sözlüğe eklediğiniz sözcükler tüm belgelerde doğru kabul edilir.</p>
    <div class="field" style="display:flex;gap:6px"><input type="text" id="dc-new" placeholder="Yeni sözcük" spellcheck="false" style="flex:1"><button class="btn" id="dc-add">Ekle</button></div>
    <div class="dc-list" id="dc-list"></div></div>`);
  const render = () => {
    $('#dc-list', body).innerHTML = words.length ? words.map((w) => `<div class="dc-w"><span>${esc(w)}</span><button class="icon-btn" data-w="${esc(w)}" title="Sil">×</button></div>`).join('') : '<div class="dim">Sözlük boş.</div>';
  };
  render();
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-w]');
    if (b) { await native.spell.remove(b.dataset.w); words.splice(words.indexOf(b.dataset.w), 1); app.spellCache.delete(b.dataset.w); app.spellCache.clear(); render(); applySpellSettings(app); }
  });
  const add = async () => {
    const w = $('#dc-new', body).value.trim();
    if (!w || words.includes(w)) return;
    await native.spell.add(w);
    words.push(w); words.sort((a, b) => a.localeCompare(b, 'tr'));
    $('#dc-new', body).value = '';
    app.spellCache.set(w, false);
    render();
    applySpellSettings(app);
  };
  $('#dc-add', body).onclick = add;
  $('#dc-new', body).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  modal({ title: 'Kullanıcı sözlüğü', icon: 'spell', body, width: 440, actions: [{ label: 'Kapat', kind: 'primary' }] });
}
