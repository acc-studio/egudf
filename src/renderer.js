// egUDF — renderer: tabs, file pipeline, commands, dialogs, status.
import { createEditor, staticHTML } from './editor/index.js';
import { pageOfPos, paginationKey } from './editor/pagination.js';
import { parseUdfXml, serializeUdfXml, newDocMeta, docText, defaultParaAttrs } from './udf/codec.js';
import { readUdf, writeUdf, strToU8 } from './udf/zip.js';
import { udfXmlToPdf } from './udf/pdf.js';
import { mergeTemplateData } from './udf/template-data.js';
import { TEMPLATES, BLOCKS } from './udf/templates.js';
import { PT_TO_PX, A4, num, NUMBER_TYPES, BULLET_TYPES, base64FromBytes } from './udf/common.js';
import { icon } from './icons.js';
import { $, $$, h, esc, modal, menu, colorMenu, gridMenu, toast, confirmBox, fmtDate, promptBox } from './ui.js';
import { DEFAULT_AUTOCORRECT } from './editor/autocorrect.js';
import { createRibbon, PARA_STYLES } from './ribbon.js';
import { signDialog, signatureInfo, uyapSendFlow, driverSettings } from './signflow.js';
import { commentsAt } from './review/comments.js';
import { readReview, reviewEntries } from './review/store.js';
import { changeList, changesAt, resolveChanges, resolveAll, resolveItems, setTracking } from './review/changes.js';
import { wireReviewPane, renderReview, showPane, addComment, deleteComment, deleteAllComments, stepComment, author } from './review/pane.js';
import { createRuler } from './ruler.js';
import { selectTablePart, distributeColumns, fitColumns, setColumnWidth, currentColumnWidth, sortRows, textToTable, tableToText, cellRect, PX_PER_CM } from './editor/tables.js';
import { exportDocx, importDocx } from './interop/docx.js';
import { contextMenu, formatPainter, stopPainter, changeCase, changeCaseMenu, wordCountDialog, shortcutsDialog, setTheme, themeMenu, THEMES, textStats } from './comfort.js';

const native = window.native;
const CM = 28.3465; // points per cm
const GAP = 18; // px between pages

const app = {
  tabs: [],
  active: null,
  zoom: Math.min(2, Math.max(0.5, parseFloat(localStorage.getItem('udf.zoom')) || 1)),
  lastColor: '#c00000',
  lastHighlight: '#ffff00',
  profile: {},
  ed: () => app.active?.editor || null,
  tab: () => app.active,
  run: (name, arg, el) => runCmd(name, arg, el),
  ui: () => scheduleUI(),
  theme: 'system',
  painter: null,
  contextExtras: [],
};
let seq = 0;
let ribbon;

// ================================================================== tabs

function geometry(meta) {
  const pf = meta.pageFormat || {};
  const land = pf.paperOrientation && pf.paperOrientation !== '1';
  const w = land ? A4.h : A4.w, hh = land ? A4.w : A4.h;
  return {
    pageW: w * PT_TO_PX,
    pageH: hh * PT_TO_PX,
    top: num(pf.topMargin, 56.7) * PT_TO_PX,
    bottom: num(pf.bottomMargin, 56.7) * PT_TO_PX,
    left: num(pf.leftMargin, 70.875) * PT_TO_PX,
    right: num(pf.rightMargin, 70.875) * PT_TO_PX,
    headerOff: num(pf.headerFOffset, 20) * PT_TO_PX,
    footerOff: num(pf.footerFOffset, 20) * PT_TO_PX,
    gap: GAP,
  };
}

function applyGeometry(tab) {
  const g = geometry(tab.meta);
  tab.geom = g;
  const s = tab.sheet.style;
  s.width = `${g.pageW}px`;
  s.fontFamily = `'${tab.meta.base.family}', 'Liberation Serif', 'Times New Roman', serif`;
  s.fontSize = `${tab.meta.base.size}pt`;
  const pm = tab.sheet.querySelector('.udf-doc');
  if (pm) {
    pm.style.paddingTop = `${g.top}px`;
    pm.style.paddingLeft = `${g.left}px`;
    pm.style.paddingRight = `${g.right}px`;
    pm.style.minHeight = `${g.pageH}px`;
  }
  applyZoom(tab);
}

function applyZoom(tab) {
  if (!tab?.sheet) return;
  tab.ruler?.invalidate();
  tab.sheet.style.transform = `scale(${app.zoom})`;
  const box = tab.host.querySelector('.zoom-box');
  box.style.width = `${tab.geom.pageW * app.zoom}px`;
  box.style.height = `${tab.sheet.offsetHeight * app.zoom}px`;
}

function newTab({ title, path = null, doc, meta, original = null, sig = null, review = null }) {
  const host = h(`<div class="doc-host"><div class="zoom-box"><div class="sheet"><div class="page-overlay"></div><div class="mount"></div></div></div></div>`);
  $('#doc-area').append(host);
  const tab = { id: ++seq, title, path, meta, host, sheet: $('.sheet', host), overlay: $('.page-overlay', host), dirty: false, reviewDirty: false, original, sig, review: review || { comments: [] }, pages: 1 };
  tab.geom = geometry(meta);
  tab.editor = createEditor({
    element: $('.mount', host),
    content: doc,
    getLayout: () => ({ pageH: tab.geom.pageH, top: tab.geom.top, bottom: tab.geom.bottom, gap: GAP, sheet: tab.sheet }),
    onLayout: (L) => drawOverlay(tab, L),
    onUpdate: (_e, tr) => onDocChange(tab, tr),
    onSelection: () => { if (tab === app.active) scheduleUI(); },
  });
  if (app.spell === false) tab.editor.view.dom.setAttribute('spellcheck', 'false');
  Object.assign(tab.editor.storage.autocorrect, app.ac);
  tab.ruler = createRuler(app, tab);
  tab.ruler.setVisible(app.showRuler);
  applyGeometry(tab);
  new ResizeObserver(() => applyZoom(tab)).observe(tab.sheet);
  app.tabs.push(tab);
  activate(tab);
  if (path) addRecent(path, title);
  return tab;
}

function activate(tab) {
  app.active = tab;
  for (const t of app.tabs) t.host.classList.toggle('active', t === tab);
  $('#welcome').classList.toggle('hidden', !!tab);
  document.body.classList.toggle('no-doc', !tab);
  renderTabs();
  if (tab) {
    applyZoom(tab);
    tab.editor.commands.repaginate();
    setTimeout(() => tab.editor.commands.focus(), 0);
    document.title = `${tab.title} — egUDF`;
  } else {
    document.title = 'egUDF';
    renderWelcome();
  }
  refreshNav();
  renderReview(app);
  scheduleUI();
}

const isDirty = (t) => t.dirty || t.reviewDirty;

function renderTabs() {
  const el = $('#tabs');
  el.innerHTML = '';
  for (const t of app.tabs) {
    const sigCls = t.sig ? (t.sig.state === 'valid' ? '' : t.sig.state === 'stale' ? 'stale' : 'invalid') : null;
    const b = h(`<div class="tab ${t === app.active ? 'active' : ''}" title="${esc(t.path || t.title)}">
      ${sigCls !== null ? `<span title="${t.sig.state === 'valid' ? 'İmzalı' : 'İmza geçersiz'}">${icon('verify', `tab-sig ${sigCls}`)}</span>` : ''}
      <span class="tab-title">${esc(t.title)}</span>${isDirty(t) ? '<span class="tab-dirty">●</span>' : ''}
      <button class="tab-close" title="Kapat (Ctrl+W)">✕</button></div>`);
    b.onmousedown = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } };
    b.onclick = (e) => { if (e.target.closest('.tab-close')) closeTab(t); else activate(t); };
    el.append(b);
  }
}

async function closeTab(tab) {
  if (isDirty(tab)) {
    const r = await confirmBox({ title: 'Kaydedilmemiş değişiklikler', text: `<b>${esc(tab.title)}</b> belgesindeki değişiklikler kaydedilsin mi?`, ok: 'Kaydet', cancel: 'İptal', extra: { label: 'Kaydetme', value: 'discard', kind: 'danger' } });
    if (r === false || r === null) return false;
    if (r === true && !(await save(tab))) return false;
  }
  native.recovery.remove(recoveryKey(tab));
  tab.editor.destroy();
  tab.host.remove();
  const i = app.tabs.indexOf(tab);
  app.tabs.splice(i, 1);
  activate(app.tabs[Math.min(i, app.tabs.length - 1)] || null);
  return true;
}

// ================================================================== page overlay

function drawOverlay(tab, L) {
  const g = tab.geom;
  const hdr = tab.meta.header, ftr = tab.meta.footer;
  const startPage = num(hdr?.attrs?.startPage, 1);
  const pageNo = !!ftr?.attrs?.['pageNumber-spec'];
  const sep = ftr?.attrs?.['pageNumber-seperator'] || '/';
  const hHtml = hdr ? (tab._hHtml ??= staticHTML(hdr.content)) : '';
  const fHtml = ftr ? (tab._fHtml ??= staticHTML(ftr.content)) : '';
  const tops = [0], bottoms = [];
  for (const s of L.spacers) {
    const bottom = s.y + s.fill + g.bottom;
    bottoms.push(bottom);
    tops.push(bottom + GAP);
  }
  bottoms.push(tab.sheet.offsetHeight);
  const n = tops.length;
  let html = '';
  for (let i = 0; i < n; i++) {
    if (i < n - 1) html += `<div class="pg-band" style="top:${bottoms[i]}px;height:${GAP}px"></div>`;
    if (hdr && i + 1 >= startPage) html += `<div class="pg-header" style="top:${tops[i] + g.headerOff}px;left:${g.left}px;right:${g.right}px">${hHtml}</div>`;
    if (ftr && fHtml) html += `<div class="pg-footer" style="top:${bottoms[i] - g.footerOff - (pageNo ? 16 : 0)}px;left:${g.left}px;right:${g.right}px">${fHtml}</div>`;
    if (pageNo) html += `<div class="pg-num" style="top:${bottoms[i] - g.footerOff}px;right:${g.right}px">${i + 1} ${esc(sep)} ${n}</div>`;
  }
  tab.overlay.innerHTML = html;
  tab.pages = n;
  if (tab === app.active) scheduleUI();
}

// ================================================================== documents

function onDocChange(tab, tr) {
  tab.rev = (tab.rev || 0) + 1;
  if (tr?.getMeta('reviewOnly')) { // comment anchors only: content.xml (and a signature) unaffected
    if (!tab.reviewDirty) { tab.reviewDirty = true; renderTabs(); }
    renderReview(app);
    return;
  }
  if (!tab.dirty) { tab.dirty = true; renderTabs(); }
  if (tab.sig?.state === 'valid') {
    tab.sig.state = 'stale';
    renderTabs();
    toast('Belge imzadan sonra değişti: kaydederken mevcut imza kaldırılacak. Göndermeden önce yeniden imzalayın.', { type: 'warn', ms: 6500 });
  }
  scheduleNav();
  scheduleReview();
  scheduleUI();
}

let reviewTimer = null;
function scheduleReview() { clearTimeout(reviewTimer); reviewTimer = setTimeout(() => renderReview(app), 200); }

const baseName = (p) => p.split(/[\\/]/).pop().replace(/\.udf$/i, '');

async function openPath(path) {
  const existing = app.tabs.find((t) => t.path && t.path.toLowerCase() === path.toLowerCase());
  if (existing) { activate(existing); return existing; }
  if (/\.docx$/i.test(path)) return openDocx(path);
  try {
    const bytes = await native.readFile(path);
    return await openBytes(bytes, { path, title: baseName(path) });
  } catch (e) {
    toast(`Açılamadı: ${e.message || e}`, { type: 'bad' });
    removeRecent(path);
    return null;
  }
}

/** Word → new unsaved UDF tab (Save asks for a .udf name next to the original). */
async function openDocx(path, bytes = null) {
  try {
    const r = importDocx(bytes || await native.readFile(path));
    const title = path ? path.split(/[\\/]/).pop().replace(/\.docx$/i, '') : 'Word belgesi';
    const tab = newTab({ title, doc: r.doc, meta: r.meta, review: r.review });
    tab.dirty = true;
    tab.importedFrom = path;
    renderTabs();
    if (r.review.comments.length || changeList(tab.editor.state.doc).length) showPane(app, true);
    toast('Word belgesi içe aktarıldı. UYAP için .udf olarak kaydedin.', { type: 'ok', ms: 5000 });
    return tab;
  } catch (e) {
    toast(`Word belgesi açılamadı: ${e.message || e}`, { type: 'bad' });
    return null;
  }
}

async function openBytes(bytes, { path, title }) {
  const u = readUdf(bytes);
  // UYAP-generated forms (takip talebi…) may hold placeholders + a <data> payload: show them merged.
  const parsed = parseUdfXml(mergeTemplateData(u.contentText).xml);
  const { meta } = parsed;
  let { doc } = parsed;
  const review = await readReview(u.other, u.contentXml);
  if (review?.doc) doc = review.doc;
  let sig = null;
  if (u.sign) {
    const v = await native.sign.verify({ sign: u.sign, content: u.contentXml });
    sig = { state: v.ok && v.valid ? 'valid' : 'invalid', info: v.ok ? v : { error: v.error } };
  }
  const tab = newTab({ title, path, doc, meta, original: { contentXml: u.contentXml, docProps: u.docProps, sign: u.sign, bytes }, sig, review: review ? { comments: review.comments, tracking: review.tracking } : null });
  if (review?.tracking) setTracking(tab.editor, true, author(app));
  if (review?.stale) toast('Belge egUDF dışında değiştirilmiş: yorum ve değişiklik işaretleri metne bağlanamadı.', { type: 'warn', ms: 6000 });
  if (review?.comments.length || changeList(tab.editor.state.doc).length) showPane(app, true);
  if (sig?.state === 'valid') toast(`İmzalı belge · ${sig.info.signer?.subjectCN || ''} · ${fmtDate(sig.info.signingTime)}`, { type: 'ok' });
  if (sig?.state === 'invalid') toast('Belgedeki imza doğrulanamadı.', { type: 'bad', actions: [{ label: 'Ayrıntı', onClick: () => signatureInfo(app, tab) }] });
  return tab;
}

function newDocument(templateId = 'blank') {
  const tpl = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0];
  const meta = newDocMeta();
  const n = app.tabs.filter((t) => !t.path).length + 1;
  const tab = newTab({ title: tpl.id === 'blank' ? `Belge ${n}` : `${tpl.name} ${n}`, doc: { type: 'doc', content: tpl.build(app.profile) }, meta });
  return tab;
}

