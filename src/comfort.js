// Everyday-comfort features: theme, context menu, format painter, change case,
// word count, keyboard shortcut reference.
import { esc, menu, modal, toast } from './ui.js';

const native = window.native;

// ------------------------------------------------------------------ theme

export const THEMES = [['system', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']];

export async function setTheme(app, t) {
  app.theme = t;
  await native.setTheme(t);
  app.ui?.();
}

export function themeMenu(app, anchor) {
  menu(anchor, [{ header: 'Tema' }, ...THEMES.map(([k, l]) => ({ label: l, checked: (app.theme || 'system') === k, onClick: () => setTheme(app, k) }))]);
}

// ------------------------------------------------------------------ context menu

const at = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) });

/** Builds the right-click menu from Chromium's context params (spelling, edit flags). */
export function contextMenu(app, p) {
  const ed = app.ed();
  const items = [];
  if (p.misspelledWord) {
    for (const s of p.suggestions) items.push({ html: `<b>${esc(s)}</b>`, onClick: () => native.edit('replaceMisspelling', s) });
    if (!p.suggestions.length) items.push({ html: '<span class="dim">Öneri yok</span>' });
    items.push({ label: `“${p.misspelledWord}” sözlüğe ekle`, icon: 'spell', onClick: () => native.edit('addWord', p.misspelledWord) });
    items.push({ sep: true });
  }
  const inDoc = ed && p.isEditable && ed.view.hasFocus();
  if (p.isEditable) {
    items.push({ label: 'Kes', icon: 'cut', disabled: !p.canCut, kbd: 'Ctrl+X', onClick: () => native.edit('cut') });
    items.push({ label: 'Kopyala', icon: 'copy', disabled: !p.canCopy, kbd: 'Ctrl+C', onClick: () => native.edit('copy') });
    items.push({ label: 'Yapıştır', icon: 'paste', disabled: !p.canPaste, kbd: 'Ctrl+V', onClick: () => native.edit('paste') });
    items.push({ label: 'Biçimlendirmeden yapıştır', disabled: !p.canPaste, kbd: 'Ctrl+Shift+V', onClick: () => native.edit('pasteAndMatchStyle') });
  } else if (p.selectionText) {
    items.push({ label: 'Kopyala', icon: 'copy', onClick: () => native.edit('copy') });
  }
  if (inDoc) {
    for (const extra of app.contextExtras || []) {
      const more = extra(ed, p);
      if (more?.length) items.push({ sep: true }, ...more);
    }
    if (ed.isActive('table')) {
      const t = (arg, label, ic) => ({ label, icon: ic, onClick: () => app.run('table', arg) });
      items.push({ sep: true }, { header: 'Tablo' },
        t('addRowBefore', 'Üste satır ekle', 'rowAdd'), t('addRowAfter', 'Alta satır ekle', 'rowAdd'),
        t('addColumnBefore', 'Sola sütun ekle', 'colAdd'), t('addColumnAfter', 'Sağa sütun ekle', 'colAdd'),
        t('deleteRow', 'Satırı sil', 'rowDel'), t('deleteColumn', 'Sütunu sil', 'colDel'),
        t('mergeCells', 'Hücreleri birleştir', 'merge'), t('deleteTable', 'Tabloyu sil', 'tableDel'),
        { label: 'Satırı seç', icon: 'select', onClick: () => app.run('tableSelect', 'row') },
        { label: 'Sütunu seç', icon: 'select', onClick: () => app.run('tableSelect', 'column') },
        { label: 'Sütunları eşitle', icon: 'distribute', onClick: () => app.run('tableDistribute') },
        { label: 'Sırala…', icon: 'sort', onClick: () => app.run('tableSortMenu', null, at(p.x, p.y)) });
    }
    items.push({ sep: true },
      { label: 'Paragraf…', icon: 'lineSpacing', onClick: () => app.run('paragraphDialog') },
      { label: 'Büyük/küçük harf', icon: 'case', onClick: () => app.run('changeCaseMenu', null, at(p.x, p.y)) });
  }
  if (p.isEditable) items.push({ sep: true }, { label: 'Tümünü seç', kbd: 'Ctrl+A', onClick: () => native.edit('selectAll') });
  while (items.length && items[items.length - 1].sep) items.pop();
  if (items.length) menu(at(p.x, p.y), items);
}

// ------------------------------------------------------------------ format painter

