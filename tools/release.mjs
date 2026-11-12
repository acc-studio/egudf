// Publish the current version to GitHub Releases (acc-studio/egudf), the feed
// installed copies auto-update from (lib/updater.js).
//
//   node tools/release.mjs        (after `npm run dist` built release/egUDF Setup <v>.exe)
//
// Uploads the installer, its blockmap and a latest.yml computed from the
// installer itself (electron-builder's own publish raced itself creating the
// release and left a stale latest.yml). Notes = this version's ITERATIONS.md entry.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const exe = path.join('release', `egUDF Setup ${version}.exe`);
if (!fs.existsSync(exe)) throw new Error(`${exe} not found: run npm run dist first`);
const bytes = fs.readFileSync(exe);
const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
const name = `egUDF-Setup-${version}.exe`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egudf-release-'));
fs.copyFileSync(exe, path.join(dir, name));
fs.copyFileSync(`${exe}.blockmap`, path.join(dir, `${name}.blockmap`));
fs.writeFileSync(path.join(dir, 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
// release notes: the "## <version>:" section of ITERATIONS.md
const it = fs.readFileSync('ITERATIONS.md', 'utf8');
const start = it.indexOf(`## ${version}:`);
const next = start < 0 ? -1 : it.indexOf('\n## ', start + 4);
const notes = start < 0 ? `egUDF ${version}` : it.slice(start, next < 0 ? undefined : next).trim();
fs.writeFileSync(path.join(dir, 'notes.md'), notes);
const title = start < 0 ? `egUDF ${version}` : notes.split('\n')[0].replace(/^##\s*/, 'egUDF ');
execFileSync('gh', ['release', 'create', `v${version}`, '-R', 'acc-studio/egudf', '--title', title, '--notes-file', path.join(dir, 'notes.md'),
  path.join(dir, name), path.join(dir, `${name}.blockmap`), path.join(dir, 'latest.yml')], { stdio: 'inherit' });
console.log(`published v${version}`);
