// Smart-card access over PKCS#11 (Turkish e-imza tokens: TÜBİTAK AKİS,
// SafeNet eToken, Gemalto/Thales IDPrime, ACS, …). Each call loads the driver,
// does its work and finalizes again, so a token pulled out between calls never
// leaves a stale session behind. The PIN is passed straight to C_Login and is
// never stored or logged.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describeCert, publicView } from './x509.js';
import { signDetached } from './cades.js';

const require = createRequire(import.meta.url);
let pkcs11js = null;
function lib() {
  if (!pkcs11js) pkcs11js = require('pkcs11js');
  return pkcs11js;
}

/** Known drivers of the Turkish e-signature providers, by file name. */
export const KNOWN_DRIVERS = [
  { file: 'akisp11.dll', name: 'TÜBİTAK AKİS (E-Tuğra, E-Güven, Türktrust, KamuSM)' },
  { file: 'eTPKCS11.dll', name: 'SafeNet / Thales eToken' },
  { file: 'IDPrimePKCS11.dll', name: 'Thales/Gemalto IDPrime' },
  { file: 'gclib.dll', name: 'Gemalto Classic Client' },
  { file: 'aetpkss1.dll', name: 'SafeSign (A.E.T.)' },
  { file: 'acospkcs11.dll', name: 'ACS ACOS' },
  { file: 'cmP11.dll', name: 'Charismathics' },
  { file: 'dkck201.dll', name: 'Atos CardOS (dkck201)' },
  { file: 'siecap11.dll', name: 'Atos CardOS API' },
  { file: 'libakisp11.dylib', name: 'TÜBİTAK AKİS (macOS)' },
  { file: 'libakisp11.so', name: 'TÜBİTAK AKİS (Linux)' },
];

const SEARCH_DIRS = process.platform === 'win32'
  ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64')]
  : process.platform === 'darwin'
    ? ['/usr/local/lib', '/Library/AKIS', '/usr/lib']
    : ['/usr/lib', '/usr/local/lib', '/usr/lib/x86_64-linux-gnu'];

export function detectDrivers() {
  const out = [];
  for (const d of KNOWN_DRIVERS) {
    for (const dir of SEARCH_DIRS) {
      const p = path.join(dir, d.file);
      if (fs.existsSync(p)) { out.push({ path: p, name: d.name }); break; }
    }
  }
  return out;
}

function withModule(driverPath, fn) {
  const { PKCS11 } = lib();
  const mod = new PKCS11();
  mod.load(driverPath);
  // NULL init args are spec-legal but some drivers want CKF_OS_LOCKING_OK; try both.
  let initErr = null;
  for (const args of [undefined, { flags: lib().CKF_OS_LOCKING_OK }]) {
    try { mod.C_Initialize(args); initErr = null; break; } catch (e) {
      if (/CRYPTOKI_ALREADY_INITIALIZED/.test(String(e?.message))) { initErr = null; break; }
      initErr = e;
    }
  }
  if (initErr) {
    try { mod.close(); } catch {}
    // AKİS (akisp11 2.x) fails initialisation with ARGUMENTS_BAD when no reader is attached
    if (/ARGUMENTS_BAD|GENERAL_ERROR|DEVICE_ERROR/.test(String(initErr.message))) throw new Error('CKR_NO_READER');
    throw initErr;
  }
  try {
    return fn(mod, lib());
  } finally {
    try { mod.C_Finalize(); } catch {}
    try { mod.close(); } catch {}
  }
}

const trim = (b) => (Buffer.isBuffer(b) ? b.toString('utf8') : String(b ?? '')).replace(/\0/g, '').trim();

function findAll(mod, session, template) {
  mod.C_FindObjectsInit(session, template);
  const out = [];
  for (;;) {
    const batch = mod.C_FindObjects(session, 32);
    if (!batch || !batch.length) break;
    out.push(...batch);
  }
  mod.C_FindObjectsFinal(session);
  return out;
}

/**
 * listCertificates(driverPath) → [{ slot, tokenLabel, tokenSerial, pinFlags, certs: [{ id, label, ...publicView }] }]
 * Certificates are public objects: no PIN is needed to list them.
 */
