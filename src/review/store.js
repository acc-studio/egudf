// Review data (comments, tracked changes) inside the .udf zip.
//
// UDF has no comment/revision structures, so egUDF keeps them in an extra zip
// entry next to content.xml: { v, contentSha256, doc, comments }. `doc` is the
// editor document *with* review marks; it is only reused when content.xml is
// byte-identical to the one it was written with (contentSha256). Signing writes
// a clean file without this entry, so filed documents never carry it.
export const REVIEW_ENTRY = 'egudf/review.json';

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** → { doc|null, comments, stale } from the zip's `other` entries. */
export async function readReview(other, contentXml) {
  const raw = other?.[REVIEW_ENTRY];
  if (!raw) return null;
  try {
    const r = JSON.parse(new TextDecoder().decode(raw));
    const fresh = r.contentSha256 === await sha256Hex(contentXml);
    return { doc: fresh ? r.doc : null, comments: Array.isArray(r.comments) ? r.comments : [], tracking: !!r.tracking, stale: !fresh };
  } catch { return null; }
}

/** True when the tab holds anything worth persisting. */
export function hasReview(tab, docJson) {
  if (tab.review?.comments?.length || tab.review?.tracking || tab.review?.shared) return true;
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (n.attrs?.fmtChange || n.marks?.some((m) => m.type === 'insertion' || m.type === 'deletion' || m.type === 'formatChange')) { found = true; return; }
    n.content?.forEach(walk);
  };
  walk(docJson);
  return found;
}

/** → { [REVIEW_ENTRY]: bytes } or {} */
export async function reviewEntries(tab, docJson, contentXml) {
  if (!hasReview(tab, docJson)) return {};
  const payload = { v: 1, app: 'egUDF', contentSha256: await sha256Hex(contentXml), comments: tab.review?.comments || [], tracking: !!tab.review?.tracking, doc: docJson };
  return { [REVIEW_ENTRY]: new TextEncoder().encode(JSON.stringify(payload)) };
}
