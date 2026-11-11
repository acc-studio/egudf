// Shared UDF ⇄ editor conventions.

export const PT_TO_PX = 96 / 72;
export const A4 = { w: 595.2756, h: 841.8898 }; // points
export const IMAGE_CHAR = '¸'; // what the UYAP editor puts in the text for an image run

export const ALIGN = ['left', 'center', 'right', 'justify'];

/** Java signed ARGB int ("-16777216") → "#rrggbb" (null for empty). */
export function javaToHex(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return `#${((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** "#rrggbb" / "rgb(r,g,b)" → Java signed ARGB int string (opaque). */
export function hexToJava(css) {
  if (!css) return null;
  let r, g, b;
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const k = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css);
    if (!k) return null;
    [r, g, b] = [+k[1], +k[2], +k[3]];
  }
  return String(((0xff << 24) | (r << 16) | (g << 8) | b) | 0);
}

/** Java Float.toString-ish: 0 → "0.0", 25 → "25.0", 2.5 → "2.5". */
export function jfloat(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

export const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

function letters(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

/** List label for a UYAP NumberType / BulletType at counter n. */
export function listLabel(kind, type, n) {
  const t = String(type || '');
  if (kind === 'bullet') {
    if (/RECT|SQUARE/.test(t)) return '▪';
    if (/TRIANGLE|ARROW/.test(t)) return '►';
    if (/DIAMOND/.test(t)) return '◆';
    if (/DASH|LINE|TIRE/.test(t)) return '–';
    if (/CHECK|TICK/.test(t)) return '✓';
    if (/CIRCLE|EMPTY/.test(t)) return '○';
    return '•';
  }
  let core;
  if (/ROMAN_BIG|ROMAN_UPPER/.test(t)) core = roman(n);
  else if (/ROMAN/.test(t)) core = roman(n).toLowerCase();
  else if (/(LETTER|ALPHA)_(BIG|UPPER)/.test(t)) core = letters(n).toUpperCase();
  else if (/LETTER|ALPHA/.test(t)) core = letters(n);
  else core = String(n);
  const suffix = /TRE|DASH/.test(t) ? '-' : /PARAN|PARENT/.test(t) ? ')' : '.';
  return core + suffix;
}

export const NUMBER_TYPES = [
  { type: 'NUMBER_TYPE_NUMBER_DOT', sample: '1.' },
  { type: 'NUMBER_TYPE_NUMBER_TRE', sample: '1-' },
  { type: 'NUMBER_TYPE_NUMBER_PARANTEZ', sample: '1)' },
  { type: 'NUMBER_TYPE_ROMAN_BIG_DOT', sample: 'I.' },
  { type: 'NUMBER_TYPE_ROMAN_SMALL_DOT', sample: 'i.' },
  { type: 'NUMBER_TYPE_LETTER_SMALL_DOT', sample: 'a.' },
  { type: 'NUMBER_TYPE_LETTER_BIG_DOT', sample: 'A.' },
];
export const BULLET_TYPES = [
  { type: 'BULLET_TYPE_ELLIPSE', sample: '•' },
  { type: 'BULLET_TYPE_RECTANGLE', sample: '▪' },
  { type: 'BULLET_TYPE_TRIANGLE', sample: '►' },
  { type: 'BULLET_TYPE_DASH', sample: '–' },
];

export function base64FromBytes(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function imageMime(b64) {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('R0lG')) return 'image/gif';
  if (b64.startsWith('Qk')) return 'image/bmp';
  return 'image/png';
}
