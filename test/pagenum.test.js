// pageNumber-spec flags: the values written for each position/format are the
// ones real UYAP files use (BSP32_72, _40, _2120, _2088).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPageNumber, writePageNumber, pageLabel } from '../src/udf/pagenum.js';

test('spec values match those seen in UYAP files', () => {
  const spec = (o) => writePageNumber({}, o)['pageNumber-spec'];
  assert.equal(spec({ pos: 'right', total: false }), 'BSP32_72');
  assert.equal(spec({ pos: 'center', total: false }), 'BSP32_40');
  assert.equal(spec({ pos: 'right', total: true }), 'BSP32_2120');
  assert.equal(spec({ pos: 'center', total: true }), 'BSP32_2088');
});

test('read/write round trip, labels, removal', () => {
  const a = writePageNumber({ background: '-1' }, { pos: 'left', vert: 'top', total: true, prefix: 'Sayfa ', start: 3, bold: true });
  const o = readPageNumber(a);
  assert.deepEqual([o.pos, o.vert, o.total, o.prefix, o.start, o.bold], ['left', 'top', true, 'Sayfa ', 3, true]);
  assert.equal(pageLabel(o, 0, 4), 'Sayfa 3 / 6');
  assert.equal(a.background, '-1');
  const gone = writePageNumber(a, null);
  assert.equal(readPageNumber(gone).on, false);
  assert.equal(gone.background, '-1');
  assert.equal(pageLabel(readPageNumber({ 'pageNumber-spec': 'BSP32_72' }), 4, 9), '5');
});
