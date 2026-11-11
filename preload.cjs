// window.native — the only bridge between the renderer and the OS.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (cb) => {
  const h = (_e, ...a) => cb(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('native', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  imageDialog: () => ipcRenderer.invoke('dialog:image'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (p, bytes) => ipcRenderer.invoke('file:write', p, bytes),
  exists: (p) => ipcRenderer.invoke('file:exists', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  bundledFont: (name) => ipcRenderer.invoke('font:bundled', name),
  info: () => ipcRenderer.invoke('app:info'),
  copyText: (t) => ipcRenderer.invoke('clipboard:writeText', t),
  readText: () => ipcRenderer.invoke('clipboard:readText'),
  edit: (role, arg) => ipcRenderer.invoke('edit:do', role, arg),
  setTheme: (t) => ipcRenderer.invoke('theme:set', t),
  onContextMenu: on('context-menu'),
  recovery: {
    write: (key, json) => ipcRenderer.invoke('recovery:write', key, json),
    remove: (key) => ipcRenderer.invoke('recovery:delete', key),
    list: () => ipcRenderer.invoke('recovery:list'),
  },
  egpdf: {
    available: () => ipcRenderer.invoke('egpdf:available'),
    open: (bytes, name) => ipcRenderer.invoke('egpdf:open', bytes, name),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  sign: {
    drivers: () => ipcRenderer.invoke('sign:drivers'),
    pickDriver: () => ipcRenderer.invoke('sign:pickDriver'),
    list: (driverPath) => ipcRenderer.invoke('sign:list', driverPath),
    sign: (req) => ipcRenderer.invoke('sign:sign', req),
    verify: (req) => ipcRenderer.invoke('sign:verify', req),
  },
  uyap: {
    open: () => ipcRenderer.invoke('uyap:open'),
    isOpen: () => ipcRenderer.invoke('uyap:isOpen'),
    attach: (p) => ipcRenderer.invoke('uyap:attach', p),
    onState: on('uyap:state'),
  },
  onOpenPaths: on('open-paths'),
  onBeforeClose: on('app:before-close'),
  onToast: on('toast'),
  closeOk: () => ipcRenderer.send('app:close-ok'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return null; } },
});
