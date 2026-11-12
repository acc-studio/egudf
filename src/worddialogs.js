// Word's Paragraph and Font dialogs.
//
// Everything the editor model holds can be set here: indents (first line /
// hanging), spacing, line spacing (single, 1.5, double, multiple, at least,
// exactly), line and page breaks, tab stops with alignment and leaders, paragraph
// borders and shading; font, size, colour, effects (small caps, all caps, double
// strikethrough…) and character spacing. In a .udf the options UYAP can't show are
// disabled with a note, so nothing silently disappears on save.
import { $, $$, h, esc, modal } from './ui.js';

const CM = 28.3465;
const cm = (pt) => String(Math.round(((pt || 0) / CM) * 100) / 100);
const UDF_NOTE = '<span class="wd-udf">UYAP belgesinde yok</span>';

function tabsUI(body) {
  const bar = $('.wd-tabs', body);
  bar.onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    $$('[data-tab]', bar).forEach((x) => x.classList.toggle('active', x === b));
    $$('.wd-pane', body).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
  };
}

const LEADERS = [['0', 'Yok'], ['1', '.......'], ['2', '-------'], ['3', '______']];
const ALIGNS = [['0', 'Sol'], ['2', 'Orta'], ['1', 'Sağ'], ['4', 'Ondalık']];