/** content.xml bytes for the tab: untouched original if unchanged, else freshly serialized. */
function contentBytes(tab) {
  if (!tab.dirty && tab.original?.contentXml) return tab.original.contentXml;
  return strToU8(serializeUdfXml(tab.editor.getJSON(), tab.meta));
}

async function save(tab, { as = false } = {}) {
  if (!tab) return false;
  let path = tab.path;
  if (!path || as) {
    path = await native.saveDialog({ defaultPath: `${tab.path ? tab.path.replace(/[^\\/]*$/, '') : tab.importedFrom ? tab.importedFrom.replace(/[^\\/]*$/, '') : ''}${tab.title}.udf`, kind: 'udf' });
    if (!path) return false;
  }
  let bytes;
  const docJson = tab.editor.getJSON();
  if (!tab.dirty && !tab.reviewDirty && tab.original?.bytes) {
    bytes = tab.original.bytes; // unchanged: keep the file byte-for-byte (signature intact)
  } else if (!tab.dirty && tab.original?.contentXml) {
    // only comments changed: same content.xml, same signature, new review entry
    const o = tab.original;
    bytes = writeUdf({ contentXml: o.contentXml, sign: o.sign, docProps: o.docProps, extra: await reviewEntries(tab, docJson, o.contentXml) });
    tab.original = { ...o, bytes };
  } else {
    const xml = contentBytes(tab);
    bytes = writeUdf({ contentXml: xml, extra: await reviewEntries(tab, docJson, xml) });
    tab.original = { contentXml: xml, bytes };
    if (tab.sig) tab.sig = null; // old signature no longer matches
  }
  tab.reviewDirty = false;
  await native.writeFile(path, bytes);
  native.recovery.remove(recoveryKey(tab));
  tab._autoRev = tab.rev;
  tab.path = path;
  tab.title = baseName(path);
  tab.dirty = false;
  addRecent(path, tab.title);
  renderTabs();
  scheduleUI();
  toast(`Kaydedildi: ${tab.title}.udf`, { type: 'ok', ms: 2200 });
  return true;
}

/** Called by the sign dialog. Signs content.xml on the card and writes the signed .udf. */
app.signTab = async (tab, req) => {
  let path = tab.path;
  if (!path) {
    path = await native.saveDialog({ defaultPath: `${tab.title}.udf`, kind: 'udf' });
    if (!path) return { error: 'Kaydetme iptal edildi.' };
  }
  const xml = contentBytes(tab);
  const r = await native.sign.sign({ ...req, content: xml });
  if (!r.ok) return { error: r.error };
  const bytes = writeUdf({ contentXml: xml, sign: r.sgn });
  await native.writeFile(path, bytes);
  tab.path = path;
  tab.title = baseName(path);
  tab.dirty = false;
  tab.original = { contentXml: xml, sign: r.sgn, bytes };
  tab.sig = { state: 'valid', info: r.verification };
  stripReview(tab); // the signed file carries no review data
  addRecent(path, tab.title);
  renderTabs();
  scheduleUI();
  toast(`İmzalandı ve kaydedildi · ${r.signer.subjectCN}`, { type: 'ok', actions: [{ label: 'UYAP\'a gönder', onClick: () => uyapSendFlow(app, tab) }] });
  return { ok: true };
};

/** Removes comments (marks + threads) after signing: the filed document is final. */
function stripReview(tab) {
  if (!tab.review?.comments.length) return;
  const ed = tab.editor;
  const tr = ed.state.tr.removeMark(0, ed.state.doc.content.size, ed.schema.marks.comment).setMeta('reviewOnly', true).setMeta('addToHistory', false);
  ed.view.dispatch(tr);
  tab.review.comments = [];
  tab.reviewDirty = false;
  renderReview(app);
}

async function loadFont(name) { return native.bundledFont(name); }

async function makePdf(tab) {
  const xml = mergeTemplateData(new TextDecoder().decode(contentBytes(tab))).xml;
  return udfXmlToPdf(xml, loadFont, { title: tab.title });
}

// ================================================================== recent

function recents() { try { return JSON.parse(localStorage.getItem('udf.recent') || '[]'); } catch { return []; } }
function addRecent(path, title) {
  const list = recents().filter((r) => r.path.toLowerCase() !== path.toLowerCase());
  list.unshift({ path, title, at: Date.now() });
  localStorage.setItem('udf.recent', JSON.stringify(list.slice(0, 15)));
}
function removeRecent(path) { localStorage.setItem('udf.recent', JSON.stringify(recents().filter((r) => r.path !== path))); }

// ================================================================== welcome / backstage

function tplCard(t) {
  const lines = t.id === 'blank' ? '' : '<i class="c"></i><i></i><i class="s"></i><i></i><i></i><i class="s"></i><i></i><i></i><i></i><i class="s"></i>';
  return `<div class="tpl" data-tpl="${t.id}"><div class="thumb"><div class="page">${lines}</div></div><div class="meta"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></div></div>`;
}

function recentHtml() {
  const list = recents();
  if (!list.length) return '<div class="nav-empty">Henüz açılmış belge yok.</div>';
  return `<div class="recent">${list.map((r) => `<div class="recent-item" data-path="${esc(r.path)}">${icon('page')}<div style="min-width:0"><div>${esc(r.title)}</div><div class="p">${esc(r.path)}</div></div><span class="when">${fmtDate(new Date(r.at).toISOString())}</span></div>`).join('')}</div>`;
}

function wireStart(root, after) {
  root.querySelectorAll('[data-tpl]').forEach((el) => { el.onclick = () => { after?.(); newDocument(el.dataset.tpl); }; });
  root.querySelectorAll('[data-path]').forEach((el) => { el.onclick = () => { after?.(); openPath(el.dataset.path); }; });
  root.querySelector('[data-act=open]')?.addEventListener('click', () => { after?.(); runCmd('open'); });
}

async function renderUserTemplates(el, after) {
  const list = await native.templates.list();
  if (!list.length) { el.innerHTML = '<h2>Şablonlarım</h2><div class="nav-empty">Bir belgeyi Ekle → Şablon olarak kaydet ile buraya ekleyin.</div>'; return; }
  el.innerHTML = `<h2>Şablonlarım</h2><div class="tpl-grid">${list.map((t) => `<div class="tpl user-tpl" data-utpl="${esc(t.id)}"><div class="thumb"><div class="page"><i class="c"></i><i></i><i class="s"></i><i></i><i></i></div></div><div class="meta"><b>${esc(t.name)}</b><span>${esc(fmtDate(t.at, false))}</span></div><button class="tpl-del icon-btn" title="Şablonu sil">${icon('close')}</button></div>`).join('')}</div>`;
  el.onclick = async (e) => {
    const card = e.target.closest('[data-utpl]');
    if (!card) return;
    const t = list.find((x) => x.id === card.dataset.utpl);
    if (e.target.closest('.tpl-del')) {
      if (await confirmBox({ title: 'Şablonu sil', text: `"${esc(t.name)}" şablonu silinsin mi?`, ok: 'Sil', kind: 'danger' })) { await native.templates.remove(t.id); renderUserTemplates(el, after); }
      return;
    }
    after?.();
    newTab({ title: t.name, doc: t.doc, meta: JSON.parse(JSON.stringify(t.meta)) });
  };
}

function renderWelcome() {
  const w = $('#welcome');
  w.innerHTML = `<div class="bs-main">
    <div class="welcome-hero"><div class="logo">${icon('sign')}</div><div><h1>egUDF</h1><div class="bs-sub" style="margin:0">UYAP belgelerini açın, düzenleyin, e-imzalayın ve gönderin — UYAP Editörü olmadan.</div></div></div>
    <h2>Yeni</h2><div class="tpl-grid">${TEMPLATES.map(tplCard).join('')}</div><div id="welcome-utpl"></div>
    <h2 style="display:flex;align-items:center;gap:12px">Son kullanılanlar <button class="btn" data-act="open">${icon('open')}Aç…</button></h2>
    ${recentHtml()}
    <div class="drop-hint">.udf veya Word (.docx) dosyalarını buraya sürükleyip bırakın</div>
  </div>`;
  wireStart(w);
  renderUserTemplates($('#welcome-utpl', w)).then(() => { const e = $('#welcome-utpl', w); if (e && !e.querySelector('.tpl')) e.innerHTML = ''; });
}

function backstage(section = 'new') {
  const bs = $('#backstage');
  const close = () => bs.classList.add('hidden');
  const t = app.active;
  const items = [
    ['new', 'new', 'Yeni'], ['open', 'open', 'Aç'], ['save', 'save', 'Kaydet'], ['saveAs', 'saveAs', 'Farklı kaydet'],
    ['exportPdf', 'pdf', 'PDF olarak kaydet'], ['exportDocx', 'word', 'Word olarak kaydet'], ['print', 'print', 'Yazdır (egPDF)'], ['sign', 'sign', 'İmzala'], ['uyapSend', 'upload', 'UYAP\'a gönder'],
    ['info', 'info', 'Bilgi'], ['profile', 'user', 'Avukat bilgilerim'],
  ];
  bs.innerHTML = `<div class="bs-side"><button class="back">← Geri</button>${items.map(([k, ic, l]) => `<button data-bs="${k}" class="${k === section ? 'active' : ''}">${icon(ic)}${l}</button>`).join('')}</div><div class="bs-main"></div>`;
  const main = $('.bs-main', bs);
  const showSection = (k) => {
    $$('[data-bs]', bs).forEach((b) => b.classList.toggle('active', b.dataset.bs === k));
    if (k === 'new') {
      main.innerHTML = `<h1>Yeni belge</h1><div class="bs-sub">Bir şablonla başlayın. Köşeli parantezli alanlar doldurulacak yerlerdir (Gezinti → Doldurulacak).</div><div class="tpl-grid">${TEMPLATES.map(tplCard).join('')}</div><div id="user-tpls"></div>`;
      renderUserTemplates($('#user-tpls', main), close);
    } else if (k === 'open') {
      main.innerHTML = `<h1>Aç</h1><div class="bs-sub"><button class="btn primary" data-act="open">${icon('open')}Gözat…</button></div><h2>Son kullanılanlar</h2>${recentHtml()}`;
    } else if (k === 'info') {
      main.innerHTML = t ? `<h1>${esc(t.title)}</h1><div class="kv" style="max-width:640px;margin-top:18px">
        <div>Konum</div><div>${esc(t.path || 'Kaydedilmedi')}</div>
        <div>Sayfa</div><div>${t.pages}</div>
        <div>Kelime</div><div>${wordCount(t).toLocaleString('tr-TR')}</div>
        <div>Biçim</div><div>UYAP Doküman (format_id ${esc(t.meta.formatId)})</div>
        <div>İmza</div><div>${t.sig ? (t.sig.state === 'valid' ? `İmzalı — ${esc(t.sig.info?.signer?.subjectCN || '')}` : 'İmza geçersiz / eski') : 'İmzasız'}</div>
        <div>UYAP doğrulama</div><div>${t.original?.docProps ? 'Belgede UYAP doğrulama bilgisi var' : '—'}</div>
      </div>` : '<h1>Bilgi</h1><div class="bs-sub">Açık belge yok.</div>';
    } else {
      close();
      runCmd(k);
      return;
    }
    wireStart(main, close);
  };
  bs.onclick = (e) => {
    if (e.target.closest('.back')) { close(); return; }
    const b = e.target.closest('[data-bs]');
    if (b) showSection(b.dataset.bs);
  };
  showSection(section);
  bs.classList.remove('hidden');
}

// ================================================================== dialogs

async function pageSetup(tab) {
  const pf = tab.meta.pageFormat;
  const cm = (v) => (num(v) / CM).toFixed(2);
  const body = h(`<div>
    <div class="field-row">
      <div class="field"><label>Üst (cm)</label><input type="number" step="0.1" min="0" id="ps-t" value="${cm(pf.topMargin)}"></div>
      <div class="field"><label>Alt (cm)</label><input type="number" step="0.1" min="0" id="ps-b" value="${cm(pf.bottomMargin)}"></div>
      <div class="field"><label>Sol (cm)</label><input type="number" step="0.1" min="0" id="ps-l" value="${cm(pf.leftMargin)}"></div>
      <div class="field"><label>Sağ (cm)</label><input type="number" step="0.1" min="0" id="ps-r" value="${cm(pf.rightMargin)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Yönlendirme</label><select id="ps-o"><option value="1">Dikey</option><option value="0">Yatay</option></select></div>
      <div class="field"><label>Üst bilgi uzaklığı (cm)</label><input type="number" step="0.1" min="0" id="ps-h" value="${cm(pf.headerFOffset)}"></div>
      <div class="field"><label>Alt bilgi uzaklığı (cm)</label><input type="number" step="0.1" min="0" id="ps-f" value="${cm(pf.footerFOffset)}"></div>
    </div>
    <p class="note">Kağıt boyutu: A4 (UYAP).</p></div>`);
  $('#ps-o', body).value = pf.paperOrientation === '1' || !pf.paperOrientation ? '1' : '0';
  modal({
    title: 'Sayfa yapısı', icon: 'page', body, width: 560,
    actions: [{ label: 'İptal' }, { label: 'Uygula', kind: 'primary', onClick: () => {
      const v = (id) => String(Math.max(0, parseFloat($(id, body).value) || 0) * CM);
      setPageFormat(tab, { topMargin: v('#ps-t'), bottomMargin: v('#ps-b'), leftMargin: v('#ps-l'), rightMargin: v('#ps-r'), headerFOffset: v('#ps-h'), footerFOffset: v('#ps-f'), paperOrientation: $('#ps-o', body).value });
    } }],
  });
}

function setPageFormat(tab, patch) {
  tab.meta.pageFormat = { ...tab.meta.pageFormat, ...patch };
  applyGeometry(tab);
  tab.editor.commands.repaginate();
  markMetaDirty(tab);
}

function markMetaDirty(tab) {
  tab._hHtml = undefined;
  tab._fHtml = undefined;
  onDocChange(tab);
  tab.editor.commands.repaginate();
}

