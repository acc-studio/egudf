// Pasted HTML (Word Online, Outlook, Word without its .docx on the clipboard,
// Google Docs, web pages) → HTML the editor's schema reads faithfully.
//
// The schema models lists as paragraph attributes (as UYAP does), so:
//  - Word's list paragraphs (style "mso-list:l1 level2 lfo3", label in a
//    "mso-list:Ignore" span) become paragraphs with data-p list attributes, the
//    style taken from the label text ("a)", "iii.", "·", "§", "o" …);
//  - <ul>/<ol> lists are flattened to such paragraphs, one level per nesting.
// Word puts most formatting in class CSS (p.MsoNormal {margin…; font…}): class
// rules are applied to the elements, so spacing, indents, line spacing, tab stops
// and the paragraph font arrive. List ids are "h:…" here and get fresh numbers
// when the slice is inserted (remapPastedLists).

const PT = { pt: 1, px: 0.75, cm: 28.3465, mm: 2.83465, in: 72, pc: 12 };
const toPt = (v) => { const m = /^(-?[\d.]+)(pt|px|cm|mm|in|pc)?$/i.exec(String(v || '').trim()); return m ? parseFloat(m[1]) * (PT[(m[2] || 'px').toLowerCase()] || 1) : null; };

/** "p.MsoNormal, li.MsoNormal {a:b; c:d}" → { msonormal: { a: 'b', c: 'd' } } (class rules only) */
function classRules(doc) {
  const out = {};
  for (const st of doc.querySelectorAll('style')) {
    const css = st.textContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl = {};
      for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }
      for (const sel of m[1].split(',')) {
        const c = /(?:^|\s)(?:p|li|div|span)?\.([\w-]+)\s*$/.exec(sel.trim());
        if (c) out[c[1].toLowerCase()] = { ...(out[c[1].toLowerCase()] || {}), ...decl };
      }
    }
  }
  return out;
}

const styleMap = (el) => {
  const o = {};
  for (const d of String(el.getAttribute('style') || '').split(';')) { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }
  return o;
};
const setStyle = (el, o) => el.setAttribute('style', Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';'));

const BULLET = { '·': 'ELLIPSE', '•': 'ELLIPSE', '§': 'RECTANGLE', '▪': 'RECTANGLE', '■': 'RECTANGLE', o: 'CIRCLE', '○': 'CIRCLE', 'Ø': 'ARROW', '➢': 'ARROW', '➤': 'ARROW', 'ü': 'CHECK', '✓': 'CHECK', '-': 'DASH', '–': 'DASH', '—': 'DASH', 'v': 'DIAMOND', '◆': 'DIAMOND', '♦': 'DIAMOND', 'q': 'RECTANGLE_D', '□': 'RECTANGLE_D' };

/** A list label as Word prints it → { kind, type } in UYAP's names. */
export function labelType(label) {
  const t = String(label || '').replace(/ /g, ' ').trim();
  if (BULLET[t]) return { kind: 'bullet', type: `BULLET_TYPE_${BULLET[t]}` };
  const m = /^(\()?([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z])([.)\-])?$/.exec(t);
  if (!m) return { kind: 'bullet', type: 'BULLET_TYPE_ELLIPSE' };
  const core = m[2];
  const kind = /^[0-9]+$/.test(core) ? 'NUMBER'
    : /^[ivxlcdm]+$/.test(core) && (core.length > 1 || core === 'i') ? 'ROMAN_SMALL'
      : /^[IVXLCDM]+$/.test(core) && (core.length > 1 || core === 'I') ? 'ROMAN_BIG'
        : /^[a-z]$/.test(core) ? 'CHAR_SMALL' : 'CHAR_BIG';
  const suffix = m[1] ? 'D_PARANTHESE' : m[3] === ')' ? 'PARANTHESE' : m[3] === '-' ? 'TRE' : 'DOT';
  return { kind: 'number', type: `NUMBER_TYPE_${kind}_${suffix}` };
}

const CSS_LIST = { disc: 'BULLET_TYPE_ELLIPSE', circle: 'BULLET_TYPE_CIRCLE', square: 'BULLET_TYPE_RECTANGLE', decimal: 'NUMBER_TYPE_NUMBER_DOT', 'lower-alpha': 'NUMBER_TYPE_CHAR_SMALL_DOT', 'lower-latin': 'NUMBER_TYPE_CHAR_SMALL_DOT', 'upper-alpha': 'NUMBER_TYPE_CHAR_BIG_DOT', 'upper-latin': 'NUMBER_TYPE_CHAR_BIG_DOT', 'lower-roman': 'NUMBER_TYPE_ROMAN_SMALL_DOT', 'upper-roman': 'NUMBER_TYPE_ROMAN_BIG_DOT' };
const TAB_ALIGN = { left: 0, right: 1, center: 2, decimal: 4 };
const TAB_LEAD = { dotted: 1, dashed: 2, lined: 3, heavy: 4 };

/** "right dotted 451.0pt 120pt" (Word's tab-stops) → tabSet "451:1:1,120:0:0" */
function tabStops(v) {
  const stops = [];
  let align = 0, lead = 0;
  for (const tok of String(v).split(/\s+/)) {
    if (TAB_ALIGN[tok] != null) align = TAB_ALIGN[tok];
    else if (TAB_LEAD[tok] != null) lead = TAB_LEAD[tok];
    else { const p = toPt(tok); if (p) { stops.push(`${Math.round(p * 100) / 100}:${align}:${lead}`); align = 0; lead = 0; } }
  }
  return stops.join(',') || null;
}