export function paragraphDialog(app, tab, ed) {
  const word = tab.format === 'docx';
  const p = ed.getAttributes('paragraph');
  const fl = p.firstLineIndent || 0;
  const lsMode = p.lineRule === 'exact' ? 'exact' : p.lineRule === 'atLeast' ? 'atLeast' : !p.lineSpacing ? 'single' : Math.abs(p.lineSpacing - 0.5) < 0.01 ? 'onehalf' : Math.abs(p.lineSpacing - 1) < 0.01 ? 'double' : 'multiple';
  const lsVal = p.lineRule ? p.lineHeight || 12 : Math.round((1 + (p.lineSpacing || 0)) * 100) / 100;
  const stops = String(p.tabSet || '').split(',').map((t) => t.split(':')).filter((t) => parseFloat(t[0]) > 0);
  const bd = p.border || {};
  const bAny = bd.top || bd.bottom || bd.left || bd.right;
  const opt = (list, v) => list.map(([k, l]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${l}</option>`).join('');
  const dis = word ? '' : 'disabled';
  const body = h(`<div class="wd">
    <div class="wd-tabs"><button data-tab="ind" class="active">Girintiler ve aralıklar</button><button data-tab="brk">Satır ve sayfa sonları</button><button data-tab="tabs">Sekmeler</button><button data-tab="bdr">Kenarlık ve gölge</button></div>
    <div class="wd-pane" data-pane="ind">
      <div class="field-row"><div class="field"><label>Hizalama</label><select id="pd-align">${opt([['left', 'Sola'], ['center', 'Ortala'], ['right', 'Sağa'], ['justify', 'İki yana yasla']], p.align || 'left')}</select></div></div>
      <h3 class="sec">Girinti</h3>
      <div class="field-row">
        <div class="field"><label>Sol (cm)</label><input type="number" step="0.25" id="pd-l" value="${cm(p.leftIndent)}"></div>
        <div class="field"><label>Sağ (cm)</label><input type="number" step="0.25" id="pd-r" value="${cm(p.rightIndent)}"></div>
        <div class="field"><label>Özel</label><select id="pd-sp">${opt([['none', '(yok)'], ['first', 'İlk satır'], ['hang', 'Asılı']], fl > 0 ? 'first' : fl < 0 ? 'hang' : 'none')}</select></div>
        <div class="field"><label>Değer (cm)</label><input type="number" step="0.25" min="0" id="pd-spv" value="${cm(Math.abs(fl))}"></div>
      </div>
      <h3 class="sec">Aralık</h3>
      <div class="field-row">
        <div class="field"><label>Önce (nk)</label><input type="number" step="1" min="0" id="pd-a" value="${p.spaceAbove || 0}"></div>
        <div class="field"><label>Sonra (nk)</label><input type="number" step="1" min="0" id="pd-b" value="${p.spaceBelow || 0}"></div>
        <div class="field"><label>Satır aralığı</label><select id="pd-ls">${opt([['single', 'Tek'], ['onehalf', '1,5 satır'], ['double', 'Çift'], ['multiple', 'Birden çok'], ...(word ? [['atLeast', 'En az'], ['exact', 'Tam']] : [])], lsMode)}</select></div>
        <div class="field"><label>Değer</label><input type="number" step="0.05" min="0" id="pd-lsv" value="${lsVal}"></div>
      </div>
      ${word ? '' : '<p class="note">UYAP belgelerinde "En az" ve "Tam" satır aralığı yoktur.</p>'}
    </div>
    <div class="wd-pane hidden" data-pane="brk">
      <label class="chk"><input type="checkbox" id="pd-wc" ${p.widowControl !== false ? 'checked' : ''} ${dis}> Dul/öksüz satır denetimi</label>
      <label class="chk"><input type="checkbox" id="pd-kn" ${p.keepNext ? 'checked' : ''} ${dis}> Sonrakiyle birlikte tut</label>
      <label class="chk"><input type="checkbox" id="pd-kl" ${p.keepLines ? 'checked' : ''} ${dis}> Satırları birlikte tut</label>
      <label class="chk"><input type="checkbox" id="pd-pb" ${p.pageBreakBefore ? 'checked' : ''} ${dis}> Önce sayfa sonu</label>
      ${word ? '' : `<p class="note">${UDF_NOTE}: UYAP sayfa sonu ve bu kuralları desteklemez; sayfalar UYAP'ın kendi düzeniyle bölünür.</p>`}
    </div>
    <div class="wd-pane hidden" data-pane="tabs">
      <div class="wd-stops"></div>
      <button class="btn small-btn" id="pd-addtab">+ Sekme durağı</button>
      ${word ? `<div class="field-row" style="margin-top:10px"><div class="field"><label>Varsayılan sekme aralığı (cm)</label><input type="number" step="0.25" min="0.25" id="pd-deftab" value="${cm(tab.meta.defaultTab || 35.4)}"></div></div>` : '<p class="note">UYAP sekme dolgu karakterlerini (.......) göstermez.</p>'}
    </div>
    <div class="wd-pane hidden" data-pane="bdr">
      <div class="field-row">
        <label class="chk"><input type="checkbox" id="pd-bt" ${bd.top ? 'checked' : ''} ${dis}> Üst</label>
        <label class="chk"><input type="checkbox" id="pd-bb" ${bd.bottom ? 'checked' : ''} ${dis}> Alt</label>
        <label class="chk"><input type="checkbox" id="pd-bl" ${bd.left ? 'checked' : ''} ${dis}> Sol</label>
        <label class="chk"><input type="checkbox" id="pd-br" ${bd.right ? 'checked' : ''} ${dis}> Sağ</label>
      </div>
      <div class="field-row">
        <div class="field"><label>Çizgi</label><select id="pd-bs" ${dis}>${opt([['solid', 'Düz'], ['double', 'Çift'], ['dotted', 'Noktalı'], ['dashed', 'Kesikli']], bAny?.style || 'solid')}</select></div>
        <div class="field"><label>Kalınlık (nk)</label><input type="number" step="0.25" min="0.25" id="pd-bw" value="${bAny?.width || 0.5}" ${dis}></div>
        <div class="field"><label>Renk</label><input type="color" id="pd-bc" value="${bAny?.color || '#000000'}" ${dis}></div>
      </div>
      <div class="field-row"><label class="chk"><input type="checkbox" id="pd-sh" ${p.shading ? 'checked' : ''} ${dis}> Gölgelendirme</label><input type="color" id="pd-shc" value="${p.shading || '#d9d9d9'}" ${dis}></div>
      ${word ? '' : `<p class="note">${UDF_NOTE}: paragraf kenarlığı ve gölgelendirme UYAP biçiminde saklanamaz.</p>`}
    </div></div>`);
  tabsUI(body);
  const stopsEl = $('.wd-stops', body);
  const addStop = (pos = '', al = '0', ld = '0') => {
    const row = h(`<div class="field-row wd-stop"><div class="field"><label>Konum (cm)</label><input type="number" step="0.25" min="0" class="st-pos" value="${pos}"></div><div class="field"><label>Hizalama</label><select class="st-al">${opt(ALIGNS, al)}</select></div><div class="field"><label>Dolgu</label><select class="st-ld" ${word ? '' : 'disabled'}>${opt(LEADERS, ld)}</select></div><button class="icon-btn st-del" title="Kaldır">✕</button></div>`);
    $('.st-del', row).onclick = () => row.remove();
    stopsEl.append(row);
  };
  for (const [pp, al, ld] of stops) addStop(cm(parseFloat(pp)), al || '0', ld || '0');
  $('#pd-addtab', body).onclick = () => addStop();
  modal({
    title: 'Paragraf', icon: 'lineSpacing', body, width: 640,
    actions: [{ label: 'İptal' }, { label: 'Uygula', kind: 'primary', onClick: () => {
      const n = (id) => parseFloat($(id, body)?.value) || 0;
      const chk = (id) => !!$(id, body)?.checked;
      const special = $('#pd-sp', body).value;
      const spv = Math.max(0, n('#pd-spv')) * CM;
      const mode = $('#pd-ls', body).value, v = n('#pd-lsv');
      const ls = { single: [0, null, null], onehalf: [0.5, null, null], double: [1, null, null], multiple: [Math.max(0, v - 1), null, null], atLeast: [0, 'atLeast', v], exact: [0, 'exact', v] }[mode];
      const stopsOut = $$('.wd-stop', body).map((r) => [parseFloat($('.st-pos', r).value) * CM, $('.st-al', r).value, word ? $('.st-ld', r).value : '0']).filter((s) => s[0] > 0).sort((a, b) => a[0] - b[0]);
      const attrs = {
        align: $('#pd-align', body).value,
        leftIndent: Math.max(0, n('#pd-l')) * CM, rightIndent: Math.max(0, n('#pd-r')) * CM,
        firstLineIndent: special === 'first' ? spv : special === 'hang' ? -spv : 0,
        spaceAbove: Math.max(0, n('#pd-a')), spaceBelow: Math.max(0, n('#pd-b')),
        lineSpacing: ls[0], lineRule: ls[1], lineHeight: ls[2],
        tabSet: stopsOut.length ? stopsOut.map(([pp, al, ld]) => `${Math.round(pp * 100) / 100}:${al}:${ld}`).join(',') : null,
      };
      if (word) {
        Object.assign(attrs, { widowControl: chk('#pd-wc'), keepNext: chk('#pd-kn'), keepLines: chk('#pd-kl'), pageBreakBefore: chk('#pd-pb') });
        const line = { style: $('#pd-bs', body).value, width: Math.max(0.25, n('#pd-bw')), color: $('#pd-bc', body).value, space: 1 };
        const border = {};
        for (const [k, id] of [['top', '#pd-bt'], ['bottom', '#pd-bb'], ['left', '#pd-bl'], ['right', '#pd-br']]) if (chk(id)) border[k] = line;
        attrs.border = Object.keys(border).length ? border : null;
        attrs.shading = chk('#pd-sh') ? $('#pd-shc', body).value : null;
        const dt = n('#pd-deftab');
        if (dt > 0 && Math.abs(dt * CM - (tab.meta.defaultTab || 35.4)) > 0.5) { tab.meta.defaultTab = dt * CM; ed.view.dom.__retab?.(); }
      }
      ed.chain().focus().setParagraphAttrs(attrs).run();
      ed.view.dom.__retab?.();
    } }],
  });
  return body;
}

const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Aptos', 'Georgia', 'Garamond', 'Book Antiqua', 'Century Schoolbook', 'Tahoma', 'Verdana', 'Segoe UI', 'Courier New', 'Trebuchet MS', 'Palatino Linotype'];

export function fontDialog(app, tab, ed) {
  const word = tab.format === 'docx';
  const ts = ed.getAttributes('textStyle');
  const base = tab.meta.base || { family: 'Times New Roman', size: 12 };
  const fam = String(ts.fontFamily || base.family).split(',')[0].replace(/["']/g, '');
  const size = parseFloat(ts.fontSize) || base.size;
  const on = (m) => ed.isActive(m);
  const dis = word ? '' : 'disabled';
  const body = h(`<div class="wd">
    <div class="field-row">
      <div class="field" style="flex:2"><label>Yazı tipi</label><input id="fd-f" list="fd-fonts" value="${esc(fam)}"><datalist id="fd-fonts">${FONTS.map((f) => `<option value="${esc(f)}">`).join('')}</datalist></div>
      <div class="field"><label>Boyut (nk)</label><input type="number" id="fd-s" min="1" max="400" step="0.5" value="${size}"></div>
      <div class="field"><label>Renk</label><input type="color" id="fd-c" value="${ts.color && /^#[0-9a-f]{6}$/i.test(ts.color) ? ts.color : '#000000'}"></div>
    </div>
    <h3 class="sec">Stil ve efektler</h3>
    <div class="wd-checks">
      <label class="chk"><input type="checkbox" id="fd-b" ${on('bold') ? 'checked' : ''}> Kalın</label>
      <label class="chk"><input type="checkbox" id="fd-i" ${on('italic') ? 'checked' : ''}> İtalik</label>
      <label class="chk"><input type="checkbox" id="fd-u" ${on('underline') ? 'checked' : ''}> Altı çizili</label>
      <label class="chk"><input type="checkbox" id="fd-st" ${on('strike') ? 'checked' : ''}> Üstü çizili</label>
      <label class="chk"><input type="checkbox" id="fd-ds" ${ts.dstrike ? 'checked' : ''} ${dis}> Çift üstü çizili</label>
      <label class="chk"><input type="checkbox" id="fd-sup" ${on('superscript') ? 'checked' : ''}> Üst simge</label>
      <label class="chk"><input type="checkbox" id="fd-sub" ${on('subscript') ? 'checked' : ''}> Alt simge</label>
      <label class="chk"><input type="checkbox" id="fd-sc" ${ts.smallCaps ? 'checked' : ''} ${dis}> Küçük büyük harf</label>
      <label class="chk"><input type="checkbox" id="fd-ac" ${ts.allCaps ? 'checked' : ''} ${dis}> Tümü büyük harf</label>
    </div>
    <h3 class="sec">Karakter aralığı</h3>
    <div class="field-row"><div class="field"><label>Aralık (nk, eksi = sıkı)</label><input type="number" step="0.25" id="fd-ls" value="${ts.letterSpacing || 0}" ${dis}></div></div>
    ${word ? '' : `<p class="note">${UDF_NOTE}: çift üstü çizili, küçük/tümü büyük harf ve karakter aralığı UYAP biçiminde saklanamaz.</p>`}
    <div class="wd-preview" id="fd-prev">AaBbÇçĞğ — Örnek metin</div></div>`);
  const preview = () => {
    const pv = $('#fd-prev', body);
    pv.style.fontFamily = `'${$('#fd-f', body).value}'`;
    pv.style.fontSize = `${Math.min(28, parseFloat($('#fd-s', body).value) || size)}pt`;
    pv.style.color = $('#fd-c', body).value;
    pv.style.fontWeight = $('#fd-b', body).checked ? '700' : '400';
    pv.style.fontStyle = $('#fd-i', body).checked ? 'italic' : 'normal';
    pv.style.textDecoration = [$('#fd-u', body).checked ? 'underline' : '', $('#fd-st', body).checked || $('#fd-ds', body).checked ? 'line-through' : ''].join(' ') + ($('#fd-ds', body).checked ? ' double' : '') || 'none';
    pv.style.fontVariant = $('#fd-sc', body).checked ? 'small-caps' : 'normal';
    pv.style.textTransform = $('#fd-ac', body).checked ? 'uppercase' : 'none';
    pv.style.letterSpacing = `${parseFloat($('#fd-ls', body).value) || 0}pt`;
  };
  body.addEventListener('input', preview);
  body.addEventListener('change', preview);
  preview();
  modal({
    title: 'Yazı tipi', icon: 'font', body, width: 560,
    actions: [{ label: 'İptal' }, { label: 'Uygula', kind: 'primary', onClick: () => {
      const chk = (id) => $(id, body).checked;
      let c = ed.chain().focus();
      for (const [m, id] of [['bold', '#fd-b'], ['italic', '#fd-i'], ['underline', '#fd-u'], ['strike', '#fd-st']]) c = chk(id) ? c.setMark(m) : c.unsetMark(m);
      c = chk('#fd-sup') ? c.unsetMark('subscript').setMark('superscript') : c.unsetMark('superscript');
      c = chk('#fd-sub') ? c.unsetMark('superscript').setMark('subscript') : c.unsetMark('subscript');
      const f = $('#fd-f', body).value.trim(), sz = parseFloat($('#fd-s', body).value), col = $('#fd-c', body).value;
      const attrs = {
        fontFamily: f && f !== base.family ? f : null,
        fontSize: sz && sz !== base.size ? `${sz}pt` : null,
        color: col && col !== '#000000' ? col : null,
      };
      if (word) Object.assign(attrs, { dstrike: chk('#fd-ds') || null, smallCaps: chk('#fd-sc') || null, allCaps: chk('#fd-ac') || null, letterSpacing: parseFloat($('#fd-ls', body).value) || null });
      c.setMark('textStyle', attrs).removeEmptyTextStyle().run();
    } }],
  });
  return body;
}
