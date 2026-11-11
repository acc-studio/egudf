// Shared editing of a .udf in a synced folder (OneDrive, Dropbox, Google
// Drive, a network share). There is no server: every participant runs egUDF
// on the same file, and the sync client moves the bytes.
//
//  - Local edits are saved automatically ~1.5 s after typing stops.
//  - The file is watched; when someone else's version arrives it is merged
//    into the open document (merge3: base = last version both agreed on), so
//    nobody's work is overwritten. Same-paragraph conflicts become tracked
//    insertions by the other author.
//  - Presence: each participant writes a small hidden file next to the
//    document (~$<name>.egudf-<user>.json) with a heartbeat and the paragraph
//    they are in. Only its owner writes it, so the sync client never sees two
//    writers for one file. The others are shown in the status bar and as a
//    coloured bar beside the paragraph each person is editing.
//  - Conflict copies made by the sync client ("Dilekçe-PCADI.udf") are
//    merged in and moved to the recycle bin.
import { merge3, mergeComments, changedRange } from './merge.js';

const HEARTBEAT = 6000;
const STALE = 40000;
const SAVE_DELAY = 1500;

const hash = async (bytes) => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const slug = (s) => String(s || 'kullanici').toLocaleLowerCase('tr').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'kullanici';
const strip = (doc) => JSON.parse(JSON.stringify(doc));