let seq = 0;
export function normalizePastedHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rules = classRules(doc);
  const body = doc.body;
  if (!body) return html;
  const tag = `h${++seq}`;

  // Word class CSS onto the elements (inline style wins)
  for (const el of body.querySelectorAll('[class]')) {
    const merged = {};
    for (const c of el.className.split(/\s+/)) Object.assign(merged, rules[c.toLowerCase()] || {});
    if (Object.keys(merged).length) setStyle(el, { ...merged, ...styleMap(el) });
  }
  // paragraph-level data the schema reads from data-p (merged with what it parses from style)
  const setP = (el, attrs) => { let cur = {}; try { cur = JSON.parse(el.dataset.p || '{}'); } catch {} el.dataset.p = JSON.stringify({ ...cur, ...attrs }); };

  for (const p of body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, div')) {
    const st = styleMap(p);
    const attrs = {};
    if (st['tab-stops']) { const ts = tabStops(st['tab-stops']); if (ts) attrs.tabSet = ts; }
    const lh = st['line-height'];
    if (lh && /%$/.test(lh)) attrs.lineSpacing = Math.max(0, Math.round((parseFloat(lh) / 100 - 1) * 100) / 100);
    else if (lh && /^[\d.]+$/.test(lh)) attrs.lineSpacing = Math.max(0, Math.round((parseFloat(lh) - 1) * 100) / 100);
    // Word list paragraph
    const ml = /mso-list:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i.exec(st['mso-list'] ? `mso-list:${st['mso-list']}` : '');
    if (ml) {
      const ign = p.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
      const label = ign ? ign.childNodes[0]?.textContent || ign.textContent : '';
      // drop the label and the wrapper spans Word puts around it
      let rm = ign;
      while (rm && rm.parentElement && rm.parentElement !== p && rm.parentElement.textContent.trim() === rm.textContent.trim()) rm = rm.parentElement;
      rm?.remove();
      const lt = labelType(label);
      attrs.list = { ...lt, id: `${tag}:${ml[3]}`, level: parseInt(ml[2], 10) || 1 };
      const left = toPt(st['margin-left']), fl = toPt(st['text-indent']);
      if (left != null) attrs.leftIndent = left;
      if (fl != null) attrs.firstLineIndent = fl;
    }
    // the paragraph's own font, for runs without a span (Word: p.MsoNormal {font-family…})
    if ((st['font-family'] || st['font-size']) && p.tagName !== 'DIV' && p.tagName !== 'LI') {
      const span = doc.createElement('span');
      setStyle(span, { ...(st['font-family'] ? { 'font-family': st['font-family'] } : {}), ...(st['font-size'] ? { 'font-size': st['font-size'] } : {}) });
      while (p.firstChild) span.append(p.firstChild);
      p.append(span);
    }
    if (Object.keys(attrs).length) setP(p, attrs);
  }

  // <ul>/<ol> → list paragraphs (outermost first; nested lists one level deeper)
  const flatten = (list, level, id) => {
    const out = [];
    const ordered = list.tagName === 'OL';
    const cssType = (styleMap(list)['list-style-type'] || list.getAttribute('type') || '').toLowerCase();
    const TYPE_ATTR = { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', 1: 'decimal' };
    const type = CSS_LIST[cssType] || CSS_LIST[TYPE_ATTR[list.getAttribute('type')]] || (ordered ? 'NUMBER_TYPE_NUMBER_DOT' : (['BULLET_TYPE_ELLIPSE', 'BULLET_TYPE_CIRCLE', 'BULLET_TYPE_RECTANGLE'][(level - 1) % 3]));
    for (const li of [...list.children].filter((c) => c.tagName === 'LI')) {
      const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
      nested.forEach((n) => n.remove());
      const p = doc.createElement('p');
      const blocks = [...li.children].filter((c) => /^(P|DIV|H\d)$/.test(c.tagName));
      if (blocks.length) { while (blocks[0].firstChild) p.append(blocks[0].firstChild); blocks[0].remove(); } else { while (li.firstChild) p.append(li.firstChild); }
      const liStyle = styleMap(li);
      p.setAttribute('style', Object.entries(liStyle).filter(([k]) => !/^(margin-left|list-style)/.test(k)).map(([k, v]) => `${k}:${v}`).join(';'));
      p.dataset.p = JSON.stringify({ list: { kind: ordered ? 'number' : 'bullet', type, id, level }, leftIndent: 36 * level, firstLineIndent: -18 });
      out.push(p, ...[...li.children]);
      for (const n of nested) out.push(...flatten(n, level + 1, `${id}.${level}`));
    }
    return out;
  };
  for (const list of [...body.querySelectorAll('ul, ol')].filter((l) => !l.parentElement.closest('ul, ol'))) {
    list.replaceWith(...flatten(list, 1, `${tag}:${++seq}`));
  }
  // Word's <o:p> and conditional-comment leftovers
  for (const op of body.querySelectorAll('o\\:p')) op.replaceWith(...op.childNodes);
  return body.innerHTML;
}

/** After parsing: pasted list ids ("h…:…") → numbers unused in the document. */
export function remapPastedLists(slice, doc, Fragment, Slice) {
  let max = 0;
  doc.descendants((n) => { const v = parseInt(n.attrs?.list?.id, 10); if (v > max) max = v; });
  const map = {};
  const fix = (frag) => {
    const nodes = [];
    frag.forEach((n) => {
      let node = n;
      const l = n.attrs?.list;
      if (l && /^h\d+:/.test(String(l.id))) node = n.type.create({ ...n.attrs, list: { ...l, id: (map[l.id] ??= String(++max)) } }, n.content, n.marks);
      if (node.content.size) node = node.copy(fix(node.content));
      nodes.push(node);
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(fix(slice.content), slice.openStart, slice.openEnd);
}
