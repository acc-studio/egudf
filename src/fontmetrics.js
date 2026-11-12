// Single-line height of a font as a multiple of its size, as Word lays it out
// (hhea ascender − descender + lineGap, over unitsPerEm). Word's "multiple" line
// spacing scales this; UYAP's single line is always 1.15 × size.
// Measured from the fonts in C:\Windows\Fonts and the Office cloud-font cache.
const LINE_FACTOR = {
  calibri: 1.2207, 'calibri light': 1.2207, cambria: 1.1719, arial: 1.1499, 'times new roman': 1.1499, georgia: 1.1362,
  verdana: 1.2153, tahoma: 1.2075, 'segoe ui': 1.3301, garamond: 1.1265, 'book antiqua': 1.1704, 'palatino linotype': 1.3491,
  'courier new': 1.1328, 'century gothic': 1.2251, 'trebuchet ms': 1.1611, helvetica: 1.1499, 'arial narrow': 1.1499,
  candara: 1.2207, constantia: 1.2207, corbel: 1.2207,
  // Office cloud fonts
  aptos: 1.2207, 'aptos display': 1.2207, 'aptos narrow': 1.2207, 'aptos serif': 1.2207, 'amasis mt pro': 1.2, 'arial nova': 1.2095,
  'avenir next lt pro': 1.2129, bierstadt: 1.1431, 'gill sans nova': 1.3018, 'grandview display': 1.2002, 'ibm plex sans': 1.3,
  'josefin sans': 1.0, lato: 1.2, lora: 1.28, montserrat: 1.219, 'neue haas grotesk text pro': 1.223, 'noto sans': 1.3618,
  'nunito sans': 1.364, 'open sans': 1.3618, 'pt serif': 1.325, poppins: 1.5, questrial: 1.03, roboto: 1.1719, seaford: 1.2695,
  'source sans pro': 1.257, ubuntu: 1.149, univers: 1.2388, 'walbaum display': 1.333, 'work sans': 1.173,
};

export function lineFactor(family) {
  const f = String(family || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  return LINE_FACTOR[f] || 1.15;
}
