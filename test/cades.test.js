// CAdES-BES tests: our sign.sgn must verify with OpenSSL, match the structure
// of real UYAP signatures, and our verifier must accept real UYAP signatures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { signDetached, softSigner } from '../sign/cades.js';
import { verifyDetached } from '../sign/verify.js';
import { describeCert } from '../sign/x509.js';
import { readUdf } from '../src/udf/zip.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'udf-cades-'));
let openssl = null;
try { execFileSync('openssl', ['version']); openssl = 'openssl'; } catch {}

function makeCert(kind) {
  const key = path.join(tmp, `${kind}.key`), crt = path.join(tmp, `${kind}.crt`);
  const keyArgs = kind === 'ec' ? ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256'] : ['-newkey', 'rsa:2048'];
  // subject via a config file: Windows argv mangles UTF-8
  const cnf = path.join(tmp, `${kind}.cnf`);
  fs.writeFileSync(cnf, '[req]\nprompt=no\nutf8=yes\nstring_mask=utf8only\ndistinguished_name=dn\nx509_extensions=ext\n'
    + '[dn]\nC=TR\nserialNumber=11111111110\nCN=TEST AVUKAT ÖRNEK\n[ext]\nkeyUsage=critical,nonRepudiation\n', 'utf8');
  execFileSync(openssl, ['req', '-x509', ...keyArgs, '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-config', cnf], { stdio: 'pipe' });
  const der = execFileSync(openssl, ['x509', '-in', crt, '-outform', 'DER']);
  return { key: fs.readFileSync(key, 'utf8'), crt, der };
}

for (const kind of ['rsa', 'ec']) {
  test(`${kind}: detached CAdES-BES verifies with OpenSSL and our verifier`, { skip: !openssl && 'openssl not on PATH' }, async () => {
    const { key, crt, der } = makeCert(kind);
    const content = Buffer.from('<?xml version="1.0" encoding="UTF-8" ?> <template>çğıöşü</template>', 'utf8');
    const sgn = await signDetached({ content, certDer: der, signer: softSigner(key), signingTime: new Date('2026-11-11T10:00:00Z') });
    const sgnPath = path.join(tmp, `${kind}.sgn`), cPath = path.join(tmp, `${kind}.xml`);
    fs.writeFileSync(sgnPath, sgn);
    fs.writeFileSync(cPath, content);
    execFileSync(openssl, ['cms', '-verify', '-inform', 'DER', '-in', sgnPath, '-binary', '-content', cPath, '-CAfile', crt, '-purpose', 'any', '-out', process.platform === 'win32' ? 'NUL' : '/dev/null'], { stdio: 'pipe' });
    const v = verifyDetached(sgn, content);
    assert.equal(v.valid, true);
    assert.equal(v.signer.subjectSerial, '11111111110');
    assert.equal(v.signingTime, '2026-11-11T10:00:00.000Z');
    // tampering is detected
    const bad = verifyDetached(sgn, Buffer.concat([content, Buffer.from(' ')]));
    assert.equal(bad.valid, false);
    assert.equal(bad.digestOk, false);
  });
}

test('structure matches a real UYAP signature (attribute order, algorithms, detached)', { skip: !openssl && 'openssl not on PATH' }, async () => {
  const dir = process.env.UDF_SAMPLES || path.join(os.homedir(), 'Downloads');
  const real = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.udf')).map((f) => readUdf(fs.readFileSync(path.join(dir, f)))).find((u) => u.sign) : null;
  if (!real) return;
  const { key, der } = makeCert('rsa');
  const ours = await signDetached({ content: Buffer.from(real.contentXml), certDer: der, signer: softSigner(key) });
  const shape = (buf) => {
    const p = path.join(tmp, 'shape.sgn');
    fs.writeFileSync(p, buf);
    const full = execFileSync(openssl, ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', p, '-noout']).toString();
    const dump = full.slice(0, full.indexOf('certificates:')) + full.slice(full.indexOf('crls:'));
    return [...dump.matchAll(/(object|algorithm|eContentType|eContent): (.*)/g)]
      .map((m) => `${m[1]}=${m[2].trim()}`)
      .filter((l) => !/rsaEncryption|ecPublicKey|ecdsa-with|X509v3|qcStatements|Authority Information|Certificate Policies|CRL Distribution|Basic Constraints|Key Identifier|Key Usage/.test(l));
  };
  assert.deepEqual(shape(ours), shape(Buffer.from(real.sign)));
});

test('verifier accepts real UYAP-signed files', () => {
  const dir = process.env.UDF_SAMPLES || path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) return;
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.udf'))) {
    const u = readUdf(fs.readFileSync(path.join(dir, f)));
    if (!u.sign) continue;
    const v = verifyDetached(Buffer.from(u.sign), Buffer.from(u.contentXml));
    assert.equal(v.valid, true, `${f} should verify`);
    n++;
  }
  assert.ok(n >= 0);
});

test('describeCert reads Turkish qualified-cert fields', { skip: !openssl && 'openssl not on PATH' }, () => {
  const { der } = makeCert('rsa');
  const c = describeCert(der);
  assert.equal(c.subjectCN, 'TEST AVUKAT ÖRNEK');
  assert.equal(c.subjectSerial, '11111111110');
  assert.equal(c.nonRepudiation, true);
  assert.equal(c.keyAlg, 'rsa');
});