/** Picks up character marks + paragraph layout at the cursor; the next selection receives them. */
export function formatPainter(app, { sticky = false } = {}) {
  const ed = app.ed();
  if (!ed) return;
  if (app.painter) { stopPainter(app); return; }
  const { $from } = ed.state.selection;
  const marks = (ed.state.storedMarks || $from.marks()).filter((m) => m.type.name !== 'udfRun' && !['insertion', 'deletion', 'comment'].includes(m.type.name));
  const p = $from.parent.type.name === 'paragraph' ? $from.parent.attrs : null;
  const para = p ? { align: p.align, leftIndent: p.leftIndent, rightIndent: p.rightIndent, firstLineIndent: p.firstLineIndent, hanging: p.hanging, spaceAbove: p.spaceAbove, spaceBelow: p.spaceBelow, lineSpacing: p.lineSpacing } : null;
  app.painter = { marks, para, sticky };
  document.body.classList.add('painting');
  const dom = ed.view.dom;
  const onUp = () => setTimeout(() => {
    const e = app.ed();
    if (!e || !app.painter) return;
    const { from, to, empty } = e.state.selection;
    if (empty) return;
    const tr = e.state.tr;
    for (const mt of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight']) {
      const t = e.schema.marks[mt];
      if (t) tr.removeMark(from, to, t);
    }
    for (const m of app.painter.marks) tr.addMark(from, to, m);
    if (app.painter.para) {
      e.state.doc.nodesBetween(from, to, (n, pos) => {
        if (n.type.name !== 'paragraph') return true;
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...app.painter.para });
        return false;
      });
    }
    e.view.dispatch(tr);
    if (!app.painter.sticky) stopPainter(app);
  }, 0);
  dom.addEventListener('mouseup', onUp);
  app.painter.off = () => dom.removeEventListener('mouseup', onUp);
  toast(sticky ? 'Biçim boyacısı açık — bitirmek için Esc' : 'Biçimi uygulamak istediğiniz metni seçin', { ms: 2600 });
  app.ui?.();
}

export function stopPainter(app) {
  app.painter?.off?.();
  app.painter = null;
  document.body.classList.remove('painting');
  app.ui?.();
}

// ------------------------------------------------------------------ change case

const lower = (s) => s.toLocaleLowerCase('tr');
const upper = (s) => s.toLocaleUpperCase('tr');
export const CASES = [
  ['sentence', 'Cümle düzeni.', (s, ctx) => { let out = ''; for (const ch of lower(s)) { out += ctx.start && /\p{L}/u.test(ch) ? upper(ch) : ch; if (/\p{L}/u.test(ch)) ctx.start = false; if (/[.!?]/.test(ch)) ctx.start = true; } return out; }],
  ['lower', 'küçük harf', (s) => lower(s)],
  ['upper', 'BÜYÜK HARF', (s) => upper(s)],
  ['title', 'Her Kelimenin İlk Harfi Büyük', (s, ctx) => { let out = ''; for (const ch of s) { const letter = /\p{L}/u.test(ch); out += letter ? (ctx.word ? lower(ch) : upper(ch)) : ch; ctx.word = letter; } return out; }],
  ['toggle', 'bÜYÜK/kÜÇÜK dEĞİŞTİR', (s) => [...s].map((ch) => (ch === upper(ch) ? lower(ch) : upper(ch))).join('')],
];

export function changeCase(ed, kind) {
  const c = CASES.find((x) => x[0] === kind);
  if (!c || !ed) return;
  let { from, to, empty } = ed.state.selection;
  if (empty) { // whole word under the cursor
    const $p = ed.state.selection.$from;
    const text = $p.parent.textContent;
    let a = $p.parentOffset, b = a;
    while (a > 0 && /\p{L}|\p{N}/u.test(text[a - 1])) a--;
    while (b < text.length && /\p{L}|\p{N}/u.test(text[b])) b++;
    if (a === b) return;
    from = $p.start() + a; to = $p.start() + b;
  }
  const tr = ed.state.tr;
  const ctx = { start: true, word: false };
  ed.state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) { if (n.isTextblock) { ctx.start = kind === 'sentence' ? ctx.start : true; ctx.word = false; } return true; }
    const a = Math.max(from, pos), b = Math.min(to, pos + n.nodeSize);
    const seg = n.text.slice(a - pos, b - pos);
    const out = c[2](seg, ctx);
    if (out !== seg) tr.replaceWith(tr.mapping.map(a), tr.mapping.map(b), ed.schema.text(out, n.marks));
    return false;
  });
  if (tr.docChanged) ed.view.dispatch(tr.scrollIntoView());
  ed.commands.focus();
}

