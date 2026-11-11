// Three-way merge of documents (ProseMirror JSON) for shared editing over a
// synced folder: base = the version both sides last agreed on, mine = the
// open editor, theirs = what arrived on disk. Works on top-level blocks
// (paragraphs, tables): blocks changed on one side only are taken from that
// side; where both sides changed the same place differently, my version is
// kept and theirs is added after it as a tracked insertion by its author, so
// nothing is lost and the conflict is resolved with accept/reject.

const key = (b) => JSON.stringify(b);

/** Longest common subsequence of a and b (arrays of strings) → [[i, j], …]. */
function lcs(a, b) {
  const n = a.length, m = b.length;
  // trim common prefix/suffix first: typical edits touch a few blocks
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const A = a.slice(s, n - e), B = b.slice(s, m - e);
  const N = A.length, M = B.length;
  const dp = Array.from({ length: N + 1 }, () => new Uint32Array(M + 1));
  for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  for (let k = 0; k < s; k++) out.push([k, k]);
  let i = 0, j = 0;
  while (i < N && j < M) {
    if (A[i] === B[j]) { out.push([s + i, s + j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  for (let k = 0; k < e; k++) out.push([n - e + k, m - e + k]);
  return out;
}

/**
 * diff3 over arrays of keys → chunks:
 *   { ok: [keys] }                       stable or one-sided change
 *   { conflict: { base, mine, theirs } }  (arrays of indexes into each side)
 */
export function diff3(base, mine, theirs) {
  const mm = new Map(lcs(base, mine).map(([i, j]) => [i, j]));
  const tm = new Map(lcs(base, theirs).map(([i, j]) => [i, j]));
  const out = [];
  let b = 0, m = 0, t = 0;
  const flush = (b2, m2, t2) => {
    const B = base.slice(b, b2), M = mine.slice(m, m2), T = theirs.slice(t, t2);
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    if (B.length || M.length || T.length) {
      if (same(M, B)) out.push({ take: 'theirs', from: t, to: t2 });
      else if (same(T, B) || same(M, T)) out.push({ take: 'mine', from: m, to: m2 });
      else out.push({ conflict: { base: [b, b2], mine: [m, m2], theirs: [t, t2] } });
    }
  };
  for (let i = 0; i <= base.length; i++) {
    const stable = i === base.length || (mm.has(i) && tm.has(i) && mm.get(i) >= m && tm.get(i) >= t);
    if (!stable) continue;
    const m2 = i === base.length ? mine.length : mm.get(i);
    const t2 = i === base.length ? theirs.length : tm.get(i);
    flush(i, m2, t2);
    if (i < base.length) { out.push({ take: 'mine', from: m2, to: m2 + 1 }); b = i + 1; m = m2 + 1; t = t2 + 1; }
  }
  return out;
}

function markInserted(block, author, at) {
  const mark = { type: 'insertion', attrs: { author, at } };
  const walk = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks || []).filter((x) => x.type !== 'insertion' && x.type !== 'deletion');
      return { ...n, marks: [...marks, mark] };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(block);
}

/**
 * merge3(base, mine, theirs, { theirAuthor }) → { doc, conflicts, changed }
 * Each argument is a doc JSON ({ type: 'doc', content: [...] }).
 */
export function merge3(base, mine, theirs, { theirAuthor = 'Diğer kullanıcı', at = `${new Date().toISOString().slice(0, 16)}Z`, keyFn = key } = {}) {
  const B = (base.content || []), M = (mine.content || []), T = (theirs.content || []);
  // keyFn: how blocks are compared (JSON by default; a codec round trip when one side wasn't saved by egUDF)
  const kb = B.map(keyFn), km = M.map(keyFn), kt = T.map(keyFn);
  const chunks = diff3(kb, km, kt);
  const content = [];
  let conflicts = 0;
  for (const c of chunks) {
    if (c.take === 'mine') content.push(...M.slice(c.from, c.to));
    else if (c.take === 'theirs') content.push(...T.slice(c.from, c.to));
    else {
      conflicts++;
      const { mine: [m0, m1], theirs: [t0, t1] } = c.conflict;
      content.push(...M.slice(m0, m1));
      // their blocks that I don't already have, as tracked insertions
      const have = new Set(km.slice(m0, m1));
      for (const blk of T.slice(t0, t1)) if (!have.has(keyFn(blk))) content.push(markInserted(blk, theirAuthor, at));
    }
  }
  if (!content.length) content.push({ type: 'paragraph' });
  const doc = { ...mine, content };
  return { doc, conflicts, changed: key(doc) !== key(mine) };
}

/** Comment threads: union by id; for the same id keep the newer text and all replies. */
export function mergeComments(mine = [], theirs = []) {
  const out = new Map(mine.map((c) => [c.id, { ...c, replies: [...(c.replies || [])] }]));
  for (const c of theirs) {
    const m = out.get(c.id);
    if (!m) { out.set(c.id, { ...c, replies: [...(c.replies || [])] }); continue; }
    if ((c.editedAt || c.at || '') > (m.editedAt || m.at || '')) { m.text = c.text; m.editedAt = c.editedAt; }
    m.resolved = m.resolved || c.resolved;
    const seen = new Set(m.replies.map((r) => `${r.author}|${r.at}|${r.text}`));
    for (const r of c.replies || []) if (!seen.has(`${r.author}|${r.at}|${r.text}`)) m.replies.push(r);
    m.replies.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }
  return [...out.values()];
}

/** Indexes [from, to) of the top-level blocks that differ between two docs (for a minimal editor update). */
export function changedRange(a, b) {
  const A = (a.content || []).map(key), B = (b.content || []).map(key);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  return { from: s, toA: A.length - e, toB: B.length - e, same: s === A.length && A.length === B.length };
}