function headerFooterDialog(tab) {
  const body = h(`<div>
    <div class="field"><label>Üst bilgi</label><div class="mini-editor" id="hf-h"></div></div>
    <div class="field"><label><input type="checkbox" id="hf-first"> İlk sayfada üst bilgi gösterme</label></div>
    <div class="field"><label>Alt bilgi</label><div class="mini-editor" id="hf-f"></div></div>
    <div class="field"><label><input type="checkbox" id="hf-num"> Sayfa numarası (1 / N) ekle</label></div>
    <p class="note">Ctrl+B / Ctrl+I / Ctrl+E (ortala) / Ctrl+R (sağa) kısayolları burada da çalışır.</p></div>`);
  const mk = (el, blocks) => createEditor({ element: el, content: { type: 'doc', content: blocks?.length ? blocks : [{ type: 'paragraph', attrs: defaultParaAttrs() }] }, paginate: false });
  const he = mk($('#hf-h', body), tab.meta.header?.content);
  const fe = mk($('#hf-f', body), tab.meta.footer?.content);
  $('#hf-first', body).checked = num(tab.meta.header?.attrs?.startPage, 1) > 1;
  $('#hf-num', body).checked = !!tab.meta.footer?.attrs?.['pageNumber-spec'];
  const isEmpty = (ed) => !ed.getText().trim() && !ed.getJSON().content?.some((b) => b.type !== 'paragraph');
  modal({
    title: 'Üst ve alt bilgi', icon: 'header', body, width: 620,
    onClose: () => { he.destroy(); fe.destroy(); },
    actions: [{ label: 'İptal' }, { label: 'Uygula', kind: 'primary', onClick: () => {
      const hEmpty = isEmpty(he), fEmpty = isEmpty(fe), num_ = $('#hf-num', body).checked;
      tab.meta.header = hEmpty ? null : { attrs: { background: '-1', foreground: '-8355712', ...(tab.meta.header?.attrs || {}), startPage: $('#hf-first', body).checked ? '2' : '1' }, content: he.getJSON().content };
      if (fEmpty && !num_) tab.meta.footer = null;
      else {
        const attrs = { background: '-1', foreground: '-8355712', ...(tab.meta.footer?.attrs || {}) };
        if (num_) Object.assign(attrs, { 'pageNumber-spec': attrs['pageNumber-spec'] || 'BSP32_72', 'pageNumber-fontFace': 'Arial', 'pageNumber-fontSize': '11', 'pageNumber-fontBold': 'false', 'pageNumber-fontItalic': 'false', 'pageNumber-color': '-16777216', 'pageNumber-seperator': '/', 'pageNumber-foreStr': '', 'pageNumber-pageStartNumStr': '' });
        else for (const k of Object.keys(attrs)) if (k.startsWith('pageNumber-')) delete attrs[k];
        tab.meta.footer = { attrs, content: fEmpty ? [{ type: 'paragraph', attrs: defaultParaAttrs() }] : fe.getJSON().content };
      }
      markMetaDirty(tab);
    } }],
  });
}

function togglePageNumbers(tab) {
  const f = tab.meta.footer;
  if (f?.attrs?.['pageNumber-spec']) {
    for (const k of Object.keys(f.attrs)) if (k.startsWith('pageNumber-')) delete f.attrs[k];
    if (!f.content?.some((b) => b.content?.length)) tab.meta.footer = null;
  } else {
    tab.meta.footer = { attrs: { background: '-1', foreground: '-8355712', ...(f?.attrs || {}), 'pageNumber-spec': 'BSP32_72', 'pageNumber-fontFace': 'Arial', 'pageNumber-fontSize': '11', 'pageNumber-fontBold': 'false', 'pageNumber-fontItalic': 'false', 'pageNumber-color': '-16777216', 'pageNumber-seperator': '/', 'pageNumber-foreStr': '', 'pageNumber-pageStartNumStr': '' }, content: f?.content || [{ type: 'paragraph', attrs: defaultParaAttrs() }] };
  }
  markMetaDirty(tab);
}

async function profileDialog() {
  const s = await native.settings.get();
  const p = s.profile || {};
  const body = h(`<div>
    <p class="note" style="margin-top:0">Şablonlar ve hazır bloklar bu bilgileri kullanır. Yalnızca bu bilgisayarda saklanır.</p>
    <div class="field"><label>Ad Soyad</label><input type="text" id="pf-name" value="${esc(p.name || '')}" placeholder="Ör. Ayşe Yılmaz"></div>
    <div class="field"><label>Baro ve sicil no</label><input type="text" id="pf-bar" value="${esc(p.bar || '')}" placeholder="Ör. İstanbul Barosu, Sicil No: 12345"></div>
    <div class="field"><label>Büro adresi</label><textarea id="pf-addr">${esc(p.address || '')}</textarea></div></div>`);
  modal({
    title: 'Avukat bilgilerim', icon: 'user', body, width: 520,
    actions: [{ label: 'İptal' }, { label: 'Kaydet', kind: 'primary', onClick: async () => {
      app.profile = { name: $('#pf-name', body).value.trim(), bar: $('#pf-bar', body).value.trim(), address: $('#pf-addr', body).value.trim() };
      await native.settings.set({ profile: app.profile });
      toast('Kaydedildi', { type: 'ok', ms: 1800 });
    } }],
  });
}

async function uyapSettings() {
  const s = await native.settings.get();
  const body = h(`<div><div class="field"><label>Avukat Portal adresi</label><select id="us-url">
    <option value="https://avukatbeta.uyap.gov.tr/">avukatbeta.uyap.gov.tr (yeni portal)</option>
    <option value="https://avukat.uyap.gov.tr/">avukat.uyap.gov.tr</option></select></div>
    <p class="note">Portal oturumu (çerezler) bu uygulamaya özel ayrı bir profilde saklanır. Portaldan indirdiğiniz .udf dosyaları İndirilenler\\UYAP klasörüne kaydedilip burada açılır.</p></div>`);
  $('#us-url', body).value = s.uyapUrl || 'https://avukatbeta.uyap.gov.tr/';
  modal({ title: 'UYAP portal adresi', icon: 'globe', body, width: 500, actions: [{ label: 'İptal' }, { label: 'Kaydet', kind: 'primary', onClick: () => native.settings.set({ uyapUrl: $('#us-url', body).value }) }] });
}

async function insertImage(ed) {
  const f = await native.imageDialog();
  if (!f) return;
  const b64 = base64FromBytes(f.bytes);
  const mime = /\.png$/i.test(f.name) ? 'image/png' : /\.gif$/i.test(f.name) ? 'image/gif' : 'image/jpeg';
  const src = `data:${mime};base64,${b64}`;
  const img = new Image();
  img.src = src;
  await img.decode().catch(() => {});
  const maxW = (app.active.geom.pageW - app.active.geom.left - app.active.geom.right) * 0.75; // pt
  let w = (img.naturalWidth || 200) * 0.75, hh = (img.naturalHeight || 100) * 0.75;
  if (w > maxW) { hh *= maxW / w; w = maxW; }
  ed.chain().focus().insertContent({ type: 'image', attrs: { src, width: Math.round(w), height: Math.round(hh) } }).run();
}

function paragraphDialog(ed) {
  const p = ed.getAttributes('paragraph');
  const cm = (v) => String(Math.round(((v || 0) / CM) * 100) / 100);
  const body = h(`<div>
    <div class="field-row">
      <div class="field"><label>Hizalama</label><select id="pd-align"><option value="left">Sola</option><option value="center">Ortala</option><option value="right">Sağa</option><option value="justify">İki yana yasla</option></select></div>
      <div class="field"><label>Satır aralığı</label><select id="pd-ls"><option value="0">1,0</option><option value="0.15">1,15</option><option value="0.5">1,5</option><option value="1">2,0</option><option value="1.5">2,5</option><option value="2">3,0</option></select></div>
    </div>
    <h3 class="sec">Girinti</h3>
    <div class="field-row">
      <div class="field"><label>Sol (cm)</label><input type="number" step="0.25" id="pd-l" value="${cm(p.leftIndent)}"></div>
      <div class="field"><label>Sağ (cm)</label><input type="number" step="0.25" id="pd-r" value="${cm(p.rightIndent)}"></div>
      <div class="field"><label>İlk satır (cm)</label><input type="number" step="0.25" id="pd-f" value="${cm(p.firstLineIndent)}"></div>
    </div>
    <h3 class="sec">Aralık</h3>
    <div class="field-row">
      <div class="field"><label>Önce (nk)</label><input type="number" step="1" min="0" id="pd-a" value="${p.spaceAbove || 0}"></div>
      <div class="field"><label>Sonra (nk)</label><input type="number" step="1" min="0" id="pd-b" value="${p.spaceBelow || 0}"></div>
    </div>
    <p class="note">İlk satır için eksi değer asılı girinti verir.</p></div>`);
  $('#pd-align', body).value = p.align || 'left';
  const cur = p.lineSpacing || 0;
  const ls = [0, 0.15, 0.5, 1, 1.5, 2].reduce((best, v) => (Math.abs(v - cur) < Math.abs(best - cur) ? v : best), 0);
  $('#pd-ls', body).value = String(ls);
  modal({
    title: 'Paragraf', icon: 'lineSpacing', body, width: 520,
    actions: [{ label: 'İptal' }, { label: 'Uygula', kind: 'primary', onClick: () => {
      const n = (id) => parseFloat($(id, body).value) || 0;
      ed.chain().focus().setParagraphAttrs({ align: $('#pd-align', body).value, lineSpacing: parseFloat($('#pd-ls', body).value), leftIndent: Math.max(0, n('#pd-l')) * CM, rightIndent: Math.max(0, n('#pd-r')) * CM, firstLineIndent: n('#pd-f') * CM, spaceAbove: Math.max(0, n('#pd-a')), spaceBelow: Math.max(0, n('#pd-b')) }).run();
    } }],
  });
}

// ================================================================== styles

function applyParaStyle(ed, id) {
  const st = PARA_STYLES.find((s) => s.id === id) || (app.userStyles || []).find((s) => s.id === id);
  if (!st) return;
  const { state } = ed;
  const tr = state.tr;
  const { from, to } = state.selection;
  const schema = state.schema;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...st.para });
    const a = pos + 1, b = pos + node.nodeSize - 1;
    if (st.marks.bold === true) tr.addMark(a, b, schema.marks.bold.create());
    if (st.marks.bold === false) tr.removeMark(a, b, schema.marks.bold);
    if (st.marks.italic === true) tr.addMark(a, b, schema.marks.italic.create());
    if (st.marks.italic === false) tr.removeMark(a, b, schema.marks.italic);
    if (st.marks.size || st.marks.family) tr.addMark(a, b, schema.marks.textStyle.create({ fontSize: st.marks.size ? `${st.marks.size}pt` : null, fontFamily: st.marks.family || null, color: null }));
    if (st.marks.upper) {
      node.descendants((child, off) => {
        if (child.isText) {
          const up = child.text.toLocaleUpperCase('tr');
          if (up !== child.text) tr.insertText(up, tr.mapping.map(pos + 1 + off), tr.mapping.map(pos + 1 + off + child.text.length));
        }
      });
    }
    return false;
  });
  ed.view.dispatch(tr);
  ed.commands.focus();
}

// ================================================================== commands

const DATE_FORMATS = () => {
  const d = new Date();
  return [
    d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
    d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }),
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
  ];
};
const SYMBOLS = ['§', '₺', '€', '$', '“', '”', '‘', '’', '«', '»', '–', '—', '…', '•', '°', '±', '×', '÷', '½', '¼', '¾', '©', '®', '™', '→', '←', '✓', '№'];

