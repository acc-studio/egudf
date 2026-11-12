// Office "cloud fonts" (Aptos, Aptos Display, Grandview…): Word downloads them
// into %LOCALAPPDATA%\Microsoft\FontCache\4\CloudFonts\<Family>\<id>.ttf for
// the current user only, so Chromium can't see them. The renderer registers the
// ones a document uses as FontFaces, so Word documents render in their real fonts.
import fs from 'node:fs';
import path from 'node:path';

const root = () => path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'FontCache', '4', 'CloudFonts');

/** weight / italic from the OS/2 table (file names are numeric ids). */
function faceInfo(fd) {
  try {
    const dir = Buffer.alloc(12 + 64 * 16);
    fs.readSync(fd, dir, 0, dir.length, 0);
    const n = Math.min(64, dir.readUInt16BE(4));
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      if (dir.toString('latin1', o, o + 4) !== 'OS/2') continue;
      const t = Buffer.alloc(64);
      fs.readSync(fd, t, 0, 64, dir.readUInt32BE(o + 8));
      return { weight: t.readUInt16BE(4) || 400, italic: !!(t.readUInt16BE(62) & 1) };
    }
  } catch {}
  return { weight: 400, italic: false };
}

let cache = null;
/** → { [family lower-case]: { family, faces: [{ file, weight, italic }] } } */
export function officeFonts() {
  if (cache) return cache;
  cache = {};
  let dirs = [];
  try { dirs = fs.readdirSync(root(), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return cache; }
  for (const d of dirs) {
    const dir = path.join(root(), d.name);
    const faces = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      const file = path.join(dir, f);
      let fd;
      try { fd = fs.openSync(file, 'r'); faces.push({ file, ...faceInfo(fd) }); } catch { continue; } finally { if (fd != null) fs.closeSync(fd); }
    }
    if (faces.length) cache[d.name.toLowerCase()] = { family: d.name, faces };
  }
  return cache;
}

/** Bytes of a cloud font file (only files inside the cloud font folder). */
export function officeFontBytes(file) {
  const r = path.resolve(file);
  if (!r.toLowerCase().startsWith(path.resolve(root()).toLowerCase() + path.sep)) throw new Error('not an Office font');
  return new Uint8Array(fs.readFileSync(r));
}
