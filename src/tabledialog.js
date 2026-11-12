// Word's Table Properties: table alignment/indent and border presets; row height
// (at least / exactly) and repeat-as-header; cell shading and vertical alignment.
// In a .udf only UYAP's table border modes are offered (grid / rows / frame / none):
// UYAP has no per-cell borders, shading, row heights or vertical alignment.
import { $, h, modal } from './ui.js';
import { CellSelection } from '@tiptap/pm/tables';

const CM = 28.3465;
const cm = (pt) => String(Math.round(((pt || 0) / CM) * 100) / 100);
const UDF_NOTE = '<span class="wd-udf">UYAP belgesinde yok</span>';

/** The table around the selection: { node, pos, rows: [{ node, pos, cols, cells: [{ node, pos, col }] }] } */
export function tableAt(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name !== 'table') continue;
    const pos = $from.before(d);
    const rows = [];
    n.forEach((row, rOff) => {
      const rpos = pos + 1 + rOff;
      const cells = [];
      let col = 0;
      row.forEach((cell, cOff) => { cells.push({ node: cell, pos: rpos + 1 + cOff, col }); col += cell.attrs.colspan || 1; });
      rows.push({ node: row, pos: rpos, cells, cols: col });
    });
    return { node: n, pos, rows };
  }
  return null;
}

/** Word border presets → per-cell borders from the cell's place in the grid. */
export function presetBorders(t, preset, line) {
  const nRows = t.rows.length;
  const nCols = Math.max(...t.rows.map((r) => r.cols));
  return (ri, cell) => {
    const edge = { top: ri === 0, bottom: ri === nRows - 1, left: cell.col === 0, right: cell.col + (cell.node.attrs.colspan || 1) >= nCols };
    const want = (side) => {
      if (preset === 'none') return false;
      if (preset === 'outside') return edge[side];
      if (preset === 'insideH') return (side === 'top' && !edge.top) || (side === 'bottom' && !edge.bottom);
      if (preset === 'rows') return side === 'top' || side === 'bottom' || edge[side];
      return true; // all
    };
    const b = {};
    for (const side of ['top', 'bottom', 'left', 'right']) b[side] = want(side) ? line : 'none';
    return b;
  };
}

