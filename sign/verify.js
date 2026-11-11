// Verifies a UYAP sign.sgn against content.xml: message digest + the
// signature over the signed attributes, using the embedded signer certificate.
// Chain/revocation validation (KamuSM/E-Tuğra roots, CRL/OCSP) is NOT done —
// the result says so; UYAP performs that check on its side.
import crypto from 'node:crypto';
import { parse, decodeOid, decodeTime, OID } from './der.js';
import { describeCert, publicView } from './x509.js';

export function verifyDetached(signBytes, content) {
  const buf = Buffer.from(signBytes);
  const ci = parse(buf);
  if (decodeOid(ci.children[0].body) !== OID.signedData) throw new Error('sign.sgn: not a CMS SignedData');
  const sd = ci.children[1].children[0];
  const parts = sd.children;
  const certsNode = parts.find((p) => p.tag === 0xa0);
  const signerInfos = parts[parts.length - 1];
  const si = signerInfos.children[0];
  const certDers = (certsNode?.children || []).map((c) => Buffer.from(c.raw));

  // signer identifier → pick the matching certificate
  const sid = si.children[1];
  const sidSerial = sid.children?.[1]?.body?.toString('hex');
  const certInfos = certDers.map((d) => describeCert(d));
  const cert = certInfos.find((c) => parse(c.serialRaw).body.toString('hex') === sidSerial) || certInfos[0];
  if (!cert) throw new Error('sign.sgn: no signer certificate');

  const attrsNode = si.children.find((c) => c.tag === 0xa0);
  let signingTime = null, messageDigest = null;
  for (const a of attrsNode?.children || []) {
    const o = decodeOid(a.children[0].body);
    const v = a.children[1].children[0];
    if (o === OID.signingTime) signingTime = decodeTime(v);
    if (o === OID.messageDigest) messageDigest = Buffer.from(v.body);
  }
  const digestOk = !!messageDigest && crypto.createHash('sha256').update(content).digest().equals(messageDigest);

  // the signature covers the DER SET form of the attributes
  const setBytes = Buffer.from(attrsNode.raw);
  setBytes[0] = 0x31;
  const sigAlgNode = si.children[si.children.indexOf(attrsNode) + 1];
  const sigAlg = decodeOid(sigAlgNode.children[0].body);
  const signature = Buffer.from(si.children[si.children.indexOf(attrsNode) + 2].body);
  let signatureOk = false;
  try {
    const key = new crypto.X509Certificate(cert.der).publicKey;
    const hashAlg = sigAlg === OID.sha256WithRSA || sigAlg === OID.ecdsaWithSHA256 || sigAlg === OID.rsaEncryption ? 'sha256' : 'sha256';
    signatureOk = crypto.verify(hashAlg, setBytes, key, signature);
  } catch { signatureOk = false; }

  return {
    valid: digestOk && signatureOk,
    digestOk,
    signatureOk,
    signingTime: signingTime?.toISOString() || null,
    signer: publicView(cert),
    chainChecked: false,
  };
}
