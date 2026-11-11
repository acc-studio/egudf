// Minimal DER encoder/decoder — just enough ASN.1 for X.509 field extraction
// and CMS (PKCS#7) SignedData construction. No dependencies, so the exact
// bytes we emit are fully under our control (UYAP compares structure, and
// DER must be canonical for the signature over signedAttrs to verify).

export const TAG = {
  INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, NULL: 0x05, OID: 0x06,
  UTF8: 0x0c, PRINTABLE: 0x13, UTCTIME: 0x17, GENTIME: 0x18,
  SEQUENCE: 0x30, SET: 0x31,
};

function lenBytes(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  while (n > 0) { out.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | out.length, ...out]);
}

export function tlv(tag, content) {
  const c = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), lenBytes(c.length), c]);
}

export const seq = (...items) => tlv(TAG.SEQUENCE, Buffer.concat(items));
/** DER SET OF: elements sorted by their encodings (X.690 §11.6). */
export const setOf = (...items) => tlv(TAG.SET, Buffer.concat([...items].sort(Buffer.compare)));
export const octet = (buf) => tlv(TAG.OCTET_STRING, buf);
export const nul = () => Buffer.from([0x05, 0x00]);
/** context-specific constructed [n] wrapper (EXPLICIT, or IMPLICIT for a SET/SEQUENCE body). */
export const ctx = (n, content) => tlv(0xa0 | n, content);

export function int(v) {
  let b;
  if (Buffer.isBuffer(v)) b = v;
  else {
    const out = [];
    let n = v;
    do { out.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0);
    b = Buffer.from(out);
  }
  // strip redundant leading zeros, keep sign bit clear
  let i = 0;
  while (i < b.length - 1 && b[i] === 0 && !(b[i + 1] & 0x80)) i++;
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(TAG.INTEGER, b);
}

export function oid(str) {
  const parts = str.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let n = Math.floor(p / 128);
    while (n > 0) { stack.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(...stack);
  }
  return tlv(TAG.OID, Buffer.from(out));
}

export function utcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(TAG.UTCTIME, Buffer.from(s, 'ascii'));
}

// ------------------------------------------------------------------ decode

/**
 * parse(buf, offset) → node { tag, start, hlen, len, end, raw, body, children? }
 * raw = full TLV bytes, body = content bytes. Constructed nodes get children.
 */
export function parse(buf, offset = 0) {
  const tag = buf[offset];
  let p = offset + 1;
  let len = buf[p++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: unsupported length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
  }
  const hlen = p - offset;
  const end = p + len;
  if (end > buf.length) throw new Error('DER: truncated');
  const node = { tag, start: offset, hlen, len, end, raw: buf.subarray(offset, end), body: buf.subarray(p, end) };
  if (tag & 0x20) {
    node.children = [];
    let q = p;
    while (q < end) {
      const c = parse(buf, q);
      node.children.push(c);
      q = c.end;
    }
  }
  return node;
}

export function decodeOid(body) {
  const out = [Math.floor(body[0] / 40), body[0] % 40];
  let n = 0;
  for (let i = 1; i < body.length; i++) {
    n = n * 128 + (body[i] & 0x7f);
    if (!(body[i] & 0x80)) { out.push(n); n = 0; }
  }
  return out.join('.');
}

export function decodeTime(node) {
  const s = node.body.toString('ascii');
  if (node.tag === TAG.UTCTIME) {
    const y = parseInt(s.slice(0, 2), 10);
    return new Date(Date.UTC(y < 50 ? 2000 + y : 1900 + y, +s.slice(2, 4) - 1, +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10), +(s.slice(10, 12) || 0)));
  }
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +(s.slice(12, 14) || 0)));
}

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaWithSHA256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  serialNumber: '2.5.4.5',
  organizationName: '2.5.4.10',
  keyUsage: '2.5.29.15',
};