export function createCollab(app, deps) {
  const { save, parse, me, toast, scheduleUI, renderReview } = deps;
  const sessions = new Map(); // tab.id → session

  native.collab.onChanged(({ path }) => {
    for (const s of sessions.values()) if (s.tab.path && s.tab.path.toLowerCase() === String(path).toLowerCase()) s.schedulePull();
  });
  native.collab.onConflictCopy(({ path, copy }) => {
    for (const s of sessions.values()) {
      if (!s.tab.path || s.tab.path.toLowerCase() !== String(path).toLowerCase()) continue;
      // only a guess from the name ("Dilekçe-PCADI.udf"): ask, never merge or delete on our own
      toast(`Eşitleme çakışma kopyası olabilir: ${copy.split(/[\\/]/).pop()}. İçindeki değişiklikler bu belgeyle birleştirilsin mi?`, { type: 'warn', ms: 20000, actions: [{ label: 'Birleştir', onClick: () => s.queue(() => s.absorbCopy(copy)) }] });
    }
  });

  function session(tab) {
    const s = {
      tab,
      base: null, baseMeta: null, baseComments: [],
      lastHash: null,
      peers: [],
      saveTimer: null, pullTimer: null, beat: null,
      chain: Promise.resolve(),
      stats: { pulls: 0, merges: 0, conflicts: 0, saves: 0 },
      queue(fn) { s.chain = s.chain.then(fn).catch((e) => console.error('collab', e)); return s.chain; },
      schedulePull() { clearTimeout(s.pullTimer); s.pullTimer = setTimeout(() => s.queue(s.pull), 250); },
      scheduleSave() { clearTimeout(s.saveTimer); s.saveTimer = setTimeout(() => s.queue(s.push), SAVE_DELAY); },

      theirAuthor() {
        const p = [...s.peers].sort((a, b) => b.at - a.at)[0];
        return p?.user || 'Diğer kullanıcı';
      },

      /** Disk → editor. */
      async pull() {
        if (!sessions.has(tab.id)) return;
        let bytes;
        try { bytes = await native.readFile(tab.path); } catch { return; }
        const h = await hash(bytes);
        if (h === s.lastHash) return; // our own write, or nothing new
        let theirs;
        try { theirs = await parse(bytes); } catch { return; } // half-synced file: wait for the next change
        s.stats.pulls++;
        await s.absorb(theirs, h, bytes);
      },

      async absorb(theirs, h, bytes) {
        const ed = tab.editor;
        const mine = ed.getJSON();
        const r = merge3(s.base, mine, theirs.doc, { theirAuthor: s.theirAuthor(), keyFn: theirs.fromReview ? undefined : deps.canon?.(tab) });
        if (r.conflicts) { s.stats.conflicts += r.conflicts; toast(`${s.theirAuthor()} ile aynı paragraf aynı anda değiştirildi: iki sürüm de belgede, değişiklik olarak işaretli.`, { type: 'warn', ms: 7000 }); }
        if (r.changed) { applyDoc(ed, r.doc); s.stats.merges++; }
        // page setup / header / footer: theirs wins when only they changed it
        const metaKey = (m) => JSON.stringify({ p: m?.pageFormat, h: m?.header, f: m?.footer });
        if (metaKey(theirs.meta) !== metaKey(s.baseMeta) && metaKey(tab.meta) === metaKey(s.baseMeta)) {
          Object.assign(tab.meta, { pageFormat: theirs.meta.pageFormat, header: theirs.meta.header, footer: theirs.meta.footer });
          deps.metaChanged?.(tab);
        }
        tab.review.comments = mergeComments(tab.review.comments, theirs.comments || []);
        s.base = strip(theirs.doc);
        s.baseMeta = strip(theirs.meta || {});
        s.lastHash = h;
        tab.original = { contentXml: theirs.contentXml, bytes };
        renderReview?.();
        // I still have work they don't: send it back
        if (JSON.stringify(ed.getJSON()) !== JSON.stringify(s.base) || r.conflicts) s.scheduleSave();
        else { tab.dirty = false; tab.reviewDirty = false; deps.renderTabs?.(); }
        scheduleUI();
      },

      /** Editor → disk (merging first if the file moved on). */
      async push() {
        if (!sessions.has(tab.id)) return;
        let bytes = null;
        try { bytes = await native.readFile(tab.path); } catch {}
        if (bytes) {
          const h = await hash(bytes);
          if (h !== s.lastHash) {
            try { await s.absorb(await parse(bytes), h, bytes); } catch {}
          }
        }
        if (!tab.dirty && !tab.reviewDirty) return;
        const written = await save(tab, { quiet: true });
        if (!written) return;
        s.stats.saves++;
        s.lastHash = await hash(written);
        s.base = strip(tab.editor.getJSON());
        s.baseMeta = strip(tab.meta);
        scheduleUI();
      },

      async absorbCopy(copy) {
        try {
          const bytes = await native.readFile(copy);
          const theirs = await parse(bytes);
          const r = merge3(s.base, tab.editor.getJSON(), theirs.doc, { theirAuthor: s.theirAuthor(), keyFn: theirs.fromReview ? undefined : deps.canon?.(tab) });
          if (r.changed) applyDoc(tab.editor, r.doc);
          tab.review.comments = mergeComments(tab.review.comments, theirs.comments || []);
          const trashed = await native.collab.trash(copy);
          toast(`Çakışma kopyası birleştirildi${trashed ? ' ve geri dönüşüm kutusuna taşındı' : ''}: ${copy.split(/[\\/]/).pop()}`, { type: 'ok', ms: 6000 });
          s.scheduleSave();
        } catch (e) { console.error(e); }
      },

      async heartbeat() {
        if (!sessions.has(tab.id)) return;
        const st = tab.editor.state;
        const idx = st.doc.childCount ? st.doc.resolve(Math.min(st.selection.from, st.doc.content.size)).index(0) : 0;
        await native.collab.writePresence(tab.path, slug(me()), { user: me(), at: Date.now(), block: idx, id: app.instanceId });
        const list = await native.collab.listPresence(tab.path);
        const now = Date.now();
        const before = s.peers.map((p) => p.user).join();
        s.peers = list.filter((p) => p.id !== app.instanceId && now - p.at < STALE);
        if (s.peers.map((p) => p.user).join() !== before && s.peers.length > before.split(',').filter(Boolean).length) {
          const n = s.peers[s.peers.length - 1];
          if (n) toast(`${n.user} de bu belgede çalışıyor.`, { ms: 3500 });
        }
        tab.editor.view.dispatch(tab.editor.state.tr.setMeta('collabPeers', s.peers).setMeta('addToHistory', false));
        scheduleUI();
      },
    };
    return s;
  }

  return {
    sessions,
    active: (tab) => sessions.has(tab?.id),
    get: (tab) => sessions.get(tab?.id),
    async start(tab, { silent = false } = {}) {
      if (!tab?.path) { toast('Ortak çalışma için belgeyi önce eşitlenen bir klasöre kaydedin.', { type: 'warn' }); return false; }
      if (tab.sig?.state === 'valid') { toast('İmzalı belgede ortak çalışma açılamaz: düzenleme imzayı geçersiz kılar.', { type: 'warn' }); return false; }
      if (sessions.has(tab.id)) return true;
      // while shared, every save carries the editor's own document JSON (review entry), so all sides compare like with like
      tab.review.shared = true;
      tab.reviewDirty = true;
      await save(tab, { quiet: true });
      const s = session(tab);
      const bytes = await native.readFile(tab.path);
      s.lastHash = await hash(bytes);
      const disk = await parse(bytes);
      s.base = strip(disk.doc);
      s.baseMeta = strip(disk.meta || tab.meta);
      sessions.set(tab.id, s);
      // the editor may already hold more than the disk (e.g. unsaved review marks)
      const r = merge3(s.base, tab.editor.getJSON(), disk.doc, { keyFn: disk.fromReview ? undefined : deps.canon?.(tab) });
      if (r.changed) applyDoc(tab.editor, r.doc);
      await native.collab.watch(tab.path);
      s.beat = setInterval(() => s.heartbeat(), HEARTBEAT);
      await s.heartbeat();
      if (!silent) toast('Ortak çalışma açık: değişiklikler otomatik kaydedilir ve diğerlerinin değişiklikleri buraya gelir.', { type: 'ok', ms: 5000 });
      scheduleUI();
      return true;
    },
    async stop(tab) {
      const s = sessions.get(tab?.id);
      if (!s) return;
      clearInterval(s.beat);
      clearTimeout(s.saveTimer);
      clearTimeout(s.pullTimer);
      await s.chain;
      if (tab.dirty) await s.push();
      sessions.delete(tab.id);
      delete tab.review.shared;
      await native.collab.unwatch(tab.path);
      await native.collab.removePresence(tab.path, slug(me()));
      tab.editor.view.dispatch(tab.editor.state.tr.setMeta('collabPeers', []).setMeta('addToHistory', false));
      scheduleUI();
    },
    /** Call on every local document change. */
    edited(tab, tr) {
      const s = sessions.get(tab.id);
      if (!s || tr?.getMeta('collabRemote')) return;
      s.scheduleSave();
    },
    /** Someone else's egUDF is on this file right now? (to offer shared editing on open) */
    async othersOn(path) {
      const now = Date.now();
      return (await native.collab.listPresence(path)).filter((p) => p.id !== app.instanceId && now - p.at < STALE);
    },
    peers: (tab) => sessions.get(tab?.id)?.peers || [],
    /** Window closing: drop our presence files (others would see us for ~40 s otherwise). */
    leaveAll() { for (const s of sessions.values()) native.collab.removePresence(s.tab.path, slug(me())); },
    /** After a normal (Ctrl+S) save: the file on disk is ours, not news. */
    async noteWritten(tab, bytes) {
      const s = sessions.get(tab?.id);
      if (!s) return;
      s.lastHash = await hash(bytes);
      s.base = strip(tab.editor.getJSON());
      s.baseMeta = strip(tab.meta);
    },
  };
}

/** Replaces only the top-level blocks that differ, outside undo history and track changes. */
export function applyDoc(ed, json) {
  const cur = ed.getJSON();
  const r = changedRange(cur, json);
  if (r.same) return;
  const { state } = ed;
  let from = 0;
  for (let i = 0; i < r.from; i++) from += state.doc.child(i).nodeSize;
  let to = from;
  for (let i = r.from; i < r.toA; i++) to += state.doc.child(i).nodeSize;
  const nodes = (json.content || []).slice(r.from, r.toB).map((b) => state.schema.nodeFromJSON(b));
  const tr = state.tr.replaceWith(from, to, nodes).setMeta('addToHistory', false).setMeta('collabRemote', true);
  ed.view.dispatch(tr);
}
