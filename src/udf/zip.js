// .udf container: a plain ZIP. content.xml (the document), optionally
// sign.sgn (detached CAdES signature over content.xml) and
// documentproperties.xml (UYAP doğrulama kodu / sicil, added by UYAP after
// filing). Entry order matches what the UYAP editor writes.
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

export function isZip(bytes) {
  return bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** readUdf(bytes) → { contentXml (Uint8Array), contentText, sign, docProps, other } */
export function readUdf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isZip(u8)) throw new Error('Bu dosya bir UYAP belgesi değil (ZIP değil).');
  const files = unzipSync(u8);
  const contentXml = files['content.xml'];
  if (!contentXml) throw new Error('Bu dosya bir UYAP belgesi değil (content.xml yok).');
  const other = {};
  for (const [k, v] of Object.entries(files)) {
    if (!['content.xml', 'sign.sgn', 'documentproperties.xml'].includes(k)) other[k] = v;
  }
  return {
    contentXml,
    contentText: strFromU8(contentXml),
    sign: files['sign.sgn'] || null,
    docProps: files['documentproperties.xml'] || null,
    other,
  };
}

/** writeUdf({ contentXml (string|Uint8Array), sign?, docProps? }) → Uint8Array */
export function writeUdf({ contentXml, sign = null, docProps = null }) {
  const entries = {};
  if (docProps) entries['documentproperties.xml'] = [docProps, { level: 6 }];
  entries['content.xml'] = [typeof contentXml === 'string' ? strToU8(contentXml) : contentXml, { level: 6 }];
  if (sign) entries['sign.sgn'] = [sign, { level: 6 }];
  return zipSync(entries);
}

export { strToU8, strFromU8 };