async function runCmd(name, arg, el) {
  const tab = app.active;
  const ed = tab?.editor;
  const chain = () => ed.chain().focus();
  switch (name) {
    // ---- file
    case 'backstage': backstage(); return;
    case 'new': backstage('new'); return;
    case 'newFromTemplate': backstage('new'); return;
    case 'newBlank': newDocument('blank'); return;
    case 'open': {
      const paths = await native.openDialog();
      for (const p of paths) await openPath(p);
      return;
    }
    case 'save': if (tab) await save(tab); return;
    case 'saveAs': if (tab) await save(tab, { as: true }); return;
    case 'close': if (tab) await closeTab(tab); return;
    case 'exportPdf': {
      if (!tab) return;
      const path = await native.saveDialog({ defaultPath: `${tab.path ? tab.path.replace(/\.udf$/i, '') : tab.title}.pdf`, kind: 'pdf' });
      if (!path) return;
      const bytes = await makePdf(tab);
      await native.writeFile(path, bytes);
      toast(`PDF kaydedildi: ${path.split(/[\\/]/).pop()}`, { type: 'ok', actions: [{ label: 'Klasörde göster', onClick: () => native.showInFolder(path) }] });
      return;
    }
    case 'exportDocx': {
      if (!tab) return;
      const base = tab.path ? tab.path.replace(/\.udf$/i, '') : tab.importedFrom ? tab.importedFrom.replace(/\.docx$/i, ' (egUDF)') : tab.title;
      const path = await native.saveDialog({ defaultPath: `${base}.docx`, kind: 'docx' });
      if (!path) return;
      await native.writeFile(path, exportDocx(tab.editor.getJSON(), tab.meta, tab.review));
      toast(`Word belgesi kaydedildi: ${path.split(/[\\/]/).pop()}`, { type: 'ok', actions: [{ label: 'Klasörde göster', onClick: () => native.showInFolder(path) }] });
      return;
    }
    case 'print': case 'openEgpdf': {
      if (!tab) return;
      const t = toast('PDF hazırlanıyor…', { ms: 2000 });
      const r = await native.egpdf.open(await makePdf(tab), tab.title);
      t.remove();
      toast(r.egpdf ? 'egPDF\'te açıldı — yazdırmak için Ctrl+P' : 'Varsayılan PDF görüntüleyicide açıldı', { type: 'ok' });
      return;
    }
    case 'profile': profileDialog(); return;
    case 'showInFolder': if (tab?.path) native.showInFolder(tab.path); else toast('Belge henüz kaydedilmedi.', { type: 'warn' }); return;

    // ---- clipboard / history
    case 'cut': ed?.commands.focus(); native.edit('cut'); return;
    case 'copy': ed?.commands.focus(); native.edit('copy'); return;
    case 'paste': ed?.commands.focus(); native.edit('paste'); return;
    case 'undo': chain().undo().run(); return;
    case 'redo': chain().redo().run(); return;

    // ---- character
    case 'bold': chain().toggleBold().run(); return;
    case 'italic': chain().toggleItalic().run(); return;
    case 'underline': chain().toggleUnderline().run(); return;
    case 'strike': chain().toggleStrike().run(); return;
    case 'subscript': chain().toggleSubscript().run(); return;
    case 'superscript': chain().toggleSuperscript().run(); return;
    case 'clearFormat': chain().unsetAllMarks().run(); return;
    case 'fontFamily': chain().setFontFamily(arg).run(); return;
    case 'fontSize': chain().setFontSize(`${arg}pt`).run(); return;
    case 'growFont': chain().stepFontSize(1).run(); return;
    case 'shrinkFont': chain().stepFontSize(-1).run(); return;
    case 'color': chain().setColor(app.lastColor).run(); return;
    case 'colorMenu': colorMenu(el, { onPick: (c) => { if (c) { app.lastColor = c; chain().setColor(c).run(); } else chain().unsetColor().run(); scheduleUI(); } }); return;
    case 'highlight': chain().toggleHighlight({ color: app.lastHighlight }).run(); return;
    case 'highlightMenu': colorMenu(el, { noneLabel: 'Vurgu yok', onPick: (c) => { if (c) { app.lastHighlight = c; chain().setHighlight({ color: c }).run(); } else chain().unsetHighlight().run(); scheduleUI(); } }); return;

    // ---- paragraph
    case 'align': chain().setParagraphAttrs({ align: arg }).run(); return;
    case 'bullets': chain().toggleUdfList('bullet').run(); return;
    case 'numbers': chain().toggleUdfList('number').run(); return;
    case 'bulletsMenu': menu(el, BULLET_TYPES.map((b) => ({ html: `<span style="width:22px;display:inline-block">${b.sample}</span>${esc(b.type.replace('BULLET_TYPE_', '').toLowerCase())}`, onClick: () => chain().toggleUdfList('bullet', b.type).run() }))); return;
    case 'numbersMenu': menu(el, NUMBER_TYPES.map((n) => ({ html: `<span style="width:30px;display:inline-block">${n.sample}</span>${n.sample.replace(/\w/, '…')}`, onClick: () => chain().toggleUdfList('number', n.type).run() }))); return;
    case 'indent': if (ed.getAttributes('paragraph').list) chain().listLevel(1).run(); else chain().indent(35.4).run(); return;
    case 'outdent': if (ed.getAttributes('paragraph').list) chain().listLevel(-1).run(); else chain().indent(-35.4).run(); return;
    case 'firstLine': { const on = (ed.getAttributes('paragraph').firstLineIndent || 0) > 0; chain().setParagraphAttrs({ firstLineIndent: on ? 0 : 35.4 }).run(); return; }
    case 'lineSpacingMenu': {
      const cur = ed.getAttributes('paragraph');
      const ls = [[0, '1,0'], [0.15, '1,15'], [0.5, '1,5'], [1, '2,0'], [1.5, '2,5'], [2, '3,0']];
      menu(el, [
        { header: 'Satır aralığı' },
        ...ls.map(([v, l]) => ({ label: l, checked: Math.abs((cur.lineSpacing || 0) - v) < 0.02, onClick: () => chain().setParagraphAttrs({ lineSpacing: v }).run() })),
        { sep: true },
        { label: (cur.spaceAbove ? 'Paragraftan önceki boşluğu kaldır' : 'Paragraftan önce boşluk ekle (6 nk)'), onClick: () => chain().setParagraphAttrs({ spaceAbove: cur.spaceAbove ? 0 : 6 }).run() },
        { label: (cur.spaceBelow ? 'Paragraftan sonraki boşluğu kaldır' : 'Paragraftan sonra boşluk ekle (6 nk)'), onClick: () => chain().setParagraphAttrs({ spaceBelow: cur.spaceBelow ? 0 : 6 }).run() },
      ]);
      return;
    }
    case 'paraField': {
      const v = parseFloat(arg.value) || 0;
      const pt = /Indent/.test(arg.field) ? v * CM : v;
      chain().setParagraphAttrs({ [arg.field]: pt }).run();
      return;
    }
    case 'style': applyParaStyle(ed, arg); return;
    case 'marks': document.body.classList.toggle('show-marks'); app.active?.editor.commands.repaginate(); scheduleUI(); return;

    case 'formatPainter': formatPainter(app, { sticky: arg === 'sticky' }); return;
    case 'changeCaseMenu': changeCaseMenu(app, el); return;
    case 'changeCase': changeCase(ed, arg); return;
    case 'cycleCase': { // Shift+F3: lower → UPPER → Sentence
      const { from, to } = ed.state.selection;
      const t = ed.state.doc.textBetween(from, to, ' ');
      const next = t && t === t.toLocaleUpperCase('tr') ? 'sentence' : t && t === t.toLocaleLowerCase('tr') ? 'upper' : 'lower';
      changeCase(ed, next);
      return;
    }
    case 'paragraphDialog': if (tab) paragraphDialog(ed); return;
    case 'pastePlain': ed?.commands.focus(); native.edit('pasteAndMatchStyle'); return;
    case 'selectAll': chain().selectAll().run(); return;
    case 'wordCount': wordCountDialog(app); return;
    case 'styleSave': {
      if (!tab) return;
      const name = await promptBox({ title: 'Yeni stil', label: 'Stil adı', placeholder: 'Ör. Talep sonucu', ok: 'Kaydet', icon: 'plus' });
      if (!name) return;
      const p = ed.getAttributes('paragraph');
      const ts = ed.getAttributes('textStyle');
      const st = {
        id: `u${Date.now().toString(36)}`, name, prev: name.length > 9 ? `${name.slice(0, 8)}…` : name,
        css: [ed.isActive('bold') ? 'font-weight:700' : '', ed.isActive('italic') ? 'font-style:italic' : ''].filter(Boolean).join(';'),
        para: { align: p.align, leftIndent: p.leftIndent, rightIndent: p.rightIndent, firstLineIndent: p.firstLineIndent, spaceAbove: p.spaceAbove, spaceBelow: p.spaceBelow, lineSpacing: p.lineSpacing },
        marks: { bold: ed.isActive('bold'), italic: ed.isActive('italic'), size: ts.fontSize ? parseFloat(ts.fontSize) : null, family: ts.fontFamily || null },
      };
      app.userStyles = [...(app.userStyles || []), st];
      await native.settings.set({ userStyles: app.userStyles });
      ribbon.show(ribbon.current());
      toast(`"${name}" stili eklendi`, { type: 'ok', ms: 1800 });
      return;
    }
    case 'styleManage': {
      const list = app.userStyles || [];
      const body = h(`<div>${list.length ? `<div class="recover-list">${list.map((s) => `<div class="recover-item" data-id="${esc(s.id)}"><div style="flex:1"><b>${esc(s.name)}</b><div class="dim small">${s.marks.bold ? 'Kalın · ' : ''}${s.marks.italic ? 'İtalik · ' : ''}${s.marks.size ? `${s.marks.size} nk · ` : ''}${{ left: 'Sola', center: 'Ortalı', right: 'Sağa', justify: 'İki yana' }[s.para.align] || ''}</div></div><button class="btn danger" data-del="${esc(s.id)}">Sil</button></div>`).join('')}</div>` : '<p class="note">Henüz kendi stiliniz yok. Bir paragrafı biçimlendirip Giriş → Stil kaydet\'e basın.</p>'}</div>`);
      body.onclick = async (e) => {
        const id = e.target.dataset?.del;
        if (!id) return;
        app.userStyles = (app.userStyles || []).filter((s) => s.id !== id);
        await native.settings.set({ userStyles: app.userStyles });
        e.target.closest('.recover-item').remove();
        ribbon.show(ribbon.current());
      };
      modal({ title: 'Stillerim', icon: 'template', body, width: 480, actions: [{ label: 'Kapat', kind: 'primary' }] });
      return;
    }
    case 'templateSave': {
      if (!tab) return;
      const name = await promptBox({ title: 'Şablon olarak kaydet', label: 'Şablon adı', value: tab.title, ok: 'Kaydet', icon: 'template' });
      if (!name) return;
      const id = `t${Date.now().toString(36)}`;
      await native.templates.write(id, JSON.stringify({ name, at: new Date().toISOString(), doc: tab.editor.getJSON(), meta: tab.meta }));
      toast(`"${name}" şablonlarınıza eklendi (Dosya → Yeni)`, { type: 'ok' });
      return;
    }
    case 'autocorrectDialog': autocorrectDialog(); return;
    case 'commentNew': addComment(app); return;
    case 'trackToggle': {
      if (!tab) return;
      const on = !ed.storage.trackChanges.enabled;
      setTracking(ed, on, author(app));
      tab.review.tracking = on;
      tab.reviewDirty = true;
      renderTabs();
      toast(on ? 'Değişiklikler izleniyor' : 'Değişiklik izleme kapalı', { ms: 1500 });
      scheduleUI();
      return;
    }
    case 'acceptChange': case 'rejectChange': {
      const accept = name === 'acceptChange';
      const here = changesAt(ed.state);
      if (here.length) {
        resolveItems(ed, here, accept);
        stepChange(1, true);
      } else if (!stepChange(1)) toast('Bekleyen değişiklik yok.');
      return;
    }
    case 'acceptMenu': case 'rejectMenu': {
      const accept = name === 'acceptMenu';
      menu(el, [
        { label: accept ? 'Bu değişikliği kabul et' : 'Bu değişikliği reddet', onClick: () => runCmd(accept ? 'acceptChange' : 'rejectChange') },
        { label: accept ? 'Tüm değişiklikleri kabul et' : 'Tüm değişiklikleri reddet', onClick: () => { const n = resolveAll(ed, accept); toast(`${n} değişiklik ${accept ? 'kabul edildi' : 'reddedildi'}`, { type: 'ok', ms: 1800 }); } },
        { sep: true },
        { label: accept ? 'Kabul et ve izlemeyi durdur' : 'Reddet ve izlemeyi durdur', onClick: () => { resolveAll(ed, accept); if (ed.storage.trackChanges.enabled) runCmd('trackToggle'); } },
      ]);
      return;
    }
    case 'changePrev': stepChange(-1); return;
    case 'changeNext': stepChange(1); return;
    case 'ruler': app.showRuler = !app.showRuler; localStorage.setItem('udf.ruler', app.showRuler ? '1' : '0'); for (const t of app.tabs) t.ruler?.setVisible(app.showRuler); scheduleUI(); return;
    case 'markup': document.body.classList.toggle('hide-markup', arg === 'none'); localStorage.setItem('udf.markup', arg); tab?.editor.commands.repaginate(); scheduleUI(); return;
    case 'commentDelete': { const ids = tab ? commentsAt(ed.state) : []; if (ids.length) ids.forEach((id) => deleteComment(app, id)); else toast('İmleç bir yorumun üzerinde değil.'); return; }
    case 'commentDeleteAll': deleteAllComments(app); return;
    case 'commentPrev': stepComment(app, -1); return;
    case 'commentNext': stepComment(app, 1); return;
    case 'reviewPane': showPane(app, $('#review-pane').classList.contains('hidden')); return;
    case 'spellcheck': {
      app.spell = !app.spell;
      localStorage.setItem('udf.spell', app.spell ? '1' : '0');
      for (const t of app.tabs) t.editor.view.dom.setAttribute('spellcheck', String(app.spell));
      toast(app.spell ? 'Yazım denetimi açık' : 'Yazım denetimi kapalı', { ms: 1400 });
      scheduleUI();
      return;
    }
    case 'shortcuts': shortcutsDialog(); return;
    case 'themeMenu': themeMenu(app, el); return;
    case 'theme': setTheme(app, arg); return;

    // ---- find
    case 'find': openFind(false); return;
    case 'replace': openFind(true); return;

    // ---- insert
    case 'tableMenu': gridMenu(el, (r, c) => {
      const w = Math.floor((tab.geom.pageW - tab.geom.left - tab.geom.right) / c);
      const P = () => ({ type: 'paragraph', attrs: defaultParaAttrs() });
      const rows = Array.from({ length: r }, () => ({ type: 'tableRow', attrs: { udf: {} }, content: Array.from({ length: c }, () => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [w], udf: {} }, content: [P()] })) }));
      chain().insertContent({ type: 'table', attrs: { udf: {} }, content: rows }).run();
    }); return;
    case 'image': insertImage(ed); return;
    case 'dateMenu': menu(el, DATE_FORMATS().map((d) => ({ label: d, onClick: () => chain().insertContent(d).run() }))); return;
    case 'symbolMenu': {
      const wrap = h('<div class="swatches" style="grid-template-columns:repeat(7,30px)"></div>');
      for (const s of SYMBOLS) {
        const b = h(`<button style="width:30px;height:30px;background:var(--surface);font-size:16px">${s}</button>`);
        b.onclick = () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); chain().insertContent(s).run(); };
        wrap.append(b);
      }
      menu(el, wrap);
      return;
    }
    case 'blockMenu': menu(el, BLOCKS.map((b) => ({ label: b.name, onClick: () => chain().insertContent(b.build(app.profile)).run() }))); return;

    // ---- table
    case 'table': {
      const c = chain();
      if (typeof c[arg] === 'function') c[arg]().run();
      return;
    }
    case 'tableSelectMenu': menu(el, [['cell', 'Hücre'], ['row', 'Satır'], ['column', 'Sütun'], ['table', 'Tablo']].map(([k, l]) => ({ label: l, onClick: () => selectTablePart(ed, k) }))); return;
    case 'tableSelect': selectTablePart(ed, arg); return;
    case 'tableDistribute': distributeColumns(ed, textWidthPx(tab)); return;
    case 'tableFit': fitColumns(ed, textWidthPx(tab)); return;
    case 'tableColWidth': {
      const cur = currentColumnWidth(ed, textWidthPx(tab));
      if (cur == null) return;
      const v = await promptBox({ title: 'Sütun genişliği', label: 'Genişlik (cm)', value: (cur / PX_PER_CM).toFixed(2).replace('.', ','), ok: 'Uygula', icon: 'colWidth' });
      const cm = parseFloat(String(v ?? '').replace(',', '.'));
      if (cm > 0) setColumnWidth(ed, cm * PX_PER_CM, textWidthPx(tab));
      return;
    }
    case 'tableAlign': chain().setParagraphAttrs({ align: arg }).run(); return;
    case 'tableSortMenu': {
      const r = cellRect(ed.state);
      if (!r) return;
      const head = sortHeader(r);
      const run = (desc, header) => { const res = sortRows(ed, { desc, header }); if (res !== true) toast(res, { type: 'warn' }); };
      menu(el, [
        { label: `${r.left + 1}. sütuna göre A → Z (0 → 9)`, icon: 'sort', onClick: () => run(false, head) },
        { label: `${r.left + 1}. sütuna göre Z → A (9 → 0)`, onClick: () => run(true, head) },
        { sep: true },
        { label: head ? 'İlk satır başlık: sabit kalır' : 'İlk satır da sıralanır', disabled: true },
        { label: head ? 'İlk satırı da sırala (A → Z)' : 'İlk satırı başlık say (A → Z)', onClick: () => run(false, !head) },
      ]);
      return;
    }
    case 'tableToText': if (tableToText(ed)) toast('Tablo metne dönüştürüldü', { ms: 1500 }); return;
    case 'textToTable': if (!textToTable(ed, textWidthPx(tab))) toast('Dönüştürülecek paragraf yok.'); return;
    case 'tableBorder': {
      const { $from } = ed.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d);
        if (n.type.name === 'table') {
          const udf = { ...(n.attrs.udf || {}) };
          udf.border = (udf.border || 'borderCell') === 'borderNone' ? 'borderCell' : 'borderNone';
          ed.view.dispatch(ed.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, udf }));
          break;
        }
      }
      return;
    }

    // ---- layout
    case 'marginsMenu': {
      const presets = [
        ['Normal (UYAP)', { topMargin: '56.7', bottomMargin: '56.7', leftMargin: '70.875', rightMargin: '70.875' }, 'Üst/Alt 2 cm · Sol/Sağ 2,5 cm'],
        ['Dar', { topMargin: '36.0', bottomMargin: '36.0', leftMargin: '36.0', rightMargin: '36.0' }, 'Tümü 1,27 cm'],
        ['Orta', { topMargin: '70.875', bottomMargin: '70.875', leftMargin: '70.875', rightMargin: '70.875' }, 'Tümü 2,5 cm'],
        ['Geniş', { topMargin: '70.875', bottomMargin: '70.875', leftMargin: '85.05', rightMargin: '85.05' }, 'Sol/Sağ 3 cm'],
      ];
      menu(el, [...presets.map(([l, p, d]) => ({ html: `<div><div>${l}</div><div class="dim small">${d}</div></div>`, onClick: () => setPageFormat(tab, p) })), { sep: true }, { label: 'Özel kenar boşlukları…', onClick: () => pageSetup(tab) }]);
      return;
    }
    case 'orientationMenu': {
      const port = (tab.meta.pageFormat.paperOrientation || '1') === '1';
      menu(el, [{ label: 'Dikey', checked: port, onClick: () => setPageFormat(tab, { paperOrientation: '1' }) }, { label: 'Yatay', checked: !port, onClick: () => setPageFormat(tab, { paperOrientation: '0' }) }]);
      return;
    }
    case 'pageSetup': pageSetup(tab); return;
    case 'headerFooter': headerFooterDialog(tab); return;
    case 'pageNumbers': togglePageNumbers(tab); return;

    // ---- sign / uyap
    case 'sign':
      if (!tab) return;
      if (changeList(ed.state.doc).length) {
        const n = changeList(ed.state.doc).length;
        if (!(await confirmBox({ title: 'Bekleyen değişiklikler', text: `Belgede kabul edilmemiş ${n} değişiklik var. İmzalanan metin, tüm değişiklikler kabul edilmiş halidir. Kabul edip devam edilsin mi?`, ok: 'Kabul et ve imzala', icon: 'track' }))) return;
        resolveAll(ed, true);
        if (ed.storage.trackChanges.enabled) { setTracking(ed, false); tab.review.tracking = false; }
      }
      if (tab.review?.comments.length && !(await confirmBox({ title: 'Yorumlar imzalanmaz', text: `Belgede ${tab.review.comments.length} yorum var. İmzalı dosya yorumsuz kaydedilir ve yorumlar belgeden kaldırılır.`, ok: 'Devam et', icon: 'comment' }))) return;
      if (tab.sig?.state === 'valid' && !tab.dirty && !(await confirmBox({ title: 'Belge zaten imzalı', text: 'Mevcut imza yeni imzayla değiştirilecek. Devam edilsin mi?', ok: 'Yeniden imzala', kind: 'ok', icon: 'sign' }))) return;
      signDialog(app, tab);
      return;
    case 'signInfo': if (tab) signatureInfo(app, tab); return;
    case 'driverSettings': driverSettings(); return;
    case 'uyapOpen': native.uyap.open(); return;
    case 'uyapSend': if (tab) uyapSendFlow(app, tab); return;
    case 'uyapAttach': {
      if (!tab?.path || tab.dirty) { toast('Önce belgeyi kaydedip imzalayın.', { type: 'warn' }); return; }
      const r = await native.uyap.attach(tab.path);
      toast(r.ok ? 'Dosya portalın yükleme alanına eklendi.' : r.error, { type: r.ok ? 'ok' : 'warn', ms: 6000 });
      return;
    }
    case 'uyapSettings': uyapSettings(); return;

    // ---- view
    case 'toggleNav': $('#nav-pane').classList.toggle('hidden'); localStorage.setItem('udf.nav', $('#nav-pane').classList.contains('hidden') ? '0' : '1'); refreshNav(); scheduleUI(); return;
    case 'focusMode': document.body.classList.toggle('focus-mode'); if (document.body.classList.contains('focus-mode')) toast('Odak modu — çıkmak için F11 veya Esc'); return;
    case 'zoom': setZoom(parseFloat(arg)); return;
    case 'zoomFit': if (tab) setZoom(Math.max(0.5, Math.min(2, (tab.host.clientWidth - 60) / tab.geom.pageW))); return;
    default:
      console.warn('unknown command', name);
  }
}

