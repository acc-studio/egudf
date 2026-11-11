// Ribbon: declarative tabs → HTML; one delegated click handler runs commands
// by name (data-cmd / data-arg) through app.run().
import { icon } from './icons.js';
import { $, $$, esc } from './ui.js';

export const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Tahoma', 'Verdana', 'Georgia', 'Garamond', 'Book Antiqua', 'Century Schoolbook', 'Courier New', 'Segoe UI'];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];

export const PARA_STYLES = [
  { id: 'normal', name: 'Normal', prev: 'AaBbÇç', para: { align: 'left', firstLineIndent: 0, leftIndent: 0, lineSpacing: 0, spaceAbove: 0, spaceBelow: 0 }, marks: { bold: false, italic: false, size: null } },
  { id: 'govde', name: 'Gövde', prev: 'AaBbÇç', para: { align: 'justify', firstLineIndent: 35.4, lineSpacing: 0.5, spaceAbove: 0, spaceBelow: 0 }, marks: { bold: false, italic: false, size: null } },
  { id: 'mahkeme', name: 'Mahkeme', prev: 'MAHKEME', css: 'font-weight:700', para: { align: 'center', firstLineIndent: 0, leftIndent: 0, spaceBelow: 12 }, marks: { bold: true, upper: true } },
  { id: 'baslik', name: 'Başlık', prev: 'BAŞLIK', css: 'font-weight:700', para: { align: 'justify', firstLineIndent: 0, spaceAbove: 6, spaceBelow: 3 }, marks: { bold: true, upper: true } },
  { id: 'altbaslik', name: 'Alt başlık', prev: 'Alt Başlık', css: 'font-weight:700', para: { align: 'justify', firstLineIndent: 0, spaceAbove: 3 }, marks: { bold: true } },
  { id: 'alinti', name: 'Alıntı', prev: '“Alıntı”', css: 'font-style:italic', para: { align: 'justify', leftIndent: 35.4, rightIndent: 35.4, firstLineIndent: 0 }, marks: { italic: true } },
  { id: 'imza', name: 'İmza', prev: 'Av. Ad', css: 'text-align:right', para: { align: 'right', firstLineIndent: 0 }, marks: {} },
];

const big = (cmd, ic, label, { cls = '', arg = '', title = '', id = '' } = {}) =>
  `<button class="rb big ${cls}" data-cmd="${cmd}" data-arg="${esc(arg)}" title="${esc(title || label)}" ${id ? `id="${id}"` : ''}>${icon(ic)}<span>${label}</span></button>`;
const btn = (cmd, ic, title, { arg = '', label = '', cls = '' } = {}) =>
  `<button class="rb ${label ? '' : 'icon'} ${cls}" data-cmd="${cmd}" data-arg="${esc(arg)}" title="${esc(title)}">${icon(ic)}${label ? `<span>${label}</span>` : ''}</button>`;
const split = (cmd, ic, title, menuCmd, { arg = '', cls = '' } = {}) =>
  `<span class="split">${btn(cmd, ic, title, { arg, cls })}<button class="rb" data-cmd="${menuCmd}" title="${esc(title)} seçenekleri">${icon('chevron', 'caret')}</button></span>`;
const group = (label, body, cls = '') => `<div class="rgroup ${cls}"><div class="rgroup-body">${body}</div><div class="rgroup-label">${label}</div></div>`;
const col = (...rows) => `<div class="rcol">${rows.map((r) => `<div class="rrow">${r}</div>`).join('')}</div>`;

