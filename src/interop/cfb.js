// Minimal reader for OLE Compound File Binary (MS-CFB) — enough to pull named
// streams out of Word's "Embed Source" clipboard object, whose "Package" stream
// is the copied selection as a complete .docx.
//
// readCfb(bytes) → Map<name, Uint8Array> of every stream (names only, the tree
// is flattened; Word's embed object keeps its streams at the root).

const END = 0xfffffffe, FREE = 0xffffffff;

export function isCfb(u8) {
  return u8?.length > 512 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0 && u8[4] === 0xa1 && u8[5] === 0xb1 && u8[6] === 0x1a && u8[7] === 0xe1;
}

export function readCfb(u8) {
  if (!isCfb(u8)) throw new Error('not a compound file');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const secSize = 1 << dv.getUint16(0x1e, true);
  const miniSize = 1 << dv.getUint16(0x20, true);
  const nFat = u32(0x2c), dirStart = u32(0x30), cutoff = u32(0x38);
  const miniFatStart = u32(0x3c), nMiniFat = u32(0x40);
  let difatSec = u32(0x44);
  const secOff = (s) => 512 + s * secSize; // v3 and v4 alike: sector 0 follows the (padded) header
  // ---- FAT sector list from the header DIFAT + DIFAT chain
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = u32(0x4c + i * 4); if (s !== FREE) fatSecs.push(s); }
  for (let guard = 0; difatSec !== END && difatSec !== FREE && fatSecs.length < nFat && guard < 1e5; guard++) {
    const o = secOff(difatSec);
    for (let i = 0; i < secSize / 4 - 1 && fatSecs.length < nFat; i++) { const s = u32(o + i * 4); if (s !== FREE) fatSecs.push(s); }
    difatSec = u32(o + secSize - 4);
  }
  const fat = new Uint32Array(fatSecs.length * secSize / 4);
  fatSecs.forEach((s, k) => { const o = secOff(s); for (let i = 0; i < secSize / 4; i++) fat[k * secSize / 4 + i] = u32(o + i * 4); });
  const chain = (start, table) => {
    const out = [];
    for (let s = start, guard = 0; s !== END && s !== FREE && s < table.length && guard < 1e7; s = table[s], guard++) out.push(s);
    return out;
  };
  const readChain = (start) => {
    const secs = chain(start, fat);
    const buf = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => buf.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize));
    return buf;
  };
  // ---- directory
  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 0x40, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const root = entries[0];
  const miniStream = root ? readChain(root.start) : new Uint8Array(0);
  const miniFatBytes = nMiniFat ? readChain(miniFatStart) : new Uint8Array(0);
  const miniFat = new Uint32Array(miniFatBytes.buffer, 0, Math.floor(miniFatBytes.length / 4));
  const out = new Map();
  for (const e of entries) {
    if (e.type !== 2) continue; // streams only
    let data;
    if (e.size < cutoff) {
      const secs = chain(e.start, miniFat);
      data = new Uint8Array(secs.length * miniSize);
      secs.forEach((s, i) => data.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
    } else data = readChain(e.start);
    out.set(e.name, data.subarray(0, e.size));
  }
  return out;
}
