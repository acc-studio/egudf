// Compare documents (Word's "Karşılaştır"): original + revised → one document
// showing the revised text with every difference as a tracked change by the
// reviser — inserted words, deleted words (put back with a deletion mark) and
// formatting changes — so the result is reviewed with accept/reject.
//
// Paragraphs are aligned first (LCS on their text); paragraphs that changed
// are paired by similarity and compared word by word.

const REVIEW = new Set(['insertion', 'deletion', 'formatChange', 'comment']);
const cleanMarks = (marks) => (marks || []).filter((m) => !REVIEW.has(m.type));
const fmtKey = (marks) => JSON.stringify(cleanMarks(marks).filter((m) => m.type !== 'udfRun').map((m) => ({ t: m.type, a: m.attrs })).sort((a, b) => a.t.localeCompare(b.t)));

/** Visible text of a block (accepting pending changes in the inputs). */
export function blockText(b) {
  if (b.type === 'text') return b.marks?.some((m) => m.type === 'deletion') ? '' : b.text;
  if (b.type === 'image') return '¸';
  const inner = (b.content || []).map(blockText);
  return b.type === 'tableCell' || b.type === 'tableHeader' ? `${inner.join('\n')}\t` : b.type === 'tableRow' ? `${inner.join('')}\n` : inner.join(b.type === 'doc' ? '\n' : '');
}

/** Inputs may carry tracked changes: compare their accepted state. */
function accepted(block) {
  if (block.type === 'text') {
    if (block.marks?.some((m) => m.type === 'deletion')) return null;
    const marks = cleanMarks(block.marks);
    return marks.length ? { ...block, marks } : { type: 'text', text: block.text };
  }
  if (!block.content) return block;
  const attrs = block.attrs?.fmtChange ? { ...block.attrs, fmtChange: null } : block.attrs;
  return { ...block, ...(attrs ? { attrs } : {}), content: block.content.map(accepted).filter(Boolean) };
}