/** Selects the next/previous tracked change. → false when there is none. */
/** Width of the text area in editor px (what table colwidths are measured in). */
function textWidthPx(tab) { return Math.floor(tab.geom.pageW - tab.geom.left - tab.geom.right); }

/** A first row looks like a header when it is bold or the others start with digits and it doesn't. */
function sortHeader(r) {
  const first = r.node.firstChild;
  if (!first || r.node.childCount < 3) return false;
  let bold = true;
  first.descendants((n) => { if (n.isText && !n.marks.some((m) => m.type.name === 'bold')) bold = false; });
  return bold && first.textContent.trim().length > 0;
}

function stepChange(dir, afterResolve = false) {
  const ed = app.ed();
  if (!ed) return false;
  const list = changeList(ed.state.doc);
  if (!list.length) return false;
  const pos = ed.state.selection[dir > 0 ? 'to' : 'from'];
  const next = dir > 0 ? list.find((c) => (afterResolve ? c.from >= pos : c.from > pos)) || list[0] : [...list].reverse().find((c) => c.to < pos) || list[list.length - 1];
  ed.chain().focus().setTextSelection({ from: next.from, to: next.to }).scrollIntoView().run();
  return true;
}

// ================================================================== crash recovery

const SESSION = Date.now().toString(36);
const recoveryKey = (tab) => `${SESSION}-${tab.id}`;

/** Writes every unsaved tab that changed since its last snapshot. */
async function autosave(force = false) {
  for (const t of app.tabs) {
    if (!isDirty(t) || (!force && t._autoRev === t.rev)) continue;
    t._autoRev = t.rev;
    const data = { v: 1, session: SESSION, title: t.title, path: t.path, at: new Date().toISOString(), meta: t.meta, doc: t.editor.getJSON(), review: t.review };
    try { await native.recovery.write(recoveryKey(t), JSON.stringify(data)); } catch (e) { console.warn('autosave failed', e); }
  }
}
app.autosave = autosave;

async function offerRecovery() {
  const list = (await native.recovery.list()).filter((r) => r.data?.session !== SESSION && r.data?.doc);
  if (!list.length) return;
  list.sort((a, b) => String(b.data.at).localeCompare(String(a.data.at)));
  const body = h(`<div><p style="margin-top:0;line-height:1.5">egUDF beklenmedik şekilde kapanmış. Kaydedilmemiş ${list.length} belge kurtarıldı:</p>
    <div class="recover-list">${list.map((r) => `<label class="recover-item"><input type="checkbox" checked data-key="${esc(r.key)}"><div><b>${esc(r.data.title)}</b><div class="dim small">${esc(fmtDate(r.data.at))}${r.data.path ? ` · ${esc(r.data.path)}` : ''}</div></div></label>`).join('')}</div></div>`);
  modal({
    title: 'Belge kurtarma', icon: 'history', body, width: 560,
    actions: [
      { label: 'Kurtarılanları sil', kind: 'danger', left: true, onClick: async () => { for (const r of list) await native.recovery.remove(r.key); } },
      { label: 'Sonra' },
      { label: 'Seçilenleri aç', kind: 'primary', onClick: async () => {
        const keys = new Set([...body.querySelectorAll('input:checked')].map((i) => i.dataset.key));
        for (const r of list) {
          if (!keys.has(r.key)) continue;
          const d = r.data;
          const t = newTab({ title: d.title, path: d.path, doc: d.doc, meta: d.meta, review: d.review });
          t.dirty = true;
          t._recovered = true;
          await native.recovery.remove(r.key);
          renderTabs();
        }
        if (keys.size) toast('Kurtarılan belgeler açıldı — kaydetmeyi unutmayın.', { type: 'ok', ms: 5000 });
      } },
    ],
  });
}

function applyAutocorrect() {
  try { localStorage.setItem('udf.ac', JSON.stringify(app.ac)); } catch {}
  for (const t of app.tabs) Object.assign(t.editor.storage.autocorrect, app.ac);
}

function autocorrectDialog() {
  const ac = app.ac;
  const lines = Object.entries(ac.list).map(([k, v]) => `${k} → ${v}`).join('\n');
  const body = h(`<div>
    <div class="field"><label><input type="checkbox" id="ac-q" ${ac.quotes ? 'checked' : ''}> Düz tırnakları akıllı tırnakla değiştir (“ ” ‘ ’)</label></div>
    <div class="field"><label><input type="checkbox" id="ac-c" ${ac.capitalize ? 'checked' : ''}> Cümlelerin ilk harfini büyük yap</label></div>
    <div class="field"><label><input type="checkbox" id="ac-d" ${ac.dashes ? 'checked' : ''}> İki kısa çizgiyi (--) uzun çizgiye çevir (–)</label></div>
    <div class="field"><label><input type="checkbox" id="ac-e" ${ac.enabled ? 'checked' : ''}> Yazarken değiştir:</label><textarea id="ac-l" rows="10" spellcheck="false" style="font-family:Consolas,monospace;font-size:12px">${esc(lines)}</textarea></div>
    <p class="note">Her satıra bir kural: <b>yazılan → yerine gelen</b>. Bir kelimeyi bitirdiğinizde (boşluk veya noktalama) uygulanır. Ctrl+Z düzeltmeyi geri alır.</p></div>`);
  modal({
    title: 'Otomatik düzeltme', icon: 'check', body, width: 560,
    actions: [
      { label: 'Varsayılanlar', left: true, onClick: () => { body.querySelector('#ac-l').value = Object.entries(DEFAULT_AUTOCORRECT).map(([k, v]) => `${k} → ${v}`).join('\n'); return false; } },
      { label: 'İptal' },
      { label: 'Kaydet', kind: 'primary', onClick: () => {
        const list = {};
        for (const line of body.querySelector('#ac-l').value.split('\n')) {
          const m = /^\s*(\S+)\s*(?:→|->|=>|=)\s*(.+?)\s*$/.exec(line);
          if (m) list[m[1]] = m[2];
        }
        app.ac = { enabled: body.querySelector('#ac-e').checked, quotes: body.querySelector('#ac-q').checked, capitalize: body.querySelector('#ac-c').checked, dashes: body.querySelector('#ac-d').checked, list };
        applyAutocorrect();
      } },
    ],
  });
}

function captureFormat(ed) {
  const { $from } = ed.state.selection;
  return { marks: (ed.state.storedMarks || $from.marks()).filter((m) => !['udfRun', 'insertion', 'deletion', 'comment'].includes(m.type.name)) };
}
function applyFormat(ed, f) {
  const { from, to, empty } = ed.state.selection;
  if (empty) return;
  const tr = ed.state.tr;
  for (const mt of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight']) if (ed.schema.marks[mt]) tr.removeMark(from, to, ed.schema.marks[mt]);
  for (const m of f.marks) tr.addMark(from, to, m);
  ed.view.dispatch(tr);
}

function setZoom(z) {
  app.zoom = Math.round(Math.min(2, Math.max(0.5, z)) * 100) / 100;
  localStorage.setItem('udf.zoom', String(app.zoom));
  for (const t of app.tabs) applyZoom(t);
  scheduleUI();
}

// ================================================================== find bar

function openFind(replace) {
  const ed = app.ed();
  if (!ed) return;
  const bar = $('#findbar');
  bar.classList.remove('hidden');
  $('#replace-row').classList.toggle('hidden', !replace);
  const inp = $('#find-input');
  const { from, to } = ed.state.selection;
  const sel = ed.state.doc.textBetween(from, to, ' ');
  if (sel && sel.length < 80 && !sel.includes('\n')) inp.value = sel;
  inp.focus();
  inp.select();
  doFind();
}
const findOpts = (() => { try { return { matchCase: false, wholeWord: false, regex: false, ...JSON.parse(localStorage.getItem('udf.find') || '{}') }; } catch { return { matchCase: false, wholeWord: false, regex: false }; } })();
function doFind() {
  const ed = app.ed();
  if (!ed) return;
  ed.commands.setSearch($('#find-input').value, findOpts);
  showFindCount();
}
function showFindCount() {
  const s = app.ed()?.storage.udfSearch;
  if (!s) return;
  const el = $('#find-count');
  el.textContent = s.error ? 'Geçersiz ifade' : s.query ? (s.matches.length ? `${s.current + 1} / ${s.matches.length}` : 'Bulunamadı') : '';
  el.title = s.error || '';
  el.classList.toggle('bad', !!s.error || (!!s.query && !s.matches.length));
  for (const [id, k] of [['find-case', 'matchCase'], ['find-word', 'wholeWord'], ['find-regex', 'regex']]) $(`#${id}`).classList.toggle('active', !!findOpts[k]);
}
function toggleFindOpt(k) {
  findOpts[k] = !findOpts[k];
  try { localStorage.setItem('udf.find', JSON.stringify(findOpts)); } catch {}
  doFind();
}
function findStep(dir) {
  const ed = app.ed();
  if (!ed) return;
  ed.commands.searchStep(dir);
  showFindCount();
}
function closeFind() {
  $('#findbar').classList.add('hidden');
  app.ed()?.commands.setSearch('');
  app.ed()?.commands.focus();
}

// ================================================================== navigation pane

let navMode = 'headings';
let navTimer = null;
function scheduleNav() { clearTimeout(navTimer); navTimer = setTimeout(refreshNav, 350); }

function blockTextMap(node, pos) {
  let text = '';
  const map = [];
  node.forEach((child, offset) => {
    if (child.isText) { for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i); text += child.text; }
    else { map.push(pos + 1 + offset); text += '￼'; }
  });
  return { text, map };
}

