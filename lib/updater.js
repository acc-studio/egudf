// Auto-update from GitHub Releases (acc-studio/egudf, public).
//
// The packaged app checks shortly after start and every 4 hours, downloads a
// new version in the background and installs it when egUDF closes (per-user
// NSIS install, no admin prompt). The renderer shows a notice with "restart
// now". Dev runs and smoke runs never check.
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const HOURS = 4;

export function setupUpdater({ app, ipcMain, getWindow, enabled }) {
  let last = { state: enabled ? 'idle' : 'off', version: app.getVersion() };
  const send = (st) => { last = { ...last, ...st }; getWindow()?.webContents.send('update:status', last); };
  ipcMain.handle('update:status', () => last);
  ipcMain.handle('update:check', async () => {
    if (!enabled) return { state: 'off', version: app.getVersion() };
    try { await autoUpdater.checkForUpdates(); } catch (e) { send({ state: 'error', error: String(e?.message || e) }); }
    return last;
  });
  ipcMain.handle('update:install', () => { if (last.state === 'downloaded') autoUpdater.quitAndInstall(false, true); });
  if (!enabled) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', next: i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'current' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send({ state: 'downloaded', next: i.version }));
  autoUpdater.on('error', (e) => send({ state: 'error', error: String(e?.message || e) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, HOURS * 3600 * 1000);
}