function lcsPairs(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  let s = 0;
  while (s < n && s < m && eq(a[s], b[s])) s++;
  let e = 0;
  while (e < n - s && e < m - s && eq(a[n - 1 - e], b[m - 1 - e])) e++;
  const N = n - s - e, M = m - s - e;
  const out = [];
  for (let k = 0; k < s; k++) out.push([k, k]);
  if (N && M && N * M <= 6e6) {
    const dp = Array.from({ length: N + 1 }, () => new Uint32Array(M + 1));
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) dp[i][j] = eq(a[s + i], b[s + j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < N && j < M) {
      if (eq(a[s + i], b[s + j])) { out.push([s + i, s + j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
  }
  for (let k = 0; k < e; k++) out.push([n - e + k, m - e + k]);
  return out;
}

const tokenize = (s) => s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];

function similarity(a, b) {
  const A = new Set(tokenize(a).filter((t) => t.trim())), B = new Set(tokenize(b).filter((t) => t.trim()));
  if (!A.size && !B.size) return 1;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return (2 * common) / (A.size + B.size);
}

/** Inline content → [{ ch, marks, node? }] one entry per character (atoms are one char). */
function chars(content) {
  const out = [];
  for (const c of content || []) {
    if (c.type === 'text') for (const ch of c.text) out.push({ ch, marks: c.marks || [] });
    else out.push({ ch: '￼', node: c, marks: c.marks || [] });
  }
  return out;
}

function pushText(out, text, marks) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text' && JSON.stringify(last.marks || []) === JSON.stringify(marks)) last.text += text;
  else out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
}

/** Word-level comparison of two paragraphs' inline content. */
function compareInline(aContent, bContent, mk, stats) {
  const A = chars(aContent), B = chars(bContent);
  const aStr = A.map((c) => c.ch).join(''), bStr = B.map((c) => c.ch).join('');
  const ta = tokenize(aStr), tb = tokenize(bStr);
  const pairs = lcsPairs(ta, tb);
  const offA = [], offB = [];
  let o = 0; for (const t of ta) { offA.push(o); o += t.length; } offA.push(o);
  o = 0; for (const t of tb) { offB.push(o); o += t.length; } offB.push(o);
  const out = [];
  const emitRange = (src, from, to, marks0) => {
    for (let k = from; k < to; k++) {
      const c = src[k];
      if (c.node) { out.push({ ...c.node, marks: [...cleanMarks(c.node.marks), ...marks0] }); continue; }
      pushText(out, c.ch, [...cleanMarks(c.marks), ...marks0]);
    }
  };
  let i = 0, j = 0;
  let prevFmt = false; // a run of reformatted words counts as one change
  const flushGap = (i2, j2) => {
    if (i2 > i || j2 > j) prevFmt = false;
    if (i2 > i) { emitRange(A, offA[i], offA[i2], [mk('deletion')]); stats.deletions++; }
    if (j2 > j) { emitRange(B, offB[j], offB[j2], [mk('insertion')]); stats.insertions++; }
  };
  for (const [pi, pj] of [...pairs, [ta.length, tb.length]]) {
    flushGap(pi, pj);
    if (pi < ta.length) {
      // same word: formatting may still differ
      let changed = false;
      for (let k = 0; k < ta[pi].length; k++) if (fmtKey(A[offA[pi] + k].marks) !== fmtKey(B[offB[pj] + k].marks)) changed = true;
      if (changed) {
        for (let k = 0; k < tb[pj].length; k++) {
          const cb = B[offB[pj] + k], ca = A[offA[pi] + k];
          if (cb.node) { out.push(cb.node); continue; }
          pushText(out, cb.ch, [...cleanMarks(cb.marks), mk('formatChange', { before: cleanMarks(ca.marks).filter((m) => m.type !== 'udfRun') })]);
        }
        if (!prevFmt) stats.formats++;
        prevFmt = true;
      } else { emitRange(B, offB[pj], offB[pj + 1], []); prevFmt = false; }
    }
    i = pi + 1; j = pj + 1;
  }
  return out;
}

function markAll(block, mark) {
  if (block.type === 'text') return { ...block, marks: [...cleanMarks(block.marks), mark] };
  if (block.type === 'image') return { ...block, marks: [...cleanMarks(block.marks), mark] };
  return block.content ? { ...block, content: block.content.map((c) => markAll(c, mark)) } : block;
}

const PARA_KEYS = ['align', 'leftIndent', 'rightIndent', 'firstLineIndent', 'spaceAbove', 'spaceBelow', 'lineSpacing', 'list', 'tabSet'];
function paraPair(a, b, mk, stats) {
  const content = compareInline(a.content, b.content, mk, stats);
  const attrs = { ...(b.attrs || {}) };
  const before = {};
  let fmt = false;
  for (const k of PARA_KEYS) {
    if (JSON.stringify(a.attrs?.[k] ?? null) !== JSON.stringify(b.attrs?.[k] ?? null)) fmt = true;
    before[k] = a.attrs?.[k] ?? null;
  }
  if (fmt) { attrs.fmtChange = { ...mk('x').attrs, before: { ...(a.attrs || {}), ...before, fmtChange: undefined } }; stats.formats++; }
  return { ...b, attrs, ...(content.length ? { content } : { content: undefined }) };
}

function compareBlocks(A, B, mk, stats) {
  const keyText = (x) => `${x.type}|${blockText(x)}`;
  const ka = A.map(keyText), kb = B.map(keyText);
  const pairs = lcsPairs(ka, kb);
  const out = [];
  let i = 0, j = 0;
  const gap = (i2, j2) => {
    // changed region: pair similar blocks of the same kind in order, the rest are whole deletions/insertions
    const as = A.slice(i, i2), bs = B.slice(j, j2);
    let bi = 0;
    for (const a of as) {
      let best = -1, bestSim = 0.35;
      for (let k = bi; k < bs.length && k < bi + 6; k++) {
        if (bs[k].type !== a.type) continue;
        const sim = similarity(blockText(a), blockText(bs[k]));
        if (sim > bestSim) { best = k; bestSim = sim; }
      }
      if (best < 0) { out.push(markAll(a, mk('deletion'))); stats.deletions++; continue; }
      for (; bi < best; bi++) { out.push(markAll(bs[bi], mk('insertion'))); stats.insertions++; }
      out.push(pairBlock(a, bs[best], mk, stats));
      bi = best + 1;
    }
    for (; bi < bs.length; bi++) { out.push(markAll(bs[bi], mk('insertion'))); stats.insertions++; }
  };
  for (const [pi, pj] of [...pairs, [A.length, B.length]]) {
    gap(pi, pj);
    if (pi < A.length) out.push(pairBlock(A[pi], B[pj], mk, stats));
    i = pi + 1; j = pj + 1;
  }
  return out;
}

function pairBlock(a, b, mk, stats) {
  if (b.type === 'paragraph' && a.type === 'paragraph') return paraPair(a, b, mk, stats);
  if (b.type === 'table' && a.type === 'table') {
    // same shape: compare cell by cell; otherwise old table out, new table in
    const shape = (t) => (t.content || []).map((r) => (r.content || []).length).join(',');
    if (shape(a) === shape(b)) {
      return { ...b, content: b.content.map((row, ri) => ({ ...row, content: row.content.map((cell, ci) => ({ ...cell, content: compareBlocks(a.content[ri].content[ci].content || [], cell.content || [], mk, stats) })) })) };
    }
    return b; // caller can't put a whole table "deleted": keep the revised table
  }
  return b;
}

/**
 * compareDocs(original, revised, { author, at }) → { doc, stats }
 * Both docs are editor JSON; the result is the revised document with changes marked.
 */
export function compareDocs(original, revised, { author = 'Karşılaştırma', at = `${new Date().toISOString().slice(0, 16)}Z` } = {}) {
  const mk = (type, extra = {}) => ({ type, attrs: { author, at, ...extra } });
  const stats = { insertions: 0, deletions: 0, formats: 0 };
  const A = (accepted(original).content || []), B = (accepted(revised).content || []);
  const content = compareBlocks(A, B, mk, stats);
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, stats };
}