function refreshNav() {
  const list = $('#nav-list');
  const ed = app.ed();
  if ($('#nav-pane').classList.contains('hidden')) return;
  if (!ed) { list.innerHTML = '<div class="nav-empty">Açık belge yok.</div>'; return; }
  const items = [];
  const doc = ed.state.doc;
  if (navMode === 'headings') {
    doc.descendants((node, pos) => {
      if (node.type.name === 'table') return false;
      if (node.type.name !== 'paragraph' || !node.content.size) return node.type.name !== 'paragraph';
      const first = node.firstChild;
      const bold = first?.marks.some((m) => m.type.name === 'bold');
      if (!bold) return false;
      // bold prefix (until the first non-bold run)
      let label = '';
      node.forEach((c) => { if (label !== null && c.isText && c.marks.some((m) => m.type.name === 'bold')) label += c.text; else if (label) label = label === '' ? '' : label; });
      label = label.split(/\t|:/)[0].trim();
      if (label.length < 3 || label.length > 110) return false;
      const letters = label.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '');
      const upper = letters && letters === letters.toLocaleUpperCase('tr');
      const centered = node.attrs.align === 'center';
      if (!upper && !centered && !/^([IVX]+|[A-ZÇĞİÖŞÜ]|\d+)[.)-]\s/.test(label)) return false;
      items.push({ label, pos, cls: centered ? 'l1' : (/^[A-ZÇĞİÖŞÜ]\)|^\d/.test(label) ? 'l2' : 'l1') });
      return false;
    });
  } else if (navMode === 'fill') {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const { text, map } = blockTextMap(node, pos);
      for (const m of text.matchAll(/\[[^\]\n]{0,120}\]|…{2,}|\.{5,}/g)) items.push({ label: m[0], from: map[m.index], to: map[m.index + m[0].length - 1] + 1 });
      return false;
    });
  } else {
    doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const f = node.marks.find((m) => m.type.name === 'udfRun' && m.attrs.extra?.fieldName);
      if (f) items.push({ label: `${f.attrs.extra.fieldName}: ${node.text.trim().slice(0, 40)}`, from: pos, to: pos + node.nodeSize });
      return false;
    });
  }
  if (!items.length) {
    list.innerHTML = `<div class="nav-empty">${navMode === 'headings' ? 'Kalın ve büyük harfli başlıklar (AÇIKLAMALAR, SONUÇ VE İSTEM…) burada listelenir.' : navMode === 'fill' ? 'Doldurulacak yer yok. [köşeli parantezli] metinler ve ……… boşluklar burada listelenir.' : 'Bu belgede UYAP şablon alanı yok.'}</div>`;
    return;
  }
  list.innerHTML = '';
  for (const it of items.slice(0, 400)) {
    const el = h(`<div class="nav-item ${it.cls || ''}" title="${esc(it.label)}">${esc(it.label)}</div>`);
    el.onclick = () => {
      const e = app.ed();
      if (it.from != null) e.chain().focus().setTextSelection({ from: it.from, to: it.to }).scrollIntoView().run();
      else e.chain().focus().setTextSelection(it.pos + 1).scrollIntoView().run();
    };
    list.append(el);
  }
}

// ================================================================== status + ui refresh

let uiQueued = false;
function scheduleUI() {
  if (uiQueued) return;
  uiQueued = true;
  requestAnimationFrame(() => { uiQueued = false; refreshUI(); });
}

function wordCount(tab) {
  const t = docText(tab.editor.getJSON());
  return (t.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
}
let wcTimer = null;

let lastSel = null;
function refreshUI() {
  ribbon?.refresh();
  app.active?.ruler?.refresh();
  const sel = app.active ? `${app.active.id}:${app.active.editor.state.selection.from}` : null;
  if (sel !== lastSel) { lastSel = sel; renderReview(app); }
  const tab = app.active;
  const pill = $('#sig-pill'), sb = $('#sb-sig');
  $('#btn-quick-sign').disabled = !tab;
  $('#btn-quick-uyap').disabled = !tab;
  $('#zoom-label').textContent = `${Math.round(app.zoom * 100)}%`;
  $('#zoom-range').value = String(Math.round(app.zoom * 100));
  $('#sb-marks').classList.toggle('active', document.body.classList.contains('show-marks'));
  const tracking = !!tab?.editor.storage.trackChanges.enabled;
  $('#sb-track').classList.toggle('hidden', !tab);
  $('#sb-track').classList.toggle('on', tracking);
  $('#sb-track').innerHTML = `${icon('track')}<span>${tracking ? 'İzleme açık' : 'İzleme kapalı'}</span>`;
  for (const b of document.querySelectorAll('#qat [data-qat]')) {
    const c = b.dataset.qat;
    b.disabled = !tab || (c === 'undo' && !tab.editor.can().undo()) || (c === 'redo' && !tab.editor.can().redo());
  }
  if (!tab) {
    pill.className = 'pill hidden';
    $('#sb-page').textContent = '';
    $('#sb-words').textContent = '';
    sb.innerHTML = '';
    return;
  }
  const s = tab.sig;
  let cls = '', txt = 'İmzasız', ic = 'shield';
  if (s?.state === 'valid') { cls = 'ok'; txt = `İmzalı · ${s.info?.signer?.subjectCN || ''}`; ic = 'verify'; }
  else if (s?.state === 'stale') { cls = 'warn'; txt = 'İmza geçersiz olacak — yeniden imzalayın'; ic = 'warn'; }
  else if (s?.state === 'invalid') { cls = 'bad'; txt = 'İmza doğrulanamadı'; ic = 'warn'; }
  pill.className = `pill ${cls}`;
  pill.innerHTML = `${icon(ic)}<span>${esc(txt)}</span>`;
  sb.className = `sb-btn ${cls}`;
  sb.innerHTML = `${icon(ic)}${esc(s ? (s.state === 'valid' ? 'İmzalı' : s.state === 'stale' ? 'İmza eski' : 'İmza hatalı') : 'İmzasız')}`;
  const page = pageOfPos(tab.editor.view, tab.editor.state.selection.from);
  $('#sb-page').textContent = `Sayfa ${Math.min(page, tab.pages)} / ${tab.pages}`;
  clearTimeout(wcTimer);
  wcTimer = setTimeout(() => {
    if (app.active !== tab) return;
    const { from, to, empty } = tab.editor.state.selection;
    const total = wordCount(tab).toLocaleString('tr-TR');
    $('#sb-words').textContent = empty ? `${total} sözcük` : `${textStats(tab.editor.state.doc.textBetween(from, to, '\n', ' ')).words.toLocaleString('tr-TR')} / ${total} sözcük`;
  }, 250);
}

// ================================================================== wiring

function wireChrome() {
  $('#qat').innerHTML = [['save', 'save', 'Kaydet (Ctrl+S)'], ['undo', 'undo', 'Geri al (Ctrl+Z)'], ['redo', 'redo', 'Yinele (Ctrl+Y)']].map(([c, i, t]) => `<button class="icon-btn" data-qat="${c}" title="${t}">${icon(i)}</button>`).join('');
  $('#qat').onmousedown = (e) => e.preventDefault();
  $('#qat').onclick = (e) => { const b = e.target.closest('[data-qat]'); if (b && !b.disabled) runCmd(b.dataset.qat); };
  $('#sb-words').onclick = () => runCmd('wordCount');
  $('#sb-theme').innerHTML = icon('theme');
  $('#sb-theme').onclick = (e) => runCmd('themeMenu', null, e.currentTarget);
  $('#sb-help').innerHTML = icon('key');
  $('#sb-help').onclick = () => runCmd('shortcuts');
  native.onContextMenu((p) => contextMenu(app, p));
  wireReviewPane(app);
  app.contextExtras.push((ed) => {
    const ids = commentsAt(ed.state);
    return [{ label: 'Yeni yorum', icon: 'comment', kbd: 'Ctrl+Alt+M', onClick: () => runCmd('commentNew') }, ...(ids.length ? [{ label: 'Yorumu sil', icon: 'reject', onClick: () => runCmd('commentDelete') }] : [])];
  });
  app.spell = localStorage.getItem('udf.spell') !== '0';
  app.showRuler = localStorage.getItem('udf.ruler') !== '0';
  setInterval(() => autosave(), 30000);
  app.changeItems = (t) => changeList(t.editor.state.doc);
  app.resolveChange = (it, accept) => { resolveItems(app.ed(), [it], accept); renderReview(app); };
  app.focusChange = (it) => app.ed()?.chain().focus().setTextSelection({ from: it.from, to: it.to }).scrollIntoView().run();
  app.contextExtras.push((ed) => (changesAt(ed.state).length ? [{ label: 'Değişikliği kabul et', icon: 'accept', onClick: () => runCmd('acceptChange') }, { label: 'Değişikliği reddet', icon: 'reject', onClick: () => runCmd('rejectChange') }] : []));
  if (localStorage.getItem('udf.markup') === 'none') document.body.classList.add('hide-markup');
  $('#sb-track').onclick = () => runCmd('trackToggle');
  $('#btn-newtab').innerHTML = icon('plus');
  $('#btn-newtab').onclick = () => (app.tabs.length ? backstage('new') : newDocument('blank'));
  $('#btn-quick-sign').innerHTML = `${icon('sign')}<span>İmzala</span>`;
  $('#btn-quick-sign').onclick = () => runCmd('sign');
  $('#btn-quick-uyap').innerHTML = `${icon('upload')}<span>UYAP'a gönder</span>`;
  $('#btn-quick-uyap').onclick = () => runCmd('uyapSend');
  $('#sig-pill').onclick = () => runCmd('signInfo');
  $('#sb-sig').onclick = () => runCmd('signInfo');
  $('#nav-close').innerHTML = icon('close');
  $('#nav-close').onclick = () => runCmd('toggleNav');
  $$('.nav-tabs button').forEach((b) => { b.onclick = () => { navMode = b.dataset.nav; $$('.nav-tabs button').forEach((x) => x.classList.toggle('active', x === b)); refreshNav(); }; });
  if (localStorage.getItem('udf.nav') === '0') $('#nav-pane').classList.add('hidden');
  $('#zoom-in').innerHTML = icon('plus');
  $('#zoom-out').innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
  $('#zoom-in').onclick = () => setZoom(app.zoom + 0.1);
  $('#zoom-out').onclick = () => setZoom(app.zoom - 0.1);
  $('#zoom-label').onclick = () => setZoom(1);
  $('#zoom-range').oninput = (e) => setZoom(e.target.value / 100);
  $('#sb-marks').innerHTML = icon('pilcrow');
  $('#sb-marks').onclick = () => runCmd('marks');
  $('#sb-focus').innerHTML = icon('focus');
  $('#sb-focus').onclick = () => runCmd('focusMode');

  // find bar
  $('#find-prev').innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>';
  $('#find-next').innerHTML = icon('chevron');
  $('#find-close').innerHTML = icon('close');
  $('#find-input').oninput = doFind;
  $('#find-input').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeFind();
  };
  $('#replace-input').onkeydown = (e) => { if (e.key === 'Escape') closeFind(); if (e.key === 'Enter') { e.preventDefault(); $('#replace-one').click(); } };
  $('#find-prev').onclick = () => findStep(-1);
  $('#find-next').onclick = () => findStep(1);
  $('#find-close').onclick = closeFind;
  $('#find-case').onclick = () => toggleFindOpt('matchCase');
  $('#find-word').onclick = () => toggleFindOpt('wholeWord');
  $('#find-regex').onclick = () => toggleFindOpt('regex');
  $('#findbar').addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const k = { c: 'matchCase', w: 'wholeWord', r: 'regex' }[e.key.toLowerCase()];
    if (k) { e.preventDefault(); toggleFindOpt(k); }
  });
  $('#replace-one').onclick = () => { const ed = app.ed(); if (!ed) return; ed.commands.replaceCurrent($('#replace-input').value); showFindCount(); };
  $('#replace-all').onclick = () => {
    const ed = app.ed();
    if (!ed) return;
    const n = ed.storage.udfSearch.matches.length;
    ed.commands.replaceAll($('#replace-input').value);
    doFind();
    toast(`${n} yer değiştirildi`, { type: 'ok', ms: 2000 });
  };

  // keyboard
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'F11' || (e.key === 'Escape' && document.body.classList.contains('focus-mode'))) { e.preventDefault(); runCmd('focusMode'); return; }
    if (e.key === 'Escape' && !$('#backstage').classList.contains('hidden')) { $('#backstage').classList.add('hidden'); return; }
    if (e.key === 'Escape' && !$('#findbar').classList.contains('hidden')) { closeFind(); return; }
    if (e.key === 'Escape' && app.painter) { stopPainter(app); return; }
    if (e.key === 'F1') { e.preventDefault(); runCmd('shortcuts'); return; }
    if (e.key === 'F3' && e.shiftKey && app.ed()) { e.preventDefault(); runCmd('cycleCase'); return; }
    if (!mod) return;
    if (e.shiftKey && !e.altKey && app.ed() && (k === 'c' || k === 'v') && app.ed().view.hasFocus()) {
      e.preventDefault();
      if (k === 'c') { app.copiedFormat = captureFormat(app.ed()); toast('Biçim kopyalandı — uygulamak için Ctrl+Shift+V', { ms: 1600 }); }
      else if (app.copiedFormat) applyFormat(app.ed(), app.copiedFormat);
      else runCmd('pastePlain');
      return;
    }
    if (k === ' ' && !e.shiftKey && app.ed()?.view.hasFocus()) { e.preventDefault(); runCmd('clearFormat'); return; }
    if (e.altKey && k === 'm' && app.ed()) { e.preventDefault(); runCmd('commentNew'); return; }
    // Word paragraph/character shortcuts
    if (app.ed() && !e.altKey) {
      const wordKeys = { '1': ['lineSpacing', 0], '2': ['lineSpacing', 1], '5': ['lineSpacing', 0.5] };
      if (!e.shiftKey && wordKeys[e.key]) { e.preventDefault(); app.ed().chain().focus().setParagraphAttrs({ lineSpacing: wordKeys[e.key][1] }).run(); return; }
      if (!e.shiftKey && (e.key === ']' || e.key === '[')) { e.preventDefault(); runCmd(e.key === ']' ? 'growFont' : 'shrinkFont'); return; }
      if (k === 'm') { e.preventDefault(); runCmd(e.shiftKey ? 'outdent' : 'indent'); return; }
      if (e.shiftKey && k === 'n') { e.preventDefault(); runCmd('style', 'normal'); return; }
      if (e.shiftKey && k === 'l') { e.preventDefault(); runCmd('bullets'); return; }
    }
    if (e.shiftKey && k === 'e' && app.ed()) { e.preventDefault(); runCmd('trackToggle'); return; }
    const map = { n: 'newBlank', o: 'open', s: e.shiftKey ? 'saveAs' : 'save', p: 'print', f: 'find', h: 'replace', w: 'close' };
    if (map[k] && !e.altKey) { e.preventDefault(); runCmd(map[k]); return; }
    if (k === '=' || k === '+') { e.preventDefault(); setZoom(app.zoom + 0.1); }
    if (k === '-') { e.preventDefault(); setZoom(app.zoom - 0.1); }
    if (k === '0') { e.preventDefault(); setZoom(1); }
    if (k === 'tab' && app.tabs.length > 1) {
      e.preventDefault();
      const i = app.tabs.indexOf(app.active);
      activate(app.tabs[(i + (e.shiftKey ? -1 : 1) + app.tabs.length) % app.tabs.length]);
    }
  });
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !app.active) return;
    e.preventDefault();
    setZoom(app.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  // drag & drop .udf files
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.(udf|docx)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    for (const f of files) {
      const p = native.pathForFile(f);
      if (p) await openPath(p);
      else if (/\.docx$/i.test(f.name)) await openDocx(null, new Uint8Array(await f.arrayBuffer()));
      else await openBytes(new Uint8Array(await f.arrayBuffer()), { path: null, title: f.name.replace(/\.udf$/i, '') });
    }
  }, true);

  native.onOpenPaths(async (paths) => { $('#backstage').classList.add('hidden'); for (const p of paths) await openPath(p); });
  native.onToast((msg, path) => toast(msg, { type: 'ok', actions: path ? [{ label: 'Klasörde göster', onClick: () => native.showInFolder(path) }] : [] }));
  native.onBeforeClose(async () => {
    const dirty = app.tabs.filter(isDirty);
    if (!dirty.length) { native.closeOk(); return; }
    const r = await confirmBox({ title: 'Kaydedilmemiş değişiklikler', text: `${dirty.map((t) => `<b>${esc(t.title)}</b>`).join(', ')} kaydedilmedi.`, ok: 'Kaydet ve çık', extra: { label: 'Kaydetmeden çık', value: 'discard', kind: 'danger' } });
    if (r === 'discard') { for (const t of app.tabs) await native.recovery.remove(recoveryKey(t)); native.closeOk(); return; }
    if (r !== true) return;
    for (const t of dirty) { activate(t); if (!(await save(t))) return; }
    native.closeOk();
  });
}

