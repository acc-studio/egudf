// egUDF — Electron main process.
// File IO, dialogs, e-imza (PKCS#11, CAdES-BES) and the UYAP Avukat Portal
// window. Documents never leave the machine except through the user's own
// actions inside the UYAP portal window.
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, clipboard } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectDrivers, listCertificates, signContent, friendlyError } from './sign/pkcs11.js';
import { verifyDetached } from './sign/verify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (argv.includes(`--${name}`) ? '' : null);
const SMOKE = flag('smoke');
const DEFAULT_UYAP_URL = 'https://avukatbeta.uyap.gov.tr/';

const udfArgs = (list) => list.filter((a) => !a.startsWith('--') && /\.udf$/i.test(a) && fs.existsSync(a)).map((a) => path.resolve(a));

// Renamed from "UDF Editör": carry over settings, recents (localStorage) and the
// UYAP portal session from the old userData folder on first launch.
(function migrateUserData() {
  try {
    const now = app.getPath('userData');
    const old = path.join(app.getPath('appData'), 'UDF Editör');
    // Electron creates the (empty) userData folder before this runs, so test for
    // a file Chromium only writes once the profile has been used.
    if (path.resolve(now) === path.resolve(old) || fs.existsSync(path.join(now, 'Preferences')) || !fs.existsSync(old)) return;
    fs.cpSync(old, now, { recursive: true, filter: (src) => !/[\\/](Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache)$|[\\/](SingletonLock|lockfile|DevToolsActivePort)$/.test(src) });
  } catch (e) { console.error('userData migration failed', e); }
})();

if (SMOKE == null && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let uyapWin = null;
let pendingOpen = udfArgs(argv);
let allowClose = false;

// ------------------------------------------------------------------ settings
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  const s = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  return s;
}

// ------------------------------------------------------------------ window
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'egUDF',
    backgroundColor: '#f4f4f5',
    autoHideMenuBar: true,
    show: SMOKE == null,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  setupSpellcheck(win.webContents.session);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen.length) { win.webContents.send('open-paths', pendingOpen); pendingOpen = []; }
    if (SMOKE != null) runSmoke().catch((e) => { console.error('SMOKE FAILED', e); app.exit(1); });
  });
  win.webContents.on('context-menu', (_e, p) => contextMenu(win, p));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (allowClose || SMOKE != null) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
  });
  win.on('closed', () => { win = null; });
}

// Spellcheck uses the OS checker (Windows/macOS); Hunspell downloads are
// pointed at a dead local URL so nothing is fetched from Google.
function setupSpellcheck(ses) {
  try {
    ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/');
    const avail = ses.availableSpellCheckerLanguages || [];
    const langs = ['tr', 'tr-TR', 'en-US', 'en-GB'].filter((l) => avail.includes(l));
    if (langs.length) ses.setSpellCheckerLanguages(langs);
  } catch { /* macOS: language choice is automatic */ }
}

function contextMenu(w, p) {
  const items = [];
  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => w.webContents.replaceMisspelling(s) });
    if (!p.dictionarySuggestions.length) items.push({ label: 'Öneri yok', enabled: false });
    items.push({ label: 'Sözlüğe ekle', click: () => w.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ label: 'Kes', role: 'cut', enabled: p.editFlags.canCut });
    items.push({ label: 'Kopyala', role: 'copy', enabled: p.editFlags.canCopy });
    items.push({ label: 'Yapıştır', role: 'paste', enabled: p.editFlags.canPaste });
    items.push({ label: 'Biçimlendirmeden yapıştır', role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste });
    items.push({ type: 'separator' }, { label: 'Tümünü seç', role: 'selectAll' });
  } else if (p.selectionText) {
    items.push({ label: 'Kopyala', role: 'copy' });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: w });
}

