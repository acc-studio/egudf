// Shows where other people are working: a coloured bar with their initials
// beside the paragraph each one is in (from their presence heartbeat).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const peersKey = new PluginKey('collabPeers');
const hue = (n) => [...(n || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 200);
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toLocaleUpperCase('tr')).join('');

function build(doc, peers) {
  const d = [];
  const used = new Map();
  for (const p of peers || []) {
    const i = Math.min(Math.max(0, p.block | 0), doc.childCount - 1);
    if (i < 0) continue;
    let pos = 0;
    for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    const n = doc.child(i);
    const stack = (used.get(i) || 0);
    used.set(i, stack + 1);
    const style = `--peer:hsl(${hue(p.user)} 65% 45%);--peer-off:${stack * 26}px`;
    d.push(Decoration.node(pos, pos + n.nodeSize, { class: 'peer-here', style }));
    // an absolutely placed flag at the paragraph start sits in the left margin without moving text
    d.push(Decoration.widget(n.isTextblock ? pos + 1 : pos, () => { const el = document.createElement('span'); el.className = 'peer-flag'; el.textContent = initials(p.user); el.title = `${p.user} burada çalışıyor`; el.setAttribute('style', style); el.contentEditable = 'false'; return el; }, { side: -1, ignoreSelection: true, key: `peer-${p.user}-${i}` }));
  }
  return DecorationSet.create(doc, d);
}

export const CollabPeers = Extension.create({
  name: 'collabPeers',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: peersKey,
      state: {
        init: () => ({ peers: [], deco: DecorationSet.empty }),
        apply(tr, v, _o, state) {
          const p = tr.getMeta('collabPeers');
          if (p) return { peers: p, deco: build(state.doc, p) };
          if (tr.docChanged) return { peers: v.peers, deco: v.peers.length ? build(state.doc, v.peers) : DecorationSet.empty };
          return v;
        },
      },
      props: { decorations(state) { return peersKey.getState(state).deco; } },
    })];
  },
});
