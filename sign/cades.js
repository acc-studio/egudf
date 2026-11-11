// CAdES-BES detached signature for UYAP documents.
//
// Verified against real UYAP-signed .udf files: sign.sgn is a DER CMS
// SignedData with no encapsulated content (detached), digest SHA-256 over the
// raw bytes of content.xml, exactly one certificate (the signer's), and the
// signed attributes contentType, signingTime, messageDigest and
// signingCertificateV2 (ESSCertIDv2 with certHash + issuerSerial; SHA-256 is
// the default hash so its AlgorithmIdentifier is omitted). Digest algorithm
// identifiers carry no NULL parameter; sha256WithRSAEncryption does.
import crypto from 'node:crypto';
import { seq, setOf, octet, nul, ctx, int, oid, utcTime, tlv, OID } from './der.js';
import { describeCert } from './x509.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

export const DIGEST_INFO_SHA256_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex');

/** Build the DER SET of signed attributes (this exact encoding is what gets signed). */
export function buildSignedAttrs({ content, certDer, signingTime = new Date() }) {
  const cert = describeCert(certDer);
  const attr = (o, ...values) => seq(oid(o), setOf(...values));
  const essCertIdV2 = seq(
    octet(sha256(cert.der)),
    seq( // IssuerSerial
      seq(ctx(4, cert.issuerRaw)), // GeneralNames { directoryName [4] Name }
      cert.serialRaw,
    ),
  );
  const attrs = [
    attr(OID.contentType, oid(OID.data)),
    attr(OID.signingTime, utcTime(signingTime)),
    attr(OID.messageDigest, octet(sha256(content))),
    attr(OID.signingCertificateV2, seq(seq(essCertIdV2))),
  ];
  return { set: setOf(...attrs), cert };
}

/**
 * The bytes the signing key must sign, per algorithm:
 *  - rsa: DigestInfo(SHA-256(signedAttrs)) for CKM_RSA_PKCS (PKCS#1 v1.5)
 *  - ec:  SHA-256(signedAttrs) for CKM_ECDSA
 */
export function toBeSigned(signedAttrsSet, keyAlg) {
  const h = sha256(signedAttrsSet);
  return keyAlg === 'ec' ? h : Buffer.concat([DIGEST_INFO_SHA256_PREFIX, h]);
}

/** Raw ECDSA r||s (PKCS#11 output) → DER Ecdsa-Sig-Value. */
export function ecdsaRawToDer(raw) {
  const half = raw.length / 2;
  return seq(int(Buffer.from(raw.subarray(0, half))), int(Buffer.from(raw.subarray(half))));
}

/** Assemble ContentInfo(SignedData) given the signed attrs and the signature value. */
export function assemble({ signedAttrsSet, cert, signature }) {
  const sha256Alg = seq(oid(OID.sha256));
  const sigAlg = cert.keyAlg === 'ec' ? seq(oid(OID.ecdsaWithSHA256)) : seq(oid(OID.sha256WithRSA), nul());
  // signedAttrs are [0] IMPLICIT SET OF — same body, tag 0xA0 instead of 0x31
  const signedAttrsImplicit = Buffer.from(signedAttrsSet);
  signedAttrsImplicit[0] = 0xa0;
  const signerInfo = seq(
    int(1),
    seq(cert.issuerRaw, cert.serialRaw), // IssuerAndSerialNumber
    sha256Alg,
    signedAttrsImplicit,
    sigAlg,
    octet(signature),
  );
  const signedData = seq(
    int(1),
    setOf(sha256Alg),
    seq(oid(OID.data)), // detached: no eContent
    ctx(0, cert.der), // certificates [0] IMPLICIT
    setOf(signerInfo),
  );
  return seq(oid(OID.signedData), ctx(0, signedData));
}

/**
 * signDetached({ content, certDer, signer, signingTime }) → Buffer (sign.sgn)
 * signer(bytes, keyAlg) → Promise<Buffer> signature value: for rsa it receives
 * a DigestInfo and must return the PKCS#1 v1.5 signature; for ec it receives the
 * hash and may return raw r||s or DER.
 */
export async function signDetached({ content, certDer, signer, signingTime }) {
  const { set, cert } = buildSignedAttrs({ content, certDer, signingTime });
  let sig = await signer(toBeSigned(set, cert.keyAlg), cert.keyAlg, set);
  if (cert.keyAlg === 'ec' && sig[0] !== 0x30) sig = ecdsaRawToDer(sig);
  return assemble({ signedAttrsSet: set, cert, signature: sig });
}

/** Software signer (tests, and .pfx/.p12 soft certificates). */
export function softSigner(privateKey) {
  return async (tbs, keyAlg, signedAttrsSet) => {
    if (keyAlg === 'ec') return crypto.sign('sha256', signedAttrsSet, { key: privateKey, dsaEncoding: 'der' });
    // RSA PKCS#1 v1.5 over a precomputed DigestInfo = raw private "encrypt" with type-1 padding
    return crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, tbs);
  };
}

export { tlv };
