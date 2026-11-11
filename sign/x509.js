// X.509 field extraction for signing (raw issuer Name + serial, needed
// verbatim inside the CMS) and for showing a certificate to the user.
import { parse, decodeOid, decodeTime, OID } from './der.js';

function nameAttrs(nameNode) {
  const out = {};
  for (const rdn of nameNode.children || []) {
    for (const atv of rdn.children || []) {
      const [o, v] = atv.children;
      const key = decodeOid(o.body);
      // UTF8String / PrintableString / BMPString(0x1e)
      const val = v.tag === 0x1e
        ? Buffer.from(v.body).swap16().toString('utf16le')
        : v.body.toString('utf8');
      out[key] = out[key] ? `${out[key]}, ${val}` : val;
    }
  }
  return out;
}

/**
 * describeCert(der) → { der, issuerRaw, serialRaw (INTEGER TLV), subjectCN,
 *   subjectSerial (TCKN for Turkish qualified certs), issuerCN, issuerO,
 *   notBefore, notAfter, keyAlg: 'rsa'|'ec', nonRepudiation, digitalSignature }
 */
export function describeCert(der) {
  const buf = Buffer.from(der);
  const cert = parse(buf);
  const tbs = cert.children[0];
  let i = 0;
  if (tbs.children[0].tag === 0xa0) i = 1; // explicit version
  const serial = tbs.children[i];
  const issuer = tbs.children[i + 2];
  const validity = tbs.children[i + 3];
  const subject = tbs.children[i + 4];
  const spki = tbs.children[i + 5];
  const extsWrap = tbs.children.find((c) => c.tag === 0xa3);

  const keyAlgOid = decodeOid(spki.children[0].children[0].body);
  let nonRepudiation = false, digitalSignature = false, hasKeyUsage = false;
  for (const ext of extsWrap?.children[0]?.children || []) {
    if (decodeOid(ext.children[0].body) !== OID.keyUsage) continue;
    hasKeyUsage = true;
    const valueOctet = ext.children[ext.children.length - 1];
    const bits = parse(Buffer.from(valueOctet.body)).body; // BIT STRING: [unused, b0, ...]
    const b0 = bits[1] || 0;
    digitalSignature = !!(b0 & 0x80);
    nonRepudiation = !!(b0 & 0x40);
  }
  const s = nameAttrs(subject), is = nameAttrs(issuer);
  return {
    der: buf,
    issuerRaw: Buffer.from(issuer.raw),
    serialRaw: Buffer.from(serial.raw),
    serialHex: serial.body.toString('hex').toUpperCase(),
    subjectCN: s[OID.commonName] || '',
    subjectSerial: s[OID.serialNumber] || '',
    subjectO: s[OID.organizationName] || '',
    issuerCN: is[OID.commonName] || '',
    issuerO: is[OID.organizationName] || '',
    notBefore: decodeTime(validity.children[0]),
    notAfter: decodeTime(validity.children[1]),
    keyAlg: keyAlgOid === OID.ecPublicKey ? 'ec' : 'rsa',
    nonRepudiation: hasKeyUsage ? nonRepudiation : true,
    digitalSignature: hasKeyUsage ? digitalSignature : true,
  };
}

/** Public view of a cert (safe to send to the renderer). */
export function publicView(info) {
  return {
    subjectCN: info.subjectCN,
    subjectSerial: info.subjectSerial,
    subjectO: info.subjectO,
    issuerCN: info.issuerCN,
    issuerO: info.issuerO,
    serialHex: info.serialHex,
    notBefore: info.notBefore.toISOString(),
    notAfter: info.notAfter.toISOString(),
    keyAlg: info.keyAlg,
    nonRepudiation: info.nonRepudiation,
    expired: Date.now() > info.notAfter.getTime(),
  };
}
