// Packaging: every file the app loads at runtime must be shipped by
// electron-builder (`build.files`). `npm start` runs from the source tree, so a
// missing entry only shows up in the installed app — e.g. an unstyled window
// because src/styles.css wasn't packaged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const shipped = (rel) => pkg.build.files.some((p) => (p.endsWith('/**') ? rel.startsWith(p.slice(0, -2)) : rel === p));

function runtimeRefs() {
  const refs = new Set([pkg.main]);
  for (const m of read('index.html').matchAll(/\b(?:href|src)="([^"#:]+)"/g)) refs.add(m[1]);
  // path.join(__dirname, 'a', 'b', ...) with literal segments
  for (const m of read(pkg.main).matchAll(/path\.join\(__dirname((?:\s*,\s*'[^']+')+)/g)) {
    refs.add([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/'));
  }
  for (const m of read(pkg.main).matchAll(/from '\.\/([^']+)'/g)) refs.add(m[1]);
  return [...refs];
}

test('every runtime file is included in the packaged app', () => {
  const refs = runtimeRefs();
  assert.ok(refs.includes('index.html') && refs.some((r) => r.endsWith('.css')), `expected to find index.html and a stylesheet, got ${refs}`);
  const missing = refs.filter((r) => !shipped(r));
  assert.deepEqual(missing, [], `not in package.json build.files: ${missing.join(', ')}`);
});

test('runtime files exist on disk (after npm run build)', () => {
  const missing = runtimeRefs().filter((r) => !r.endsWith('/') && !fs.existsSync(path.join(root, r)) && !r.startsWith('dist/'));
  assert.deepEqual(missing, []);
});