const TABS = {
  home: () => [
    group('Pano', big('paste', 'paste', 'Yapıştır', { title: 'Yapıştır (Ctrl+V)' }) + col(btn('cut', 'cut', 'Kes (Ctrl+X)', { label: 'Kes' }), btn('copy', 'copy', 'Kopyala (Ctrl+C)', { label: 'Kopyala' }), btn('formatPainter', 'painter', 'Biçim boyacısı — çift tıklayınca açık kalır', { label: 'Biçim boyacısı' }))),
    group('Yazı Tipi', col(
      `<select class="rsel font" data-input="fontFamily" title="Yazı tipi">${FONTS.map((f) => `<option style="font-family:'${f}'">${f}</option>`).join('')}</select>`
        + `<select class="rsel size" data-input="fontSize" title="Yazı boyutu">${SIZES.map((s) => `<option>${s}</option>`).join('')}</select>`
        + btn('growFont', 'growFont', 'Yazıyı büyüt (Ctrl+Shift+>)') + btn('shrinkFont', 'shrinkFont', 'Yazıyı küçült (Ctrl+Shift+<)') + btn('changeCaseMenu', 'case', 'Büyük/küçük harf (Shift+F3)') + btn('clearFormat', 'clear', 'Biçimi temizle (Ctrl+Space)'),
      btn('bold', 'bold', 'Kalın (Ctrl+B)') + btn('italic', 'italic', 'İtalik (Ctrl+I)') + btn('underline', 'underline', 'Altı çizili (Ctrl+U)') + btn('strike', 'strike', 'Üstü çizili')
        + btn('subscript', 'sub', 'Alt simge') + btn('superscript', 'sup', 'Üst simge')
        + split('color', 'color', 'Yazı rengi', 'colorMenu', { cls: 'swatch-color' }) + split('highlight', 'highlight', 'Vurgu rengi', 'highlightMenu', { cls: 'swatch-hl' }),
    )),
    group('Paragraf', col(
      split('bullets', 'bullets', 'Madde işaretleri', 'bulletsMenu') + split('numbers', 'numbers', 'Numaralandırma', 'numbersMenu')
        + btn('outdent', 'outdent', 'Girintiyi azalt') + btn('indent', 'indent', 'Girintiyi artır') + btn('marks', 'pilcrow', 'Biçimlendirme işaretlerini göster'),
      btn('align', 'alignLeft', 'Sola hizala (Ctrl+L)', { arg: 'left' }) + btn('align', 'alignCenter', 'Ortala (Ctrl+E)', { arg: 'center' })
        + btn('align', 'alignRight', 'Sağa hizala (Ctrl+R)', { arg: 'right' }) + btn('align', 'alignJustify', 'İki yana yasla (Ctrl+J)', { arg: 'justify' })
        + btn('lineSpacingMenu', 'lineSpacing', 'Satır ve paragraf aralığı') + btn('firstLine', 'indent', 'İlk satır girintisi (1,25 cm)', { label: '' }) + btn('paragraphDialog', 'page', 'Paragraf ayarları…'),
    )),
    group('Stiller', `<div class="gallery">${PARA_STYLES.map((s) => `<div class="gi" data-cmd="style" data-arg="${s.id}" title="${esc(s.name)} stilini uygula"><div class="prev" style="${s.css || ''}">${esc(s.prev)}</div><div class="nm">${esc(s.name)}</div></div>`).join('')}</div>`, 'shrink'),
    group('Düzenleme', col(btn('find', 'search', 'Bul (Ctrl+F)', { label: 'Bul' }), btn('replace', 'replace', 'Değiştir (Ctrl+H)', { label: 'Değiştir' }), btn('selectAll', 'page', 'Tümünü seç (Ctrl+A)', { label: 'Tümünü seç' }))),
  ],
  insert: () => [
    group('Tablolar', big('tableMenu', 'table', 'Tablo')),
    group('Çizimler', big('image', 'image', 'Resim')),
    group('Metin', big('dateMenu', 'date', 'Tarih') + big('symbolMenu', 'symbol', 'Simge') + big('blockMenu', 'block', 'Hazır<br>bloklar')),
    group('Belge', big('newFromTemplate', 'template', 'Şablondan<br>yeni')),
  ],
  layout: () => [
    group('Sayfa Yapısı', big('marginsMenu', 'margins', 'Kenar<br>boşlukları') + big('orientationMenu', 'orientation', 'Yönlendirme') + big('pageSetup', 'page', 'Sayfa<br>yapısı')),
    group('Üst ve Alt Bilgi', big('headerFooter', 'header', 'Üst/Alt<br>bilgi') + big('pageNumbers', 'pageNumber', 'Sayfa<br>numarası', { id: 'rb-pagenums' })),
    group('Paragraf', col(
      `<label class="dim small" style="width:58px">Sol</label><input class="rsel" style="width:64px" type="number" step="0.25" min="0" data-para="leftIndent" title="Sol girinti (cm)"><label class="dim small" style="width:54px;padding-left:8px">Önce</label><input class="rsel" style="width:60px" type="number" step="1" min="0" data-para="spaceAbove" title="Paragraftan önce (nk)">`,
      `<label class="dim small" style="width:58px">Sağ</label><input class="rsel" style="width:64px" type="number" step="0.25" min="0" data-para="rightIndent" title="Sağ girinti (cm)"><label class="dim small" style="width:54px;padding-left:8px">Sonra</label><input class="rsel" style="width:60px" type="number" step="1" min="0" data-para="spaceBelow" title="Paragraftan sonra (nk)">`,
      `<label class="dim small" style="width:58px">İlk satır</label><input class="rsel" style="width:64px" type="number" step="0.25" data-para="firstLineIndent" title="İlk satır girintisi (cm, asılı için eksi)">`,
    )),
  ],
  sign: () => [
    group('Elektronik İmza', big('sign', 'sign', 'E-İmza ile<br>imzala', { cls: 'ok' }) + big('signInfo', 'verify', 'İmza<br>bilgisi')),
    group('Ayarlar', big('driverSettings', 'card', 'Kart<br>sürücüsü') + big('profile', 'user', 'Avukat<br>bilgilerim')),
  ],
  uyap: () => [
    group('UYAP Avukat Portal', big('uyapOpen', 'globe', 'Portalı aç') + big('uyapSend', 'upload', 'İmzala ve<br>gönder', { cls: 'accent' }) + big('uyapAttach', 'attach', 'Yükleme<br>alanına ekle')),
    group('Dosya', big('showInFolder', 'folder', 'Klasörde<br>göster') + big('uyapSettings', 'globe', 'Portal<br>adresi')),
  ],
  review: () => [
    group('Yorumlar', big('commentNew', 'comment', 'Yeni<br>yorum', { title: 'Yeni yorum (Ctrl+Alt+M)' }) + col(
      btn('commentPrev', 'chevron', 'Önceki yorum', { label: 'Önceki', cls: 'flip' }) + btn('commentNext', 'chevron', 'Sonraki yorum', { label: 'Sonraki' }),
      btn('commentDelete', 'reject', 'Bu yorumu sil', { label: 'Sil' }) + btn('commentDeleteAll', 'tableDel', 'Belgedeki tüm yorumları sil', { label: 'Tümünü sil' }),
      btn('reviewPane', 'nav', 'Gözden geçirme bölmesi', { label: 'Bölmeyi göster' }),
    )),
    group('İzleme', big('trackToggle', 'track', 'Değişiklikleri<br>izle', { title: 'Değişiklikleri izle (Ctrl+Shift+E)' }) + col(
      btn('markup', 'pilcrow', 'Tüm işaretleri göster', { arg: 'all', label: 'Tüm işaretler' }),
      btn('markup', 'page', 'Değişiklikleri kabul edilmiş gibi göster', { arg: 'none', label: 'İşaretsiz' }),
    )),
    group('Değişiklikler', `<span class="split vsplit">${big('acceptChange', 'accept', 'Kabul et', { cls: 'okc' })}<button class="rb" data-cmd="acceptMenu" title="Kabul seçenekleri">${icon('chevron', 'caret')}</button></span>`
      + `<span class="split vsplit">${big('rejectChange', 'reject', 'Reddet', { cls: 'badc' })}<button class="rb" data-cmd="rejectMenu" title="Ret seçenekleri">${icon('chevron', 'caret')}</button></span>`
      + col(btn('changePrev', 'chevron', 'Önceki değişiklik', { label: 'Önceki', cls: 'flip' }), btn('changeNext', 'chevron', 'Sonraki değişiklik', { label: 'Sonraki' }))),
    group('Yazım', big('spellcheck', 'spell', 'Yazım<br>denetimi', { title: 'Yazım denetimini aç/kapat' })),
  ],
  view: () => [
    group('Göster', big('ruler', 'ruler', 'Cetvel') + big('toggleNav', 'nav', 'Gezinti<br>bölmesi', { id: 'rb-nav' }) + big('marks', 'pilcrow', 'Biçim<br>işaretleri', { id: 'rb-marks' }) + big('focusMode', 'focus', 'Odak<br>modu')),
    group('Tema', big('theme', 'monitor', 'Sistem', { arg: 'system', title: 'Windows temasını izle' }) + big('theme', 'sun', 'Açık', { arg: 'light' }) + big('theme', 'theme', 'Koyu', { arg: 'dark' })),
    group('Yardım', big('shortcuts', 'key', 'Klavye<br>kısayolları') + big('wordCount', 'info', 'Sözcük<br>sayısı')),
    group('Yakınlaştır', big('zoom', 'zoomIn', '%100', { arg: '1' }) + big('zoomFit', 'page', 'Sayfa<br>genişliği') + big('zoom', 'zoomOut', '%75', { arg: '0.75' })),
    group('egPDF', big('openEgpdf', 'egpdf', 'egPDF\'te<br>aç') + big('exportPdf', 'pdf', 'PDF olarak<br>kaydet')),
  ],
  table: () => [
    group('Satırlar ve Sütunlar', col(
      btn('table', 'rowAdd', 'Üste satır ekle', { arg: 'addRowBefore', label: 'Üste ekle' }) + btn('table', 'rowAdd', 'Alta satır ekle', { arg: 'addRowAfter', label: 'Alta ekle' }),
      btn('table', 'colAdd', 'Sola sütun ekle', { arg: 'addColumnBefore', label: 'Sola ekle' }) + btn('table', 'colAdd', 'Sağa sütun ekle', { arg: 'addColumnAfter', label: 'Sağa ekle' }),
    )),
    group('Sil', col(
      btn('table', 'rowDel', 'Satırı sil', { arg: 'deleteRow', label: 'Satır' }) + btn('table', 'colDel', 'Sütunu sil', { arg: 'deleteColumn', label: 'Sütun' }),
      btn('table', 'tableDel', 'Tabloyu sil', { arg: 'deleteTable', label: 'Tablo' }),
    )),
    group('Birleştir', col(btn('table', 'merge', 'Hücreleri birleştir', { arg: 'mergeCells', label: 'Birleştir' }), btn('table', 'merge', 'Hücreyi böl', { arg: 'splitCell', label: 'Böl' }))),
    group('Kenarlık', big('tableBorder', 'border', 'Kenarlıkları<br>aç/kapat')),
  ],
};

