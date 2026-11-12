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
// List styles, with the names UYAP Doküman Editörü itself uses (read from its
// editor_lib.jar and checked by rendering each one in Doküman Editörü 5.4.20).
// A paragraph's style at level N is SecListTypeLevelN; without it UYAP uses the
// level-1 NumberType/BulletType at level 1 and LEVEL_DEFAULTS below deeper.
// Word-only bullets (dash, check, circle) are kept in the editor model and
// written to UDF as the nearest UYAP bullet (uyapListType).
export const UYAP_BULLETS = ['ELLIPSE', 'RECTANGLE', 'RECTANGLE_D', 'DIAMOND', 'DIAMOND_2', 'ARROW', 'TRIANGLE'].map((t) => `BULLET_TYPE_${t}`);
export const UYAP_NUMBERS = ['NUMBER_DOT', 'NUMBER_DOT_2', 'NUMBER_DOT_3', 'NUMBER_TRE', 'NUMBER_PARANTHESE', 'NUMBER_PARANTHESE_2', 'NUMBER_D_PARANTHESE',
  'CHAR_SMALL_DOT', 'CHAR_SMALL_TRE', 'CHAR_SMALL_PARANTHESE', 'CHAR_SMALL_D_PARANTHESE', 'CHAR_BIG_DOT', 'CHAR_BIG_2', 'CHAR_BIG_TRE', 'CHAR_BIG_PARANTHESE', 'CHAR_BIG_D_PARANTHESE',
  'ROMAN_SMALL_DOT', 'ROMAN_SMALL_TRE', 'ROMAN_SMALL_PARANTHESE', 'ROMAN_SMALL_D_PARANTHESE', 'ROMAN_BIG_DOT', 'ROMAN_BIG_TRE', 'ROMAN_BIG_PARANTHESE', 'ROMAN_BIG_D_PARANTHESE'].map((t) => `NUMBER_TYPE_${t}`);
export const LEVEL_DEFAULTS = {
  number: [null, 'NUMBER_TYPE_CHAR_SMALL_DOT', 'NUMBER_TYPE_ROMAN_SMALL_DOT', 'NUMBER_TYPE_NUMBER_D_PARANTHESE', 'NUMBER_TYPE_CHAR_SMALL_D_PARANTHESE', 'NUMBER_TYPE_ROMAN_SMALL_D_PARANTHESE'],
  bullet: [null, 'BULLET_TYPE_RECTANGLE', 'BULLET_TYPE_RECTANGLE_D', 'BULLET_TYPE_DIAMOND', 'BULLET_TYPE_ARROW', 'BULLET_TYPE_TRIANGLE'],
};

/** Older egUDF names → UYAP's (PARANTEZ, LETTER_*). Unknown names pass through. */
export function canonicalListType(type) {
  return String(type || '').replace('PARANTEZ', 'PARANTHESE').replace(/LETTER_(SMALL|BIG)/, 'CHAR_$1');
}

/** The style UYAP shows for a list paragraph (UDF attributes). */
export function uyapLevelType(kind, level, ownType, secType) {
  if (secType) return canonicalListType(secType);
  if (level <= 1) return canonicalListType(ownType) || (kind === 'number' ? 'NUMBER_TYPE_NUMBER_DOT' : 'BULLET_TYPE_ELLIPSE');
  return LEVEL_DEFAULTS[kind][Math.min(level, 6) - 1] || (kind === 'number' ? 'NUMBER_TYPE_NUMBER_DOT' : 'BULLET_TYPE_ELLIPSE');
}

/** A style UYAP can draw, nearest to `type` (for writing UDF). */
export function uyapListType(kind, type) {
  const t = canonicalListType(type);
  if (kind === 'bullet') {
    if (UYAP_BULLETS.includes(t)) return t;
    return /CIRCLE|EMPTY/.test(t) ? 'BULLET_TYPE_RECTANGLE_D' : 'BULLET_TYPE_ELLIPSE'; // UYAP has no dash, check or circle
  }
  return UYAP_NUMBERS.includes(t) ? t : 'NUMBER_TYPE_NUMBER_DOT';
}

export function listLabel(kind, type, n) {
  const t = canonicalListType(type);
  if (kind === 'bullet') {
    if (/RECTANGLE_D/.test(t)) return '□';
    if (/RECT|SQUARE/.test(t)) return '■';
    if (/ARROW/.test(t)) return '➤';
    if (/TRIANGLE/.test(t)) return '►';
    if (/DIAMOND/.test(t)) return '◆';
    if (/DASH|LINE|TIRE/.test(t)) return '–';
    if (/CHECK|TICK/.test(t)) return '✓';
    if (/CIRCLE|EMPTY/.test(t)) return '○';
    return '•';
  }
  let core;
  if (/ROMAN_BIG|ROMAN_UPPER/.test(t)) core = roman(n);
  else if (/ROMAN/.test(t)) core = roman(n).toLowerCase();
  else if (/CHAR_BIG|ALPHA_(BIG|UPPER)/.test(t)) core = letters(n).toUpperCase();
  else if (/CHAR_SMALL|ALPHA/.test(t)) core = letters(n);
  else core = String(n);
  if (/D_PARANTHESE/.test(t)) return `(${core})`;
  const suffix = /TRE|DASH/.test(t) ? '-' : /PARAN|PARENT/.test(t) ? ')' : '.';
  return core + suffix;
}

export const NUMBER_TYPES = [
  { type: 'NUMBER_TYPE_NUMBER_DOT', sample: '1.' },
  { type: 'NUMBER_TYPE_NUMBER_TRE', sample: '1-' },
  { type: 'NUMBER_TYPE_NUMBER_PARANTHESE', sample: '1)' },
  { type: 'NUMBER_TYPE_NUMBER_D_PARANTHESE', sample: '(1)' },
  { type: 'NUMBER_TYPE_ROMAN_BIG_DOT', sample: 'I.' },
  { type: 'NUMBER_TYPE_ROMAN_SMALL_DOT', sample: 'i.' },
  { type: 'NUMBER_TYPE_CHAR_SMALL_DOT', sample: 'a.' },
  { type: 'NUMBER_TYPE_CHAR_SMALL_PARANTHESE', sample: 'a)' },
  { type: 'NUMBER_TYPE_CHAR_BIG_DOT', sample: 'A.' },
];
export const BULLET_TYPES = [
  { type: 'BULLET_TYPE_ELLIPSE', sample: '•' },
  { type: 'BULLET_TYPE_RECTANGLE', sample: '■' },
  { type: 'BULLET_TYPE_RECTANGLE_D', sample: '□' },
  { type: 'BULLET_TYPE_DIAMOND', sample: '◆' },
  { type: 'BULLET_TYPE_ARROW', sample: '➤' },
  { type: 'BULLET_TYPE_TRIANGLE', sample: '►' },
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
