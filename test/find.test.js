// Find options (case, whole word, regex) and Turkish case folding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { baseExtensions } from '../src/editor/index.js';
import { findMatches, replacementFor, searchRegex } from '../src/editor/extensions.js';

const schema = getSchema(baseExtensions());
const doc = (text, del = null) => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: del
  ? [{ type: 'text', text }, { type: 'text', text: del, marks: [{ type: 'deletion', attrs: { author: 'a', at: '' } }] }]
  : [{ type: 'text', text }] }] });

test('match case, whole word and Turkish folding', () => {
  const d = doc('Dava davacı DAVA ıslak ISLAK İzmir izmir');
  assert.equal(findMatches(d, { query: 'dava' }).length, 3);
  assert.equal(findMatches(d, { query: 'dava', wholeWord: true }).length, 2);
  assert.equal(findMatches(d, { query: 'Dava', matchCase: true }).length, 1);
  assert.equal(findMatches(d, { query: 'ıslak' }).length, 2, 'I folds to ı');
  assert.equal(findMatches(d, { query: 'İZMİR' }).length, 2, 'İ folds to i');
});

test('regex search and $n replacement; deleted text is skipped', () => {
  const d = doc('2024/15 E. 2023/7 K.');
  const o = { query: '(\\d{4})/(\\d+)', regex: true };
  const m = findMatches(d, o);
  assert.equal(m.length, 2);
  assert.equal(replacementFor(o, m[0], '$2/$1'), '15/2024');
  assert.equal(replacementFor({ query: 'E.' }, { text: 'E.' }, '$1'), '$1', 'literal outside regex mode');
  assert.ok(searchRegex({ query: '(', regex: true }).error);
  assert.equal(findMatches(doc('ab ', 'dava'), { query: 'dava' }).length, 0);
});