export function changeCaseMenu(app, anchor) {
  const ed = app.ed();
  if (!ed) return;
  menu(anchor, CASES.map(([k, l]) => ({ label: l, onClick: () => changeCase(ed, k) })));
}

// ------------------------------------------------------------------ word count

export function textStats(text) {
  const words = (text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
  return { words, chars: text.replace(/\n/g, '').length, charsNoSpace: text.replace(/\s/g, '').length };
}

export function wordCountDialog(app) {
  const tab = app.tab();
  if (!tab) return;
  const ed = tab.editor;
  const doc = ed.state.doc;
  const all = doc.textBetween(0, doc.content.size, '\n', ' ');
  let paras = 0;
  doc.descendants((n) => { if (n.type.name === 'paragraph' && n.textContent.trim()) paras++; });
  const s = textStats(all);
  const { from, to, empty } = ed.state.selection;
  const sel = empty ? null : textStats(doc.textBetween(from, to, '\n', ' '));
  const row = (l, v, sv) => `<div>${l}</div><div>${v.toLocaleString('tr-TR')}</div><div class="dim">${sv == null ? '' : sv.toLocaleString('tr-TR')}</div>`;
  modal({
    title: 'Sözcük sayısı', icon: 'info', width: 420,
    body: `<div class="kv3"><div></div><div class="dim small">Belge</div><div class="dim small">${sel ? 'Seçim' : ''}</div>
      ${row('Sayfa', tab.pages)}${row('Sözcük', s.words, sel?.words)}${row('Karakter (boşluksuz)', s.charsNoSpace, sel?.charsNoSpace)}${row('Karakter (boşluklu)', s.chars, sel?.chars)}${row('Paragraf', paras)}</div>`,
    actions: [{ label: 'Kapat', kind: 'primary' }],
  });
}

// ------------------------------------------------------------------ shortcuts

export const SHORTCUTS = [
  ['Dosya', [['Ctrl+N', 'Yeni belge'], ['Ctrl+O', 'Aç'], ['Ctrl+S', 'Kaydet'], ['Ctrl+Shift+S', 'Farklı kaydet'], ['Ctrl+P', 'Yazdır (egPDF)'], ['Ctrl+W', 'Belgeyi kapat'], ['Ctrl+Tab', 'Sonraki belge']]],
  ['Düzen', [['Ctrl+Z', 'Geri al'], ['Ctrl+Y', 'Yinele'], ['Ctrl+X / C / V', 'Kes / Kopyala / Yapıştır'], ['Ctrl+Shift+V', 'Biçimlendirmeden yapıştır'], ['Ctrl+A', 'Tümünü seç'], ['Ctrl+F', 'Bul'], ['Ctrl+H', 'Değiştir']]],
  ['Biçim', [['Ctrl+B / I / U', 'Kalın / İtalik / Altı çizili'], ['Ctrl+Shift+> / <', 'Yazıyı büyüt / küçült'], ['Ctrl+Shift+C / V', 'Biçimi kopyala / uygula'], ['Shift+F3', 'Büyük/küçük harf değiştir'], ['Ctrl+Space', 'Karakter biçimini temizle'], ['Ctrl+L / E / R / J', 'Sola / Ortala / Sağa / İki yana'], ['Tab / Shift+Tab', 'Liste düzeyi, tablo hücresi']]],
  ['Gözden geçir', [['Ctrl+Alt+M', 'Yorum ekle'], ['Ctrl+Shift+E', 'Değişiklikleri izle aç/kapat']]],
  ['Görünüm', [['Ctrl + / Ctrl −', 'Yakınlaş / uzaklaş'], ['Ctrl+0', '%100'], ['F11', 'Odak modu'], ['F1', 'Bu liste']]],
];

export function shortcutsDialog() {
  modal({
    title: 'Klavye kısayolları', icon: 'key', width: 640,
    body: `<div class="shortcuts">${SHORTCUTS.map(([g, list]) => `<div><h3>${esc(g)}</h3>${list.map(([k, d]) => `<div class="sc"><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>`).join('')}</div>`,
    actions: [{ label: 'Kapat', kind: 'primary' }],
  });
}

