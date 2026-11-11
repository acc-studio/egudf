// Review data (comments / tracked changes) stored beside content.xml.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewEntries, readReview, hasReview, REVIEW_ENTRY } from '../src/review/store.js';
import { writeUdf, readUdf } from '../src/udf/zip.js';

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Davacı', marks: [{ type: 'comment', attrs: { id: 'c1' } }] }] }] };
const xml = new TextEncoder().encode('<template format_id="1.8"><content><![CDATA[Davacı\n]]></content></template>');

test('review entry round-trips through the zip and is bound to content.xml', async () => {
  const tab = { review: { comments: [{ id: 'c1', author: 'Ben', text: 'not', replies: [] }] } };
  const extra = await reviewEntries(tab, doc, xml);
  assert.ok(extra[REVIEW_ENTRY]);
  const u = readUdf(writeUdf({ contentXml: xml, extra }));
  const r = await readReview(u.other, u.contentXml);
  assert.equal(r.stale, false);
  assert.deepEqual(r.doc, doc);
  assert.equal(r.comments[0].text, 'not');
  const changed = await readReview(u.other, new TextEncoder().encode('<template/>'));
  assert.equal(changed.stale, true);
  assert.equal(changed.doc, null, 'edited outside egUDF → marks not reused');
});

test('no review entry when there is nothing to keep', async () => {
  const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
  assert.equal(hasReview({ review: { comments: [] } }, plain), false);
  assert.deepEqual(await reviewEntries({ review: { comments: [] } }, plain, xml), {});
  assert.equal(hasReview({}, { type: 'doc', content: [{ type: 'text', text: 'y', marks: [{ type: 'insertion' }] }] }), true);
});