// ================================================================== smoke scenario (npm run smoke)

window.__smoke = {
  steps: () => (window.__pgDebugOnly ? ['long', 'debug', 'format', 'debug'] : ['start', 'opened', 'scroll-mid', 'template', 'long', 'format', 'roundtrip', 'pdf', 'signdialog', 'real', 'real-scroll', 'table', 'tabletools', 'autocorrect', 'docx', 'ruler', 'recovery', 'track', 'fmttrack', 'find', 'comments', 'comment-signed', 'comfort', 'ctxmenu', 'dark', 'theme-restore', 'ui-insert', 'ui-layout', 'ui-review', 'ui-sign', 'ui-uyap', 'ui-view', 'backstage', 'welcome']),
  async run(step, out) {
    const sep = out.includes('\\') ? '\\' : '/';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    $('#modal-root').innerHTML = '';
    switch (step) {
      case 'start': return { ok: true, tabs: app.tabs.length };
      case 'scroll-mid': { const t = app.active; if (!t) return { ok: true, skipped: true }; t.host.scrollTop = t.host.scrollHeight * 0.3; await wait(300); return { ok: true }; }
      case 'opened': { // a file given on the command line, a moment later
        await wait(1500);
        const t = app.active;
        return { ok: true, title: t?.title, pages: t?.pages, words: t ? wordCount(t) : 0, welcome: !$('#welcome').classList.contains('hidden') };
      }
      case 'table': {
        const t = newDocument('blank');
        await wait(200);
        t.editor.chain().focus().insertContent('Ekler:').insertContent({ type: 'table', attrs: { udf: {} }, content: [0, 1].map(() => ({ type: 'tableRow', attrs: { udf: {} }, content: [0, 1, 2].map(() => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200], udf: {} }, content: [{ type: 'paragraph', attrs: defaultParaAttrs(), content: [{ type: 'text', text: 'Hücre' }] }] })) })) }).run();
        t.editor.commands.setTextSelection(12);
        await wait(300);
        const xml = serializeUdfXml(t.editor.getJSON(), t.meta);
        return { ok: /<table[^>]*columnCount="3"/.test(xml) && document.querySelector('#ribbon-tabs .contextual') != null };
      }
      case 'tabletools': {
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        const W = textWidthPx(t);
        const P = (text, bold) => ({ type: 'paragraph', attrs: defaultParaAttrs(), content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }] });
        const row = (cells, bold) => ({ type: 'tableRow', attrs: { udf: {} }, content: cells.map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [Math.floor(W / 3)], udf: {} }, content: [P(c, bold)] })) });
        ed.commands.setContent({ type: 'doc', content: [P('Alacaklılar:'), { type: 'table', attrs: { udf: {} }, content: [row(['Ad', 'Tarih', 'Tutar'], true), row(['Zeynep', '05.03.2024', '1500']), row(['Ahmet', '12.01.2023', '200']), row(['Çağla', '01.12.2023', '30'])] }, P('Son.')] });
        const colText = (c) => { const out = []; ed.state.doc.descendants((n) => { if (n.type.name === 'tableRow') { out.push(n.child(c).textContent); return false; } return true; }); return out.join(','); };
        const cellPos = (r, c) => { let p = null; let ri = -1; ed.state.doc.descendants((n, pos) => { if (p != null) return false; if (n.type.name === 'tableRow') { ri++; if (ri === r) { let off = pos + 1; for (let i = 0; i < c; i++) off += n.child(i).nodeSize; p = off + 2; } return false; } return true; }); return p; };
        const widths = () => { const w = []; ed.state.doc.descendants((n) => { if (n.type.name === 'tableRow' && !w.length) { n.forEach((c) => w.push(c.attrs.colwidth?.[0])); return false; } return true; }); return w; };
        const r = {};
        ed.commands.setTextSelection(cellPos(1, 0));
        r.header = sortHeader(cellRect(ed.state));
        sortRows(ed, { header: r.header });
        r.byName = colText(0);
        ed.commands.setTextSelection(cellPos(1, 2));
        sortRows(ed, { header: true, desc: true });
        r.byAmountDesc = colText(0);
        ed.commands.setTextSelection(cellPos(1, 1));
        sortRows(ed, { header: true });
        r.byDate = colText(0);
        ed.commands.setTextSelection(cellPos(1, 0));
        setColumnWidth(ed, 5 * PX_PER_CM, W);
        const w1 = widths();
        r.col5cm = Math.abs(w1[0] - 5 * PX_PER_CM) < 2 && Math.abs(w1.reduce((s, x) => s + x, 0) - W) < 4;
        distributeColumns(ed, W);
        const w2 = widths();
        r.equal = w2.every((x) => Math.abs(x - w2[0]) <= 1);
        ed.commands.setTextSelection(cellPos(1, 0));
        setColumnWidth(ed, 2 * PX_PER_CM, W);
        fitColumns(ed, W * 0.8);
        r.fit = Math.abs(widths().reduce((s, x) => s + x, 0) - W * 0.8) < 4;
        fitColumns(ed, W);
        // select a row, centre it
        ed.commands.setTextSelection(cellPos(2, 1));
        selectTablePart(ed, 'row');
        r.rowRanges = ed.state.selection.ranges.length;
        runCmd('tableAlign', 'center');
        let centred = 0; ed.state.doc.descendants((n) => { if (n.type.name === 'tableRow') { n.forEach((c) => { if (c.firstChild.attrs.align === 'center') centred++; }); return false; } return true; });
        r.centred = centred;
        // table → text → table
        const before = colText(0) + '|' + colText(2);
        ed.commands.setTextSelection(cellPos(1, 0));
        tableToText(ed);
        r.asText = ed.state.doc.child(1).textContent;
        const n = ed.state.doc.childCount;
        ed.commands.setTextSelection({ from: ed.state.doc.child(0).nodeSize + 1, to: ed.state.doc.content.size - ed.state.doc.child(n - 1).nodeSize - 1 });
        textToTable(ed, W);
        r.back = colText(0) + '|' + colText(2) === before;
        // UDF round trip of the result
        const xml = serializeUdfXml(ed.getJSON(), t.meta);
        r.cols = /columnCount="3"/.test(xml);
        r.text = docText(parseUdfXml(xml).doc).includes('Ahmet');
        ed.commands.setTextSelection(cellPos(1, 0));
        refreshUI();
        ribbon.show('table');
        await wait(250);
        r.ok = r.header && r.byName === 'Ad,Ahmet,Çağla,Zeynep' && r.byAmountDesc === 'Ad,Zeynep,Ahmet,Çağla' && r.byDate === 'Ad,Ahmet,Çağla,Zeynep' && r.col5cm && r.equal && r.fit && r.rowRanges === 3 && r.centred === 3 && r.asText === 'Ad\tTarih\tTutar' && r.back && r.cols && r.text;
        t.dirty = false;
        return r;
      }
      case 'autocorrect': {
        ribbon.show('home');
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        ed.commands.focus();
        const type = (s) => { for (const ch of s) { const { from, to } = ed.state.selection; if (!ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch))) ed.view.dispatch(ed.state.tr.insertText(ch, from, to)); } };
        type('davacı "vekil" hmk uyarınca... a) madde. yargı -- son');
        const got = ed.getText();
        const want = 'Davacı “vekil” HMK uyarınca… a) madde. Yargı – son';
        return { ok: got === want, got };
      }
      case 'docx': {
        const t = newDocument('dava');
        await wait(300);
        const bytes = exportDocx(t.editor.getJSON(), t.meta, t.review);
        const p = `${out}${sep}smoke.docx`;
        await native.writeFile(p, bytes);
        t.dirty = false;
        const t2 = await openPath(p);
        await wait(500);
        const same = docText(t2.editor.getJSON()) === docText(t.editor.getJSON());
        return { ok: !!t2 && same && t2.dirty, bytes: bytes.length, same };
      }
      case 'ruler': {
        const t = newDocument('blank');
        await wait(300);
        t.editor.chain().focus().insertContent('Ruler test paragraph').run();
        t.editor.commands.setParagraphAttrs({ leftIndent: 28.3465, firstLineIndent: 14.17 });
        t.ruler.refresh();
        const hang = t.host.querySelector('.rh-hang');
        const first = t.host.querySelector('.rh-first');
        const pageLeft = t.host.querySelector('.ruler-inner').getBoundingClientRect().left;
        const dx = (hang.getBoundingClientRect().left + 5 - pageLeft) / app.zoom - t.geom.left;
        const visible = !!t.host.querySelector('.ruler:not(.hidden)');
        return { ok: visible && Math.abs(dx - 28.3465 * PT_TO_PX) < 3 && first.getBoundingClientRect().left > hang.getBoundingClientRect().left, dx };
      }
      case 'recovery': {
        const t = app.active;
        t.editor.chain().focus().insertContent(' kurtar').run();
        await autosave(true);
        const list = await native.recovery.list();
        const mine = list.find((r) => r.key === `${SESSION}-${t.id}`);
        const ok = !!mine && JSON.stringify(mine.data.doc).includes('kurtar');
        t.dirty = false;
        await closeTab(t);
        const gone = !(await native.recovery.list()).some((r) => r.key === `${SESSION}-${t.id}`);
        return { ok: ok && gone, found: !!mine, gone };
      }
      case 'track': {
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        ed.chain().focus().insertContent('Davacı vekili beyan eder.').run();
        runCmd('trackToggle');
        const tracking = ed.storage.trackChanges.enabled;
        // type " Av." after "vekili" (pos 14)
        ed.commands.setTextSelection(14);
        ed.view.dispatch(ed.state.tr.insertText(' Av.', 14));
        // backspace the "r" of "eder" → deletion mark, cursor moves before it
        const txt = () => ed.state.doc.textContent;
        const end = ed.state.doc.content.size - 2; // before "."
        ed.commands.setTextSelection(end);
        ed.view.dispatch(ed.state.tr.delete(end - 1, end));
        const afterBs = txt();
        const cursor = ed.state.selection.from;
        const list = changeList(ed.state.doc);
        const xml = serializeUdfXml(ed.getJSON(), t.meta);
        const text = parseUdfXml(xml).doc;
        const saved = docText(text);
        // reject the insertion, accept the deletion
        const insItem = list.find((c) => c.kind === 'insertion');
        resolveChanges(ed, insItem.from, insItem.to, false);
        resolveAll(ed, true);
        const final = txt();
        // undo brings the change marks back
        ed.commands.undo();
        const undone = changeList(ed.state.doc).length;
        await wait(100);
        runCmd('trackToggle');
        await wait(50);
        const offAfter = !ed.storage.trackChanges.enabled;
        return { offAfter,
          ok: tracking && afterBs === 'Davacı vekili Av. beyan eder.' && cursor === end - 1 && list.length === 2 && saved === 'Davacı vekili Av. beyan ede.' && final === 'Davacı vekili beyan ede.' && undone > 0 && offAfter,
          afterBs, cursor, end, kinds: list.map((c) => c.kind), saved, final, undone,
        };
      }
      case 'fmttrack': {
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        ed.chain().focus().insertContent('Davacı vekili beyan eder.').run();
        const align0 = ed.state.doc.firstChild.attrs.align;
        runCmd('trackToggle');
        ed.chain().setTextSelection({ from: 8, to: 14 }).toggleBold().run();
        ed.chain().setTextSelection(3).setParagraphAttrs({ align: 'center' }).run();
        const list = changeList(ed.state.doc);
        const kinds = list.map((c) => c.kind).sort().join(',');
        const desc = list.map((c) => c.desc).join(' | ');
        const xml = serializeUdfXml(ed.getJSON(), t.meta);
        const savedBold = /bold="true"[^>]*startOffset="7" length="6"/.test(xml) || /startOffset="7" length="6"[^>]*bold="true"/.test(xml) || xml.includes('bold="true"');
        const savedCenter = xml.includes('Alignment="1"');
        // Word round trip keeps both as tracked formatting changes
        const back = importDocx(exportDocx(ed.getJSON(), t.meta, t.review));
        const bj = JSON.stringify(back.doc);
        const docxKeeps = bj.includes('"formatChange"') && bj.includes('"fmtChange"');
        await wait(100);
        const shot1 = true;
        // reject both: bold and centring are gone
        resolveAll(ed, false);
        const rejected = !JSON.stringify(ed.getJSON()).includes('"bold"') && ed.state.doc.firstChild.attrs.align === align0 && !changeList(ed.state.doc).length;
        // bold then un-bold: nothing left to review
        ed.chain().setTextSelection({ from: 1, to: 7 }).toggleBold().run();
        ed.chain().setTextSelection({ from: 1, to: 7 }).toggleBold().run();
        const selfCleared = changeList(ed.state.doc).length === 0;
        // italic, accept → stays italic, no change left
        ed.chain().setTextSelection({ from: 1, to: 7 }).toggleItalic().run();
        const one = changeList(ed.state.doc).length;
        runCmd('acceptChange');
        const accepted = JSON.stringify(ed.getJSON()).includes('"italic"') && changeList(ed.state.doc).length === 0;
        // leave a visible example for the screenshot
        ed.chain().setTextSelection({ from: 15, to: 20 }).toggleUnderline().setTextSelection(3).setParagraphAttrs({ align: 'right' }).run();
        showPane(app, true);
        renderReview(app);
        await wait(250);
        return { ok: kinds === 'format,paraFormat' && /Kalın/.test(desc) && /Ortaya/.test(desc) && savedBold && savedCenter && docxKeeps && rejected && selfCleared && one === 1 && accepted && shot1,
          kinds, desc, savedBold, savedCenter, docxKeeps, rejected, selfCleared, one, accepted };
      }
      case 'find': {
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        if (ed.storage.trackChanges.enabled) runCmd('trackToggle');
        ed.chain().focus().insertContent('Dava davacı Dava. dava 2024/15 E. 2023/7 K. istanbul İSTANBUL').run();
        const count = (q, o = {}) => { ed.commands.setSearch(q, o); return ed.storage.udfSearch.error ? 'err' : ed.storage.udfSearch.matches.length; };
        const r = {
          plain: count('dava'),
          word: count('dava', { wholeWord: true }),
          caseWord: count('dava', { wholeWord: true, matchCase: true }),
          turkish: count('İstanbul'),
          regex: count('(\\d{4})/(\\d+)', { regex: true }),
          bad: count('(', { regex: true }),
        };
        ed.commands.setSearch('(\\d{4})/(\\d+)', { regex: true });
        ed.commands.replaceAll('$2/$1');
        r.swapped = ed.state.doc.textContent.includes('15/2024 E. 7/2023 K.');
        // literal "$1" stays literal outside regex mode
        ed.commands.setSearch('E.', { matchCase: true });
        ed.commands.replaceCurrent('$1');
        r.literal = ed.state.doc.textContent.includes('15/2024 $1 7/2023');
        // text deleted under track changes is not found
        runCmd('trackToggle');
        ed.commands.setSearch('davacı');
        const m = ed.storage.udfSearch.matches[0];
        ed.view.dispatch(ed.state.tr.delete(m.from, m.to));
        r.deletedHidden = count('davacı') === 0;
        runCmd('trackToggle');
        ed.commands.setSearch('');
        // the bar with its options, for the screenshot
        ed.commands.setTextSelection(1);
        openFind(true);
        $('#find-input').value = 'dava';
        findOpts.wholeWord = true;
        doFind();
        await wait(200);
        r.barCount = $('#find-count').textContent;
        findOpts.wholeWord = false;
        r.ok = r.plain === 4 && r.word === 3 && r.caseWord === 1 && r.turkish === 2 && r.regex === 2 && r.bad === 'err' && r.swapped && r.literal && r.deletedHidden && /\/ 3$/.test(r.barCount);
        return r;
      }
      case 'comments': {
        closeFind();
        showPane(app, false);
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        ed.chain().focus().insertContent('Davacı vekili olarak beyan ederiz.').run();
        ed.commands.setTextSelection({ from: 1, to: 14 });
        addComment(app);
        await wait(80);
        const ta = document.querySelector('.rv-card textarea.rv-edit');
        ta.value = 'Müvekkil adını ekle';
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(50);
        const rep = document.querySelector('.rv-card textarea.rv-reply');
        rep.value = 'Tamam';
        rep.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await wait(50);
        const p = `${out}${sep}comments.udf`;
        t.path = p;
        await save(t);
        const bytes = await native.readFile(p);
        const u = readUdf(bytes);
        const plain = !u.contentText.includes('comment') && u.contentText.includes('Davacı vekili');
        t.dirty = false;
        await closeTab(t);
        const t2 = await openPath(p);
        await wait(300);
        const c = t2.review.comments[0];
        const anchored = !!document.querySelector('.udf-doc [data-comment]');
        await wait(200);
        return { ok: plain && c?.text === 'Müvekkil adını ekle' && c.replies.length === 1 && anchored && !!u.other['egudf/review.json'], plain, anchored, text: c?.text };
      }
      case 'comment-signed': {
        const t = app.tabs.find((x) => x.sig?.state === 'valid' && x.path);
        if (!t) return { ok: true, skipped: true };
        activate(t);
        await wait(300);
        t.editor.commands.setTextSelection(30);
        addComment(app);
        await wait(50);
        const ta = document.querySelector('.rv-card textarea.rv-edit');
        ta.value = 'İmzalı belgeye not';
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const orig = t.path;
        const p = `${out}${sep}signed-commented.udf`;
        t.path = p;
        const before = t.original.contentXml;
        await save(t);
        const u = readUdf(await native.readFile(p));
        const v = await native.sign.verify({ sign: u.sign, content: u.contentXml });
        const same = u.contentXml.length === before.length && u.contentXml.every((b, i) => b === before[i]);
        t.path = orig;
        return { ok: same && v.ok && v.valid && t.sig?.state === 'valid' && !t.dirty, same, valid: v.valid };
      }
      case 'comfort': {
        const t = newDocument('blank');
        await wait(200);
        const ed = t.editor;
        ed.chain().focus().insertContent('istanbul ili ışık').run();
        ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
        runCmd('changeCase', 'upper');
        const up = ed.getText();
        runCmd('changeCase', 'title');
        const title = ed.getText();
        // format painter: bold first word, paint onto the last
        ed.commands.setTextSelection({ from: 1, to: 9 });
        ed.commands.toggleBold();
        ed.commands.setTextSelection(3);
        formatPainter(app);
        const L = ed.state.doc.content.size - 1;
        ed.commands.setTextSelection({ from: L - 4, to: L });
        ed.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await wait(50);
        const lastBold = ed.state.doc.rangeHasMark(L - 4, L, ed.schema.marks.bold);
        const ok = up === 'İSTANBUL İLİ IŞIK' && title === 'İstanbul İli Işık' && lastBold && !app.painter;
        return { ok, up, title, lastBold };
      }
      case 'ctxmenu': {
        const ed = app.ed();
        ed.commands.focus();
        contextMenu(app, { x: 520, y: 420, isEditable: true, selectionText: '', misspelledWord: 'mahkme', suggestions: ['mahkeme', 'mahkum'], canCut: false, canCopy: false, canPaste: true });
        await wait(100);
        const n = document.querySelectorAll('.menu .mi').length;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const left = document.querySelectorAll('.menu').length;
        return { ok: n >= 8 && left === 0, items: n, left };
      }
      case 'dark': {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        app._prevTheme = app.theme;
        await setTheme(app, 'dark');
        ribbon.show('view');
        await wait(300);
        const bg = getComputedStyle(document.body).backgroundColor;
        return { ok: bg !== 'rgb(244, 244, 245)', bg };
      }
      case 'theme-restore': await setTheme(app, app._prevTheme || 'system'); ribbon.show('home'); return { ok: true };
      case 'ui-insert': case 'ui-layout': case 'ui-review': case 'ui-sign': case 'ui-uyap': case 'ui-view':
        ribbon.show(step.slice(3));
        await wait(500);
        return { ok: ribbon.current() === step.slice(3), current: ribbon.current(), head: document.querySelector('#ribbon-tabs .active')?.textContent };
      case 'backstage': ribbon.show('home'); backstage('new'); return { ok: true };
      case 'welcome': {
        $('#backstage').classList.add('hidden');
        for (const t of [...app.tabs]) { t.dirty = false; t.reviewDirty = false; await closeTab(t); }
        return { ok: !$('#welcome').classList.contains('hidden') };
      }
      case 'debug': {
        const t = app.active;

        const st = paginationKey.getState(t.editor.state);
        const sp = [...t.sheet.querySelectorAll('.page-spacer')].map((e) => ({ h: Math.round(e.getBoundingClientRect().height), inP: e.parentElement.tagName, top: Math.round(e.getBoundingClientRect().top) }));
        return { ok: true, pages: t.pages, breaks: st.breaks.map((b) => [b.pos, Math.round(b.fill)]), sp, sheetH: t.sheet.offsetHeight, scrollTop: t.host.scrollTop, docSize: t.editor.state.doc.content.size };
      }
      case 'template': {
        const t = newDocument('dava');
        await wait(600);
        return { ok: t.pages >= 1 && t.editor.getText().includes('SONUÇ VE İSTEM'), pages: t.pages };
      }
      case 'long': {
        const P = (text, attrs = {}) => ({ type: 'paragraph', attrs: { ...defaultParaAttrs(), align: 'justify', lineSpacing: 0.5, firstLineIndent: 35.4, ...attrs }, content: [{ type: 'text', text }] });
        const lorem = 'Davacı ile davalı arasında akdedilen sözleşme uyarınca davalı şirketin edimlerini zamanında ve gereği gibi ifa etmediği, ihtarnameye rağmen temerrüdün devam ettiği ve bu nedenle müvekkilin uğradığı zararın tazmini gerektiği açıktır. ';
        const content = [P('İSTANBUL ANADOLU 3. ASLİYE TİCARET MAHKEMESİ', { align: 'center', firstLineIndent: 0 })];
        for (let i = 0; i < 40; i++) content.push(P(lorem.repeat(1 + (i % 4)), i % 7 === 3 ? { list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_DOT', id: '1', level: 1 }, leftIndent: 25, firstLineIndent: -18 } : {}));
        const meta = newDocMeta();
        meta.footer = { attrs: { 'pageNumber-spec': 'BSP32_72', 'pageNumber-seperator': '/' }, content: [{ type: 'paragraph', attrs: defaultParaAttrs() }] };
        const t = newTab({ title: 'Uzun belge', doc: { type: 'doc', content }, meta });
        await wait(1200);
        const spacers = t.sheet.querySelectorAll('.page-spacer').length;
        t.host.scrollTop = t.geom.pageH * app.zoom * 0.82;
        return { ok: t.pages >= 3 && spacers === t.pages - 1, pages: t.pages, spacers };
      }
      case 'format': {
        const ed = app.ed();
        ed.commands.setTextSelection({ from: 1, to: 30 });
        ed.commands.toggleBold();
        ed.commands.setFontSize('14pt');
        ed.commands.setTextSelection(60);
        ed.commands.toggleUdfList('bullet');
        await wait(300);
        const j = ed.getJSON();
        const first = j.content[0].content[0];
        return { ok: first.marks?.some((m) => m.type === 'bold') && j.content.some((p) => p.attrs?.list?.kind === 'bullet'), marks: first.marks };
      }
      case 'roundtrip': {
        const t = app.active;
        const xml = serializeUdfXml(t.editor.getJSON(), t.meta);
        const back = parseUdfXml(xml);
        const p = `${out}${sep}smoke.udf`;
        await native.writeFile(p, writeUdf({ contentXml: xml }));
        const again = parseUdfXml(readUdf(await native.readFile(p)).contentText);
        const ok = docText(back.doc) === docText(t.editor.getJSON()) && JSON.stringify(again.doc) === JSON.stringify(back.doc);
        return { ok, chars: xml.length };
      }
      case 'pdf': {
        const bytes = await makePdf(app.active);
        await native.writeFile(`${out}${sep}smoke.pdf`, bytes);
        return { ok: bytes.length > 2000 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-', bytes: bytes.length };
      }
      case 'signdialog': {
        signDialog(app, app.active);
        await wait(2500);
        const drivers = [...document.querySelectorAll('#sg-driver option')].map((o) => o.textContent);
        const certs = document.querySelectorAll('.cert').length;
        const msg = document.querySelector('#sg-msg')?.textContent || '';
        return { ok: true, drivers, certs, msg };
      }
      case 'real': {
        const sample = recents().find((r) => /\.udf$/i.test(r.path) && !r.path.includes('smoke'));
        if (!sample) return { ok: true, skipped: true };
        const t = await openPath(sample.path);
        await wait(1500);
        if (t) await native.writeFile(`${out}${sep}real.pdf`, await makePdf(t));
        return { ok: !!t, pages: t?.pages, signed: t?.sig?.state || 'none' };
      }
      case 'real-scroll': { // second screenshot of the real sample, one page further down
        const t = app.active;
        if (!t?.path) return { ok: true, skipped: true };
        t.host.scrollTop = t.geom.pageH * app.zoom * 0.45;
        await wait(300);
        const sp = [...t.sheet.querySelectorAll('.page-spacer, .pg-row-break')].map((e) => ({ h: Math.round(e.dataset.pgH || e.getBoundingClientRect().height), in: e.tagName }));
        // nested tables must fit their cell (overflow = clipped text)
        const overflow = [...t.sheet.querySelectorAll('td table')].map((tb) => Math.round(tb.offsetWidth - tb.closest('.tableWrapper').parentElement.clientWidth)).filter((d) => d > 0);
        return { ok: !overflow.length, pages: t.pages, sp, overflow, sheetH: t.sheet.offsetHeight };
      }
      default: return { ok: false, error: 'unknown step' };
    }
  },
};

// ================================================================== boot

(async function boot() {
  wireChrome();
  ribbon = createRibbon(app);
  try { const st = await native.settings.get(); app.profile = st.profile || {}; app.theme = st.theme || 'system'; app.userStyles = st.userStyles || []; } catch {}
  try { app.ac = { enabled: true, quotes: true, capitalize: true, dashes: true, list: { ...DEFAULT_AUTOCORRECT }, ...JSON.parse(localStorage.getItem('udf.ac') || '{}') }; } catch { app.ac = { enabled: true, quotes: true, capitalize: true, dashes: true, list: { ...DEFAULT_AUTOCORRECT } }; }
  renderWelcome();
  if (!(await native.info()).smoke) setTimeout(offerRecovery, 600);
  activate(null);
})();
