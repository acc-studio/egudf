// Publish the current version to GitHub Releases (acc-studio/egudf), the feed
// installed copies auto-update from (lib/updater.js).
//
//   node tools/release.mjs        (after `npm run dist` built release/egUDF Setup <v>.exe)
//
// Uploads the installer, its blockmap and a latest.yml computed from the
// installer itself (electron-builder's own publish raced itself creating the
// release and left a stale latest.yml). Notes = this version's ITERATIONS.md entry
// plus a download footer.
//
// Also uploads the installer under a version-less name (egUDF-Setup.exe) so
// https://github.com/acc-studio/egudf/releases/latest/download/egUDF-Setup.exe
// always serves the newest build (README + repo homepage link there).
// The release is tagged at HEAD, which must be committed and pushed.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'acc-studio/egudf';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('uncommitted changes: commit before releasing');
const head = git('rev-parse', 'HEAD');
git('fetch', '-q', 'origin');
if (!git('branch', '-r', '--contains', head)) throw new Error('HEAD is not pushed: git push first');

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const exe = path.join('release', `egUDF Setup ${version}.exe`);
if (!fs.existsSync(exe)) throw new Error(`${exe} not found: run npm run dist first`);
const bytes = fs.readFileSync(exe);
const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
const name = `egUDF-Setup-${version}.exe`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egudf-release-'));
fs.copyFileSync(exe, path.join(dir, name));
fs.copyFileSync(exe, path.join(dir, 'egUDF-Setup.exe'));
fs.copyFileSync(`${exe}.blockmap`, path.join(dir, `${name}.blockmap`));
fs.writeFileSync(path.join(dir, 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
// release notes: the "## <version>:" section of ITERATIONS.md
const it = fs.readFileSync('ITERATIONS.md', 'utf8');
const start = it.indexOf(`## ${version}:`);
const next = start < 0 ? -1 : it.indexOf('\n## ', start + 4);
const notes = start < 0 ? `egUDF ${version}` : it.slice(start, next < 0 ? undefined : next).trim();
const footer = `\n\n---\n\n**İndir / Download:** [${name}](https://github.com/${REPO}/releases/download/v${version}/${name}) (Windows 10/11, 64-bit). `
  + 'Yüklü kopyalar kendini otomatik günceller. / Installed copies update themselves.\n\n'
  + `Tüm sürümler / All versions: https://github.com/${REPO}/releases · Geçmiş / Changelog: [ITERATIONS.md](https://github.com/${REPO}/blob/v${version}/ITERATIONS.md)`;
fs.writeFileSync(path.join(dir, 'notes.md'), notes.replace(/^## [^\n]*\n+/, '') + footer);
const title = start < 0 ? `egUDF ${version}` : notes.split('\n')[0].replace(/^##\s*/, 'egUDF ');
execFileSync('gh', ['release', 'create', `v${version}`, '-R', REPO, '--target', head, '--latest', '--title', title, '--notes-file', path.join(dir, 'notes.md'),
  path.join(dir, name), path.join(dir, `${name}.blockmap`), path.join(dir, 'latest.yml'), path.join(dir, 'egUDF-Setup.exe')], { stdio: 'inherit' });
console.log(`published v${version}`);
