// UYAP page numbers: footer attributes `pageNumber-*`.
//
// `pageNumber-spec` is "BSP32_<flags>". Inferred from real UYAP files (the
// format is undocumented): every file whose flags include 2048 also carries a
// `pageNumber-seperator`, the others don't, so 2048 = "with total (1 / N)".
// The remaining values seen are 8 | 32 and 8 | 64; we read them as power-of-two
// flag sets: vertical (4 top, 8 bottom) and horizontal (16 left, 32 centre,
// 64 right). Unknown flags are preserved when a spec is rewritten.
export const PN = { TOP: 4, BOTTOM: 8, LEFT: 16, CENTER: 32, RIGHT: 64, TOTAL: 2048 };
const KNOWN = PN.TOP | PN.BOTTOM | PN.LEFT | PN.CENTER | PN.RIGHT | PN.TOTAL;

const n = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };

/** footer attrs → { on, flags, vert, pos, total, sep, prefix, start, bold, italic, size, font, color } */
export function readPageNumber(attrs = {}) {
  const spec = attrs['pageNumber-spec'];
  if (!spec) return { on: false };
  const flags = parseInt(/(\d+)\s*$/.exec(spec)?.[1] || '72', 10);
  return {
    on: true,
    flags,
    vert: flags & PN.TOP && !(flags & PN.BOTTOM) ? 'top' : 'bottom',
    pos: flags & PN.LEFT ? 'left' : flags & PN.CENTER ? 'center' : 'right',
    total: !!(flags & PN.TOTAL),
    sep: attrs['pageNumber-seperator'] || '/',
    prefix: attrs['pageNumber-foreStr'] || '',
    start: Math.max(1, Math.round(n(attrs['pageNumber-pageStartNumStr'], 1))),
    bold: attrs['pageNumber-fontBold'] === 'true',
    italic: attrs['pageNumber-fontItalic'] === 'true',
    size: n(attrs['pageNumber-fontSize'], 11),
    font: attrs['pageNumber-fontFace'] || 'Arial',
    color: attrs['pageNumber-color'] || '-16777216',
  };
}

/** Options → the footer's pageNumber-* attrs (other attrs untouched). `null` removes them. */
export function writePageNumber(attrs = {}, o) {
  const out = { ...attrs };
  for (const k of Object.keys(out)) if (k.startsWith('pageNumber-')) delete out[k];
  if (!o) return out;
  const old = readPageNumber(attrs);
  let flags = (old.on ? old.flags & ~KNOWN : 0) | (o.vert === 'top' ? PN.TOP : PN.BOTTOM);
  flags |= o.pos === 'left' ? PN.LEFT : o.pos === 'center' ? PN.CENTER : PN.RIGHT;
  if (o.total) flags |= PN.TOTAL;
  Object.assign(out, {
    'pageNumber-spec': `BSP32_${flags}`,
    'pageNumber-fontFace': o.font || 'Arial',
    'pageNumber-fontSize': String(o.size || 11),
    'pageNumber-fontBold': o.bold ? 'true' : 'false',
    'pageNumber-fontItalic': o.italic ? 'true' : 'false',
    'pageNumber-color': o.color || '-16777216',
    'pageNumber-foreStr': o.prefix || '',
    'pageNumber-pageStartNumStr': o.start && o.start > 1 ? String(o.start) : '',
  });
  if (o.total) out['pageNumber-seperator'] = o.sep || '/';
  return out;
}

/** Text of the number on page i (0-based) of n pages. */
export function pageLabel(o, i, total) {
  const no = i + (o.start || 1);
  return `${o.prefix || ''}${no}${o.total ? ` ${o.sep || '/'} ${total + (o.start || 1) - 1}` : ''}`;
}

/** Presets offered in the UI. */
export const PN_FORMATS = [
  { id: 'n', label: '1', total: false, prefix: '' },
  { id: 'nN', label: '1 / 5', total: true, prefix: '' },
  { id: 'sn', label: 'Sayfa 1', total: false, prefix: 'Sayfa ' },
  { id: 'snN', label: 'Sayfa 1 / 5', total: true, prefix: 'Sayfa ' },
];
export const formatOf = (o) => (PN_FORMATS.find((f) => f.total === !!o.total && f.prefix === (o.prefix || '')) || { id: 'custom' }).id;
