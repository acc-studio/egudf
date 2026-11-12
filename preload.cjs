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
  defaultApps: () => ipcRenderer.invoke('app:defaultApps'),
  printPdf: (opts) => ipcRenderer.invoke('print:pdf', opts),
  officeFonts: () => ipcRenderer.invoke('fonts:office'),
  officeFontBytes: (file) => ipcRenderer.invoke('fonts:officeBytes', file),
  copyText: (t) => ipcRenderer.invoke('clipboard:writeText', t),
  readText: () => ipcRenderer.invoke('clipboard:readText'),
  readOffice: () => ipcRenderer.invoke('clipboard:office'),
  edit: (role, arg) => ipcRenderer.invoke('edit:do', role, arg),
  setTheme: (t) => ipcRenderer.invoke('theme:set', t),
  // Hunspell (main process); the editor draws its own underlines
  collab: {
    watch: (p) => ipcRenderer.invoke('collab:watch', p),
    unwatch: (p) => ipcRenderer.invoke('collab:unwatch', p),
    writePresence: (doc, user, data) => ipcRenderer.invoke('collab:presence:write', doc, user, data),
    listPresence: (doc) => ipcRenderer.invoke('collab:presence:list', doc),
    removePresence: (doc, user) => ipcRenderer.invoke('collab:presence:remove', doc, user),
    trash: (p) => ipcRenderer.invoke('collab:trash', p),
    synced: (p) => ipcRenderer.invoke('collab:synced', p),
    onChanged: on('collab:changed'),
    onConflictCopy: on('collab:conflict-copy'),
  },
  spell: {
    check: (words) => ipcRenderer.invoke('spell:check', words),
    suggest: (w) => ipcRenderer.invoke('spell:suggest', w),
    add: (w) => ipcRenderer.invoke('spell:add', w),
    remove: (w) => ipcRenderer.invoke('spell:remove', w),
    words: () => ipcRenderer.invoke('spell:words'),
    langs: () => ipcRenderer.invoke('spell:langs'),
    setLangs: (l) => ipcRenderer.invoke('spell:setLangs', l),
  },
  onContextMenu: on('context-menu'),
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    write: (id, json) => ipcRenderer.invoke('templates:write', id, json),
    remove: (id) => ipcRenderer.invoke('templates:delete', id),
  },
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