const opt = (list, v) => list.map(([k, l]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${l}</option>`).join('');
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === false) delete o[k]; return Object.keys(o).length ? o : null; };

export function tableDialog(app, tab, ed) {
  const t = tableAt(ed.state);
  if (!t) return null;
  const word = tab.format === 'docx';
  const sel = ed.state.selection;
  // cell/row options apply to a cell selection, else to the cursor's cell
  const chosen = new Set();
  if (sel instanceof CellSelection) sel.forEachCell((_n, pos) => chosen.add(pos));
  else for (let d = sel.$from.depth; d > 0; d--) if (/^table(Cell|Header)$/.test(sel.$from.node(d).type.name)) { chosen.add(sel.$from.before(d)); break; }
  const chosenRows = new Set(t.rows.filter((r) => r.cells.some((c) => chosen.has(c.pos))).map((r) => r.pos));
  const cf = t.rows.flatMap((r) => r.cells).find((c) => chosen.has(c.pos))?.node.attrs.fmt || {};
  const rf = t.rows.find((r) => chosenRows.has(r.pos))?.node.attrs.fmt || {};
  const tf = t.node.attrs.fmt || {};
  const mode = t.node.attrs.udf?.border || 'borderCell';
  const body = h(`<div class="wd">
    <div class="wd-tabs"><button data-tab="t" class="active">Tablo</button><button data-tab="r">Satır</button><button data-tab="c">Hücre</button></div>
    <div class="wd-pane" data-pane="t">${word ? `
      <div class="field-row">
        <div class="field"><label>Hizalama</label><select id="td-al">${opt([['left', 'Sol'], ['center', 'Orta'], ['right', 'Sağ']], tf.align || 'left')}</select></div>
        <div class="field"><label>Soldan girinti (cm)</label><input type="number" step="0.25" id="td-in" value="${cm(tf.indent)}"></div>
      </div>
      <h3 class="sec">Kenarlıklar</h3>
      <div class="field-row">
        <div class="field"><label>Hazır</label><select id="td-bp">${opt([['keep', '(değiştirme)'], ['all', 'Tüm kenarlıklar'], ['outside', 'Dış kenarlıklar'], ['rows', 'Yatay çizgiler ve dış'], ['insideH', 'Yalnız iç yatay'], ['none', 'Kenarlık yok']], 'keep')}</select></div>
        <div class="field"><label>Kalınlık (nk)</label><input type="number" step="0.25" min="0.25" id="td-bw" value="0.5"></div>
        <div class="field"><label>Renk</label><input type="color" id="td-bc" value="#000000"></div>
      </div>` : `
      <div class="field-row"><div class="field"><label>Kenarlık (UYAP)</label><select id="td-mode">${opt([['borderCell', 'Tüm çizgiler'], ['borderRow', 'Satır çizgileri ve çerçeve'], ['borderTable', 'Yalnız çerçeve'], ['borderNone', 'Kenarlık yok']], mode)}</select></div></div>
      <p class="note">UYAP tablolarda yalnız bu dört kenarlık türünü, tüm tabloya birden uygular.</p>`}
    </div>
    <div class="wd-pane hidden" data-pane="r">${word ? `
      <div class="field-row">
        <div class="field"><label>Satır yüksekliği (cm, 0 = otomatik)</label><input type="number" step="0.1" min="0" id="td-rh" value="${cm(rf.height)}"></div>
        <div class="field"><label>Kural</label><select id="td-rx">${opt([['min', 'En az'], ['exact', 'Tam']], rf.exact ? 'exact' : 'min')}</select></div>
      </div>
      <label class="chk"><input type="checkbox" id="td-hd" ${rf.header ? 'checked' : ''}> Her sayfada başlık satırı olarak yinele</label>
      <p class="note">Seçili satırlara uygulanır.</p>` : `<p class="note">${UDF_NOTE}: UYAP satır yüksekliğini belgede saklamaz.</p>`}
    </div>
    <div class="wd-pane hidden" data-pane="c">${word ? `
      <div class="field-row">
        <div class="field"><label>Dikey hizalama</label><select id="td-va">${opt([['top', 'Üst'], ['center', 'Orta'], ['bottom', 'Alt']], cf.valign || 'top')}</select></div>
        <div class="field"><label class="chk"><input type="checkbox" id="td-sh" ${cf.bg ? 'checked' : ''}> Gölgelendirme</label><input type="color" id="td-shc" value="${cf.bg || '#d9d9d9'}"></div>
      </div>
      <p class="note">Seçili hücrelere uygulanır.</p>` : `<p class="note">${UDF_NOTE}: hücre gölgelendirmesi ve dikey hizalama UYAP biçiminde saklanamaz.</p>`}
    </div></div>`);
  const bar = $('.wd-tabs', body);
  bar.onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    bar.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    body.querySelectorAll('.wd-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
  };
  modal({
    title: 'Tablo özellikleri', icon: 'table', body, width: 600,
    actions: [{ label: 'İptal' }, { label: 'Uygula', kind: 'primary', onClick: () => {
      const v = (id) => $(id, body)?.value;
      const tr = ed.state.tr;
      if (!word) {
        tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, udf: { ...(t.node.attrs.udf || {}), border: v('#td-mode') } });
        ed.view.dispatch(tr);
        return;
      }
      const preset = v('#td-bp');
      const line = { style: 'solid', width: Math.max(0.25, parseFloat(v('#td-bw')) || 0.5), color: v('#td-bc') || '#000000' };
      const borders = preset !== 'keep' ? presetBorders(t, preset, line) : null;
      // attribute changes don't move positions: the positions read above stay valid
      t.rows.forEach((r, ri) => {
        if (chosenRows.has(r.pos)) {
          const hgt = (parseFloat(v('#td-rh')) || 0) * CM;
          tr.setNodeMarkup(r.pos, undefined, { ...r.node.attrs, fmt: clean({ ...(r.node.attrs.fmt || {}), height: hgt || null, exact: hgt && v('#td-rx') === 'exact', header: $('#td-hd', body).checked }) });
        }
        for (const c of r.cells) {
          if (!borders && !chosen.has(c.pos)) continue;
          const fmt = { ...(c.node.attrs.fmt || {}) };
          if (borders) fmt.borders = borders(ri, c);
          if (chosen.has(c.pos)) { fmt.valign = v('#td-va') === 'top' ? null : v('#td-va'); fmt.bg = $('#td-sh', body).checked ? v('#td-shc') : null; }
          tr.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, fmt: clean(fmt) });
        }
      });
      const udf = { ...(t.node.attrs.udf || {}) };
      if (preset !== 'keep') udf.border = preset === 'none' ? 'borderNone' : 'borderCell';
      tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, udf, fmt: clean({ ...tf, align: v('#td-al') === 'left' ? null : v('#td-al'), indent: (parseFloat(v('#td-in')) || 0) * CM || null }) });
      ed.view.dispatch(tr);
    } }],
  });
  return body;
}