app.on('second-instance', (_e, args) => {
  const files = udfArgs(args.slice(1));
  if (win) {
    if (files.length) win.webContents.send('open-paths', files);
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(createWindow);
// With the Windows spellchecker active, Chromium can sit ~100s in shutdown
// after the last window closes (and would keep the single-instance lock, so
// the next double-clicked .udf would go nowhere). By now every document is
// saved or explicitly discarded: flush storage, then terminate.
app.on('window-all-closed', async () => {
  try {
    await Promise.all([session.defaultSession, session.fromPartition('persist:uyap')].map(async (s) => {
      s.flushStorageData();
      await s.cookies.flushStore();
    }));
  } catch {}
  await new Promise((r) => setTimeout(r, 250)); // let LevelDB finish the flush
  // timers stop once app.quit() starts, so terminate directly
  process.kill(process.pid, 'SIGKILL');
});
app.on('open-file', (e, p) => { // macOS
  e.preventDefault();
  if (win) win.webContents.send('open-paths', [p]); else pendingOpen.push(p);
});

// ------------------------------------------------------------------ files
ipcMain.handle('dialog:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'UYAP belgesi aç',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'UYAP Doküman (.udf)', extensions: ['udf'] }, { name: 'Tüm dosyalar', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('file:read', (_e, p) => new Uint8Array(fs.readFileSync(p)));
ipcMain.handle('file:write', (_e, p, bytes) => {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(bytes));
  fs.renameSync(tmp, p);
  return true;
});
ipcMain.handle('file:exists', (_e, p) => fs.existsSync(p));
ipcMain.handle('dialog:save', async (_e, { defaultPath, kind }) => {
  const filters = kind === 'pdf'
    ? [{ name: 'PDF', extensions: ['pdf'] }]
    : [{ name: 'UYAP Doküman (.udf)', extensions: ['udf'] }];
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultPath || app.getPath('documents'), filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:image', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Resim', extensions: ['png', 'jpg', 'jpeg', 'gif'] }] });
  if (r.canceled) return null;
  return { name: path.basename(r.filePaths[0]), bytes: new Uint8Array(fs.readFileSync(r.filePaths[0])) };
});
ipcMain.handle('font:bundled', (_e, name) => {
  if (!/^[\w-]+\.ttf$/.test(name)) throw new Error('bad font');
  return new Uint8Array(fs.readFileSync(path.join(__dirname, 'assets', 'fonts', name)));
});
ipcMain.handle('shell:showInFolder', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('app:close-ok', () => { allowClose = true; win?.close(); });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, smoke: SMOKE != null }));
ipcMain.handle('clipboard:writeText', (_e, t) => clipboard.writeText(String(t)));

// egPDF interop: hand a PDF rendition to egPDF (print, annotate, combine) —
// falls back to the system PDF viewer when egPDF isn't installed.
function findEgpdf() {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'egpdf', 'egPDF.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'egPDF', 'egPDF.exe')]
    : process.platform === 'darwin' ? ['/Applications/egPDF.app/Contents/MacOS/egPDF'] : [];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}
ipcMain.handle('egpdf:available', () => !!findEgpdf());
ipcMain.handle('egpdf:open', async (_e, bytes, name) => {
  const dir = path.join(os.tmpdir(), 'egudf');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(name || 'belge').replace(/[\\/:*?"<>|]/g, '_')}.pdf`);
  fs.writeFileSync(file, Buffer.from(bytes));
  const exe = findEgpdf();
  if (exe) spawn(exe, [file], { detached: true, stdio: 'ignore' }).unref();
  else await shell.openPath(file);
  return { file, egpdf: !!exe };
});

// ------------------------------------------------------------------ settings ipc
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch));