const TAB_LABELS = [['file', 'Dosya'], ['home', 'Giriş'], ['insert', 'Ekle'], ['layout', 'Düzen'], ['review', 'Gözden Geçir'], ['sign', 'İmza'], ['uyap', 'UYAP'], ['view', 'Görünüm']];

export function createRibbon(app) {
  const head = $('#ribbon-tabs');
  const body = $('#ribbon');
  let current = 'home';
  let inTable = false;

  function renderHead() {
    head.innerHTML = TAB_LABELS.map(([k, l]) => `<button data-tab="${k}" class="${k === 'file' ? 'file-tab' : ''} ${k === current ? 'active' : ''}">${l}</button>`).join('')
      + (inTable ? `<button data-tab="table" class="contextual ${current === 'table' ? 'active' : ''}">Tablo</button>` : '');
  }
  function show(tab) {
    if (tab === 'file') { app.run('backstage'); return; }
    if (tab === 'table' && !inTable) tab = 'home';
    current = tab;
    renderHead();
    body.innerHTML = TABS[tab]().join('');
    refresh();
  }
  head.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });
  body.addEventListener('mousedown', (e) => {
    // keep the editor selection when clicking buttons (not form fields)
    if (e.target.closest('[data-cmd]') && !e.target.closest('select,input')) e.preventDefault();
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b || b.disabled) return;
    app.run(b.dataset.cmd, b.dataset.arg, b);
  });
  body.addEventListener('dblclick', (e) => {
    const b = e.target.closest('[data-cmd=formatPainter]');
    if (b && !app.painter?.sticky) { if (app.painter) app.run('formatPainter'); app.run('formatPainter', 'sticky', b); }
  });
  body.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.input) app.run(el.dataset.input, el.value, el);
    if (el.dataset.para) app.run('paraField', { field: el.dataset.para, value: el.value }, el);
  });

  function refresh() {
    const ed = app.ed();
    const has = !!ed;
    const nowInTable = !!ed?.isActive('table');
    if (nowInTable !== inTable) {
      inTable = nowInTable;
      if (!inTable && current === 'table') { show('home'); return; }
      renderHead();
    }
    $$('[data-cmd]', body).forEach((b) => {
      const c = b.dataset.cmd;
      const docless = ['newFromTemplate', 'uyapOpen', 'driverSettings', 'profile', 'toggleNav', 'focusMode', 'uyapSettings', 'marks', 'theme', 'shortcuts', 'ruler'].includes(c);
      if (b.tagName === 'BUTTON') b.disabled = !has && !docless;
      if (!ed) { b.classList.remove('active'); return; }
      let on = false;
      const a = b.dataset.arg;
      const p = ed.getAttributes('paragraph');
      switch (c) {
        case 'bold': case 'italic': case 'underline': case 'strike': case 'subscript': case 'superscript': on = ed.isActive(c); break;
        case 'align': on = (p.align || 'left') === a; break;
        case 'bullets': on = p.list?.kind === 'bullet'; break;
        case 'numbers': on = p.list?.kind === 'number'; break;
        case 'firstLine': on = (p.firstLineIndent || 0) > 0; break;
        case 'marks': on = document.body.classList.contains('show-marks'); break;
        case 'theme': on = (app.theme || 'system') === a; break;
        case 'formatPainter': on = !!app.painter; break;
        case 'reviewPane': on = !$('#review-pane').classList.contains('hidden'); break;
        case 'spellcheck': on = app.spell !== false; break;
        case 'ruler': on = !!app.showRuler; break;
        case 'trackToggle': on = !!ed.storage.trackChanges?.enabled; break;
        case 'markup': on = (document.body.classList.contains('hide-markup') ? 'none' : 'all') === a; break;
        case 'toggleNav': on = !$('#nav-pane').classList.contains('hidden'); break;
        case 'pageNumbers': on = !!app.tab()?.meta.footer?.attrs?.['pageNumber-spec']; break;
        default:
      }
      b.classList.toggle('active', on);
    });
    if (!ed) return;
    const ts = ed.getAttributes('textStyle');
    const base = app.tab()?.meta.base || { family: 'Times New Roman', size: 12 };
    const fam = (ts.fontFamily || base.family).replace(/["']/g, '').split(',')[0].trim();
    const size = ts.fontSize ? String(Math.round(parseFloat(ts.fontSize) * (String(ts.fontSize).endsWith('px') ? 0.75 : 1) * 2) / 2) : String(base.size);
    const fs = $('[data-input=fontFamily]', body);
    if (fs) {
      if (![...fs.options].some((o) => o.value === fam)) fs.append(new Option(fam, fam));
      if (document.activeElement !== fs) fs.value = fam;
    }
    const ss = $('[data-input=fontSize]', body);
    if (ss) {
      if (![...ss.options].some((o) => o.value === size)) ss.append(new Option(size, size));
      if (document.activeElement !== ss) ss.value = size;
    }
    const p = ed.getAttributes('paragraph');
    $$('[data-para]', body).forEach((inp) => {
      if (document.activeElement === inp) return;
      const v = p[inp.dataset.para] || 0;
      inp.value = /Indent/.test(inp.dataset.para) ? (v / 28.3465).toFixed(2).replace(/\.?0+$/, '') || '0' : String(Math.round(v * 10) / 10);
    });
    const sc = $('.swatch-color', body);
    if (sc) sc.style.setProperty('--swatch', app.lastColor);
    const sh = $('.swatch-hl', body);
    if (sh) sh.style.setProperty('--swatch', app.lastHighlight);
  }

  show('home');
  return { show, refresh, current: () => current };
}
