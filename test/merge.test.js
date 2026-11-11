// Three-way merge used for shared editing over OneDrive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { merge3, mergeComments, changedRange } from '../src/collab/merge.js';

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const D = (...ts) => ({ type: 'doc', content: ts.map(P) });
const texts = (d) => d.content.map((b) => b.content.map((c) => c.text).join(''));

test('edits in different paragraphs are combined', () => {
  const base = D('a', 'b', 'c', 'd');
  const mine = D('a', 'B (ben)', 'c', 'd');
  const theirs = D('a', 'b', 'c', 'D (o)', 'e');
  const r = merge3(base, mine, theirs);
  assert.deepEqual(texts(r.doc), ['a', 'B (ben)', 'c', 'D (o)', 'e']);
  assert.equal(r.conflicts, 0);
});

test('insertions and deletions on both sides', () => {
  const base = D('1', '2', '3', '4', '5');
  const mine = D('0', '1', '2', '4', '5'); // insert at top, delete 3
  const theirs = D('1', '2', '3', '4', '4b', '5'); // insert after 4
  assert.deepEqual(texts(merge3(base, mine, theirs).doc), ['0', '1', '2', '4', '4b', '5']);
});

test('same paragraph changed by both: mine kept, theirs added as tracked insertion', () => {
  const base = D('x', 'Davacı vekili', 'z');
  const mine = D('x', 'Davacı vekili Av. A', 'z');
  const theirs = D('x', 'Davacı vekili Av. B', 'z');
  const r = merge3(base, mine, theirs, { theirAuthor: 'Ayşe' });
  assert.equal(r.conflicts, 1);
  assert.deepEqual(texts(r.doc), ['x', 'Davacı vekili Av. A', 'Davacı vekili Av. B', 'z']);
  const ins = r.doc.content[2].content[0].marks.find((m) => m.type === 'insertion');
  assert.equal(ins.attrs.author, 'Ayşe');
});

test('identical changes on both sides are not duplicated; no-op merges report unchanged', () => {
  const base = D('a', 'b');
  const both = D('a', 'b!', 'c');
  const r = merge3(base, both, both);
  assert.deepEqual(texts(r.doc), ['a', 'b!', 'c']);
  assert.equal(r.changed, false);
  assert.equal(merge3(base, D('a', 'b'), D('a', 'b')).changed, false);
});

test('comments: union by id, replies merged', () => {
  const m = [{ id: 'c1', text: 'x', at: '1', replies: [{ author: 'A', at: '2', text: 'r1' }] }];
  const t = [{ id: 'c1', text: 'x2', at: '1', editedAt: '3', replies: [{ author: 'B', at: '4', text: 'r2' }] }, { id: 'c2', text: 'y', replies: [] }];
  const r = mergeComments(m, t);
  assert.equal(r.length, 2);
  assert.equal(r[0].text, 'x2');
  assert.deepEqual(r[0].replies.map((x) => x.text), ['r1', 'r2']);
});

test('changedRange finds the differing blocks', () => {
  assert.deepEqual(changedRange(D('a', 'b', 'c'), D('a', 'B', 'c')), { from: 1, toA: 2, toB: 2, same: false });
  assert.equal(changedRange(D('a'), D('a')).same, true);
});