// ------------------------------------------------------------------ e-imza
ipcMain.handle('sign:drivers', () => {
  const found = detectDrivers();
  const custom = readSettings().driverPath;
  if (custom && fs.existsSync(custom) && !found.some((d) => d.path.toLowerCase() === custom.toLowerCase())) found.unshift({ path: custom, name: path.basename(custom) });
  return found;
});
ipcMain.handle('sign:pickDriver', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'PKCS#11 kart sürücüsü seç',
    defaultPath: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/lib',
    properties: ['openFile'],
    filters: [{ name: 'PKCS#11 kütüphanesi', extensions: process.platform === 'win32' ? ['dll'] : ['so', 'dylib'] }],
  });
  if (r.canceled) return null;
  writeSettings({ driverPath: r.filePaths[0] });
  return { path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
});
ipcMain.handle('sign:list', async (_e, driverPath) => {
  try { return { ok: true, tokens: listCertificates(driverPath) }; } catch (e) { return { ok: false, error: friendlyError(e) }; }
});
ipcMain.handle('sign:sign', async (_e, { driverPath, slotIndex, certId, pin, content }) => {
  try {
    const { sgn, signer } = await signContent({ driverPath, slotIndex, certId, pin, content: Buffer.from(content) });
    // sanity: never hand back a signature that doesn't verify
    const v = verifyDetached(sgn, Buffer.from(content));
    if (!v.valid) throw new Error('Üretilen imza doğrulanamadı; belge imzalanmadı.');
    writeSettings({ driverPath, lastCertId: certId });
    return { ok: true, sgn: new Uint8Array(sgn), signer, verification: v };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
});
ipcMain.handle('sign:verify', (_e, { sign, content }) => {
  try { return { ok: true, ...verifyDetached(Buffer.from(sign), Buffer.from(content)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ------------------------------------------------------------------ UYAP portal
function uyapUrl() { return readSettings().uyapUrl || DEFAULT_UYAP_URL; }

function openUyap() {
  if (uyapWin && !uyapWin.isDestroyed()) { uyapWin.show(); uyapWin.focus(); return; }
  const ses = session.fromPartition('persist:uyap');
  if (!ses.__udfDownloads) {
    ses.__udfDownloads = true;
    ses.on('will-download', (_e, item) => {
      const dir = path.join(app.getPath('downloads'), 'UYAP');
      fs.mkdirSync(dir, { recursive: true });
      let target = path.join(dir, item.getFilename());
      for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, item.getFilename().replace(/(\.[^.]*)?$/, ` (${i})$1`));
      item.setSavePath(target);
      item.once('done', (_ev, state) => {
        if (state !== 'completed') return;
        if (/\.udf$/i.test(target) && win) { win.webContents.send('open-paths', [target]); win.focus(); }
        else win?.webContents.send('toast', `İndirildi: ${path.basename(target)}`, target);
      });
    });
  }
  uyapWin = new BrowserWindow({
    width: 1320,
    height: 920,
    title: 'UYAP Avukat Portal',
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:uyap', contextIsolation: true, sandbox: true, spellcheck: true },
  });
  uyapWin.loadURL(uyapUrl());
  uyapWin.webContents.on('context-menu', (_e, p) => contextMenu(uyapWin, p));
  uyapWin.on('closed', () => { uyapWin = null; win?.webContents.send('uyap:state', false); });
  win?.webContents.send('uyap:state', true);
}
ipcMain.handle('uyap:open', () => { openUyap(); return true; });
ipcMain.handle('uyap:isOpen', () => !!(uyapWin && !uyapWin.isDestroyed()));

/**
 * Put a file into the portal's <input type=file> (the same thing the user does
 * by picking it in the browse dialog), via the DevTools protocol. Walks
 * iframes and shadow roots; prefers inputs whose accept= allows .udf.
 */
async function attachToUyap(filePath) {
  if (!uyapWin || uyapWin.isDestroyed()) throw new Error('Önce UYAP penceresini açın ve evrak gönderme ekranına gelin.');
  const dbg = uyapWin.webContents.debugger;
  const own = !dbg.isAttached();
  if (own) dbg.attach('1.3');
  try {
    const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const inputs = [];
    (function walk(n) {
      if (!n) return;
      if (n.nodeName === 'INPUT') {
        const a = {};
        for (let i = 0; i < (n.attributes || []).length; i += 2) a[n.attributes[i].toLowerCase()] = n.attributes[i + 1];
        if ((a.type || '').toLowerCase() === 'file') inputs.push({ id: n.backendNodeId, accept: (a.accept || '').toLowerCase() });
      }
      (n.children || []).forEach(walk);
      (n.shadowRoots || []).forEach(walk);
      if (n.contentDocument) walk(n.contentDocument);
    })(root);
    if (!inputs.length) throw new Error('Portal sayfasında dosya yükleme alanı bulunamadı. Evrak ekleme ekranını açıp tekrar deneyin.');
    const pick = inputs.find((i) => /udf/.test(i.accept)) || inputs.find((i) => !i.accept || i.accept === '*' || /\*/.test(i.accept)) || inputs[inputs.length - 1];
    await dbg.sendCommand('DOM.setFileInputFiles', { files: [filePath], backendNodeId: pick.id });
    uyapWin.show();
    uyapWin.focus();
    return { inputs: inputs.length };
  } finally {
    if (own) try { dbg.detach(); } catch {}
  }
}
ipcMain.handle('uyap:attach', async (_e, filePath) => {
  try { return { ok: true, ...(await attachToUyap(filePath)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ------------------------------------------------------------------ smoke test
// `electron . --smoke=<dir> [file.udf]` — the renderer drives a scenario
// (window.__smoke), we capture screenshots, write results.json and exit.
async function runSmoke() {
  const out = path.resolve(SMOKE || 'test/.out');
  fs.mkdirSync(out, { recursive: true });
  win.setSize(1440, 940);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  await wait(800);
  if (flag('pgdebug') != null) await win.webContents.executeJavaScript('window.__pgDebugOnly = true');
  const steps = await win.webContents.executeJavaScript('window.__smoke.steps()');
  const results = {};
  for (const step of steps) {
    try {
      const t0 = Date.now();
      results[step] = await win.webContents.executeJavaScript(`window.__smoke.run(${JSON.stringify(step)}, ${JSON.stringify(out)})`);
      if (results[step] && typeof results[step] === 'object') results[step].ms = Date.now() - t0;
    } catch (e) { results[step] = { ok: false, error: String(e.message || e) }; }
    await wait(700);
    await shot(step);
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  // After capturePage() Electron (Windows) lingers ~100s in app.exit; the
  // harness terminates hard instead. The real app never captures pages.
  process.exitCode = Object.values(results).every((r) => r?.ok !== false) ? 0 : 2;
  process.kill(process.pid, 'SIGKILL');
}