export function listCertificates(driverPath) {
  return withModule(driverPath, (mod, P) => {
    const tokens = [];
    const slots = mod.C_GetSlotList(true);
    slots.forEach((slot, slotIndex) => {
      const ti = mod.C_GetTokenInfo(slot);
      const session = mod.C_OpenSession(slot, P.CKF_SERIAL_SESSION);
      try {
        const certs = [];
        for (const h of findAll(mod, session, [{ type: P.CKA_CLASS, value: P.CKO_CERTIFICATE }])) {
          const [val, id, label] = mod.C_GetAttributeValue(session, h, [
            { type: P.CKA_VALUE }, { type: P.CKA_ID }, { type: P.CKA_LABEL },
          ]);
          try {
            const info = describeCert(val.value);
            certs.push({ id: Buffer.from(id.value || []).toString('hex'), label: trim(label.value), ...publicView(info) });
          } catch { /* not an X.509 cert we can read */ }
        }
        const f = ti.flags;
        tokens.push({
          slotIndex,
          tokenLabel: trim(ti.label),
          tokenSerial: trim(ti.serialNumber),
          manufacturer: trim(ti.manufacturerID),
          pinCountLow: !!(f & P.CKF_USER_PIN_COUNT_LOW),
          pinFinalTry: !!(f & P.CKF_USER_PIN_FINAL_TRY),
          pinLocked: !!(f & P.CKF_USER_PIN_LOCKED),
          certs,
        });
      } finally {
        try { mod.C_CloseSession(session); } catch {}
      }
    });
    return tokens;
  });
}

/** Map PKCS#11 errors to messages a lawyer can act on. */
export function friendlyError(e) {
  const m = String(e?.message || e);
  if (/PIN_INCORRECT/.test(m)) return 'PIN hatalı. Dikkat: art arda hatalı girişlerde kart bloke olur.';
  if (/PIN_LOCKED/.test(m)) return 'Kartın PIN\'i bloke olmuş. PUK ile açmanız gerekir (sertifika sağlayıcınızın aracıyla).';
  if (/PIN_LEN_RANGE|PIN_INVALID/.test(m)) return 'PIN biçimi geçersiz.';
  if (/CKR_NO_READER/.test(m)) return 'Kart okuyucu bağlı değil (veya sürücü okuyucuya erişemiyor). Okuyucuyu ve kartı takıp "Kartı oku"ya basın.';
  if (/TOKEN_NOT_PRESENT|DEVICE_REMOVED|SLOT_ID_INVALID/.test(m)) return 'Kart/kart okuyucu bulunamadı. Takılı olduğundan emin olun.';
  if (/FUNCTION_CANCELED/.test(m)) return 'İşlem iptal edildi.';
  if (/Cannot load|LoadLibrary|dlopen|not a valid Win32/i.test(m)) return 'Kart sürücüsü yüklenemedi (32/64 bit uyumsuzluğu veya eksik sürücü).';
  return m;
}

/**
 * signContent({ driverPath, slotIndex, certId, pin, content }) → { sgn: Buffer, signer }
 * Logs in, finds the private key with the same CKA_ID as the chosen
 * certificate and produces the CAdES-BES detached signature over content.
 */
export async function signContent({ driverPath, slotIndex, certId, pin, content, signingTime }) {
  const P = lib();
  const idBuf = Buffer.from(certId, 'hex');
  // one PKCS#11 session per step; sign(tbs) is null for the read-only pass
  const onToken = (sign) => withModule(driverPath, (mod) => {
    const slot = mod.C_GetSlotList(true)[slotIndex];
    if (slot == null) throw new Error('CKR_TOKEN_NOT_PRESENT');
    const session = mod.C_OpenSession(slot, P.CKF_SERIAL_SESSION);
    try {
      const [certH] = findAll(mod, session, [{ type: P.CKA_CLASS, value: P.CKO_CERTIFICATE }, { type: P.CKA_ID, value: idBuf }]);
      if (certH == null) throw new Error('Seçilen sertifika kartta bulunamadı.');
      const certDer = Buffer.from(mod.C_GetAttributeValue(session, certH, [{ type: P.CKA_VALUE }])[0].value);
      if (!sign) return { certDer };
      mod.C_Login(session, P.CKU_USER, pin);
      try {
        let [keyH] = findAll(mod, session, [{ type: P.CKA_CLASS, value: P.CKO_PRIVATE_KEY }, { type: P.CKA_ID, value: idBuf }]);
        if (keyH == null) {
          const keys = findAll(mod, session, [{ type: P.CKA_CLASS, value: P.CKO_PRIVATE_KEY }]);
          if (keys.length === 1) keyH = keys[0];
        }
        if (keyH == null) throw new Error('Sertifikaya ait özel anahtar kartta bulunamadı.');
        mod.C_SignInit(session, { mechanism: sign.keyAlg === 'ec' ? P.CKM_ECDSA : P.CKM_RSA_PKCS }, keyH);
        return { signature: Buffer.from(mod.C_Sign(session, sign.tbs, Buffer.alloc(1024))) };
      } finally {
        try { mod.C_Logout(session); } catch {}
      }
    } finally {
      try { mod.C_CloseSession(session); } catch {}
    }
  });

  const { certDer } = onToken(null); // the certificate goes into the signed attributes
  const sgn = await signDetached({
    content,
    certDer,
    signingTime,
    signer: async (tbs, keyAlg) => onToken({ tbs, keyAlg }).signature,
  });
  return { sgn, signer: publicView(describeCert(certDer)) };
}
