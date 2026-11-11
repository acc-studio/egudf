// E-imza and UYAP flows (renderer side). The card work itself happens in the
// main process (sign/pkcs11.js); the PIN goes straight there and is cleared
// from the dialog immediately.
import { icon } from './icons.js';
import { $, $$, h, esc, modal, toast, fmtDate, maskTckn, confirmBox } from './ui.js';

const native = window.native;

// ------------------------------------------------------------------ sign dialog
/**
 * signDialog(app, tab) → Promise<boolean> (true when the document was signed and saved)
 */
export function signDialog(app, tab) {
  return new Promise((resolve) => {
    let drivers = [];
    let tokens = [];
    let choice = null; // { slotIndex, certId }
    let settings = {};
    const body = h(`<div>
      <div class="callout"><span>${icon('shield')}</span><div><b>${esc(tab.title)}</b><br><span class="note">Güvenli elektronik imza · CAdES-BES (SHA-256) · UYAP Doküman Editörü ile aynı biçim. İmzalanan dosya <b>${esc(tab.path ? tab.path.split(/[\\/]/).pop() : 'kaydedilecek konuma')}</b> olarak yazılır.</span></div></div>
      <div class="field"><label>Kart sürücüsü (PKCS#11)</label>
        <div style="display:flex;gap:6px"><select id="sg-driver" style="flex:1;min-width:0"></select><button class="btn" id="sg-browse" title="Başka bir sürücü dosyası seç">Gözat…</button><button class="btn" id="sg-reload" title="Kartı yeniden oku">${icon('card')}Kartı oku</button></div>
      </div>
      <div id="sg-certs" class="certs"></div>
      <div class="field" id="sg-pin-wrap"><label>PIN</label><input type="password" id="sg-pin" autocomplete="off" spellcheck="false" placeholder="Kart PIN'iniz" maxlength="16"></div>
      <div id="sg-msg"></div>
    </div>`);
    const sel = $('#sg-driver', body), certsEl = $('#sg-certs', body), pin = $('#sg-pin', body), msg = $('#sg-msg', body);

    const m = modal({
      title: 'E-İmza ile imzala',
      icon: 'sign',
      width: 640,
      body,
      actions: [
        { label: 'İptal', value: false },
        { label: 'İmzala', kind: 'ok', icon: 'sign', id: 'sg-go', onClick: (close, b) => go(close, b) },
      ],
      onClose: (r) => { pin.value = ''; resolve(r === true); },
    });
    const goBtn = $('#sg-go', m.el);

    function setMsg(kind, html) { msg.innerHTML = html ? `<div class="callout ${kind}">${icon(kind === 'ok' ? 'check' : 'warn')}<div>${html}</div></div>` : ''; }
    function updateGo() { goBtn.disabled = !choice || !pin.value; }
    pin.addEventListener('input', updateGo);

    async function loadDrivers() {
      settings = await native.settings.get();
      drivers = await native.sign.drivers();
      sel.innerHTML = drivers.map((d) => `<option value="${esc(d.path)}">${esc(d.name)} — ${esc(d.path.split(/[\\/]/).pop())}</option>`).join('')
        || '<option value="">Sürücü bulunamadı — Gözat… ile seçin</option>';
      if (settings.driverPath && drivers.some((d) => d.path === settings.driverPath)) sel.value = settings.driverPath;
      if (drivers.length) await readCard();
      else setMsg('warn', 'Bilgisayarda bilinen bir e-imza kart sürücüsü bulunamadı. Sertifika sağlayıcınızın (E-Tuğra, E-Güven, Türktrust, KamuSM) sürücüsünü kurun veya <b>Gözat…</b> ile .dll dosyasını seçin.');
    }

    async function readCard() {
      choice = null; updateGo();
      if (!sel.value) return;
      certsEl.innerHTML = `<div class="note"><span class="spinner"></span> Kart okunuyor…</div>`;
      setMsg();
      const r = await native.sign.list(sel.value);
      if (!r.ok) { certsEl.innerHTML = ''; setMsg('bad', esc(r.error)); return; }
      tokens = r.tokens;
      const items = [];
      for (const t of tokens) for (const c of t.certs) items.push({ t, c });
      if (!items.length) {
        certsEl.innerHTML = '';
        setMsg('warn', tokens.length ? 'Kartta sertifika bulunamadı.' : 'Takılı kart bulunamadı. Kartı/okuyucuyu takıp <b>Kartı oku</b>\'ya basın.');
        return;
      }
      // qualified signing certs first (non-repudiation), unexpired first
      items.sort((a, b) => (b.c.nonRepudiation - a.c.nonRepudiation) || (a.c.expired - b.c.expired));
      certsEl.innerHTML = '';
      for (const { t, c } of items) {
        const el = h(`<div class="cert">${icon('card')}<div style="flex:1;min-width:0">
          <b>${esc(c.subjectCN || c.label)}${c.nonRepudiation ? '<span class="tag">Nitelikli</span>' : ''}${c.expired ? '<span class="tag bad">Süresi dolmuş</span>' : ''}</b>
          <div class="sub">T.C. ${esc(maskTckn(c.subjectSerial))} · ${esc(c.issuerCN || c.issuerO)}<br>Geçerlilik: ${fmtDate(c.notBefore, false)} – ${fmtDate(c.notAfter, false)} · ${esc(t.tokenLabel)}${t.pinFinalTry ? ' · <b style="color:var(--danger)">SON PIN DENEMESİ</b>' : t.pinCountLow ? ' · <b style="color:var(--warn)">PIN deneme hakkı azaldı</b>' : ''}${t.pinLocked ? ' · <b style="color:var(--danger)">PIN BLOKE</b>' : ''}</div></div></div>`);
        el.onclick = () => {
          $$('.cert', certsEl).forEach((x) => x.classList.remove('sel'));
          el.classList.add('sel');
          choice = { slotIndex: t.slotIndex, certId: c.id, cert: c };
          updateGo();
          pin.focus();
        };
        certsEl.append(el);
      }
      const preferred = items.findIndex(({ c }) => c.id === settings.lastCertId && !c.expired);
      $$('.cert', certsEl)[preferred >= 0 ? preferred : 0].click();
    }

    sel.onchange = readCard;
    $('#sg-reload', body).onclick = readCard;
    $('#sg-browse', body).onclick = async () => {
      const d = await native.sign.pickDriver();
      if (!d) return;
      await loadDrivers();
      sel.value = d.path;
      readCard();
    };

    async function go(close, b) {
      if (!choice || !pin.value) return false;
      if (choice.cert.expired && !(await confirmBox({ title: 'Sertifikanın süresi dolmuş', text: 'Bu sertifika ile atılan imza UYAP tarafından kabul edilmeyecektir. Yine de devam edilsin mi?', ok: 'Devam et', kind: 'danger' }))) return false;
      b.disabled = true;
      b.innerHTML = '<span class="spinner"></span><span>İmzalanıyor…</span>';
      setMsg();
      const p = pin.value;
      pin.value = '';
      try {
        const ok = await app.signTab(tab, { driverPath: sel.value, slotIndex: choice.slotIndex, certId: choice.certId, pin: p });
        if (ok.error) throw new Error(ok.error);
        close(true);
        return undefined;
      } catch (e) {
        setMsg('bad', esc(e.message || e));
        b.innerHTML = `${icon('sign')}<span>İmzala</span>`;
        updateGo();
        pin.focus();
        return false;
      }
    }

    updateGo();
    loadDrivers();
  });
}

// ------------------------------------------------------------------ signature info
export function signatureInfo(app, tab) {
  const s = tab.sig;
  if (!s) {
    modal({
      title: 'İmza bilgisi', icon: 'verify', width: 460,
      body: `<div class="callout">${icon('info')}<div>Bu belge imzalı değil. UYAP'a göndermeden önce <b>E-İmza ile imzala</b> ile imzalayın.</div></div>`,
      actions: [{ label: 'Kapat' }, { label: 'İmzala', kind: 'ok', onClick: () => { app.run('sign'); } }],
    });
    return;
  }
  const v = s.info || {};
  const state = s.state === 'valid'
    ? `<div class="callout ok">${icon('check')}<div><b>İmza geçerli.</b> Belge, imzalandığından beri değiştirilmemiş ve imza sertifikadaki anahtarla doğrulandı.</div></div>`
    : s.state === 'stale'
      ? `<div class="callout warn">${icon('warn')}<div><b>Belge imzadan sonra değiştirildi.</b> Kaydettiğinizde eski imza kaldırılır; göndermeden önce yeniden imzalayın.</div></div>`
      : `<div class="callout bad">${icon('warn')}<div><b>İmza doğrulanamadı.</b> ${v.error ? esc(v.error) : (v.digestOk === false ? 'Belge içeriği imzalanan içerikle eşleşmiyor.' : 'İmza değeri sertifika ile doğrulanamadı.')}</div></div>`;
  const c = v.signer || {};
  modal({
    title: 'İmza bilgisi', icon: 'verify', width: 560,
    body: `${state}<div class="kv">
      <div>İmzalayan</div><div><b>${esc(c.subjectCN || '—')}</b></div>
      <div>T.C. Kimlik No</div><div>${esc(maskTckn(c.subjectSerial))}</div>
      <div>Sertifika sağlayıcı</div><div>${esc(c.issuerCN || c.issuerO || '—')}</div>
      <div>Sertifika geçerliliği</div><div>${fmtDate(c.notBefore, false)} – ${fmtDate(c.notAfter, false)}</div>
      <div>İmza zamanı</div><div>${fmtDate(v.signingTime)} <span class="dim small">(imzalayanın bilgisayar saati)</span></div>
      <div>İmza türü</div><div>CAdES-BES, SHA-256, ayrık (sign.sgn)</div>
      <div>Belge özeti</div><div>${v.digestOk ? 'Eşleşiyor' : 'Eşleşmiyor'}</div>
    </div>
    <p class="note" style="margin-top:14px">Not: Sertifika zinciri ve iptal (SİL/OCSP) kontrolü bu uygulamada yapılmaz; UYAP gönderim sırasında kendi kontrolünü yapar.</p>`,
    actions: [{ label: 'Kapat', kind: 'primary' }],
  });
}

// ------------------------------------------------------------------ UYAP
export async function uyapSendFlow(app, tab) {
  // 1) needs a signed, saved, unchanged document
  if (!tab.sig || tab.sig.state !== 'valid' || tab.dirty) {
    const go = await confirmBox({
      title: 'Önce imzalayın',
      text: 'UYAP\'a gönderilecek evrak e-imzalı olmalıdır. Belge şimdi imzalanıp kaydedilsin mi?',
      ok: 'İmzala', kind: 'ok', icon: 'sign',
    });
    if (!go) return;
    const signed = await signDialog(app, tab);
    if (!signed) return;
  }
  await native.uyap.open();
  const body = h(`<div>
    <div class="callout ok">${icon('check')}<div><b>${esc(tab.title)}</b> imzalı ve hazır.<br><span class="note">${esc(tab.path)}</span></div></div>
    <div class="steps">
      <div class="step"><div><b>Portala giriş yapın</b><div class="note">Açılan UYAP penceresinde e-imza veya mobil imza ile giriş yapın. Oturumunuz bu uygulamada hatırlanır.</div></div></div>
      <div class="step"><div><b>Evrak gönderme ekranını açın</b><div class="note">Dosyayı bulun → <i>Evrak Gönder</i> / <i>Dosyaya Evrak Ekle</i> ekranında evrak türünü seçin.</div></div></div>
      <div class="step" id="st-attach"><div><b>Evrakı yükleme alanına ekleyin</b><div class="note">Aşağıdaki düğme imzalı dosyayı portalın dosya seçme alanına koyar (göz atıp seçmenizle aynı işlem).</div>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="btn primary" id="up-attach">${icon('attach')}Yükleme alanına ekle</button><button class="btn" id="up-copy">${icon('copy')}Dosya yolunu kopyala</button><button class="btn" id="up-folder">${icon('folder')}Klasörde göster</button></div>
        <div id="up-msg"></div></div></div>
      <div class="step"><div><b>Portalda gönderimi tamamlayın</b><div class="note">Gönderimi ve harç/ödeme adımlarını portal ekranında siz onaylarsınız. Portal ayrıca kendi imza adımını isteyebilir.</div></div></div>
    </div></div>`);
  const m = modal({ title: 'UYAP\'a gönder', icon: 'upload', width: 600, body, actions: [{ label: 'Portalı göster', icon: 'globe', left: true, onClick: () => { native.uyap.open(); return false; } }, { label: 'Kapat', kind: 'primary' }] });
  const upMsg = $('#up-msg', body);
  $('#up-attach', body).onclick = async () => {
    upMsg.innerHTML = '<div class="note" style="margin-top:6px"><span class="spinner"></span> Portal sayfası taranıyor…</div>';
    const r = await native.uyap.attach(tab.path);
    if (r.ok) {
      $('#st-attach', body).classList.add('done');
      upMsg.innerHTML = `<div class="callout ok" style="margin-top:8px">${icon('check')}<div>Dosya portalın yükleme alanına eklendi. Portal penceresinde kontrol edip gönderin.</div></div>`;
    } else {
      upMsg.innerHTML = `<div class="callout warn" style="margin-top:8px">${icon('warn')}<div>${esc(r.error)}</div></div>`;
    }
  };
  $('#up-copy', body).onclick = () => { native.copyText(tab.path); toast('Dosya yolu kopyalandı', { type: 'ok' }); };
  $('#up-folder', body).onclick = () => native.showInFolder(tab.path);
  return m;
}

export async function driverSettings() {
  const drivers = await native.sign.drivers();
  const s = await native.settings.get();
  const body = h(`<div>
    <p class="note" style="margin-top:0">E-imza kartınıza erişmek için sertifika sağlayıcınızın PKCS#11 sürücüsü kullanılır. Bulunan sürücüler:</p>
    <div class="certs">${drivers.map((d) => `<div class="cert ${d.path === s.driverPath ? 'sel' : ''}">${icon('card')}<div><b>${esc(d.name)}</b><div class="sub">${esc(d.path)}</div></div></div>`).join('') || '<div class="note">Bilinen sürücü bulunamadı.</div>'}</div>
  </div>`);
  modal({
    title: 'Kart sürücüsü', icon: 'card', width: 560, body,
    actions: [
      { label: 'Başka sürücü seç…', left: true, onClick: async () => { const d = await native.sign.pickDriver(); if (d) toast(`Sürücü kaydedildi: ${d.name}`, { type: 'ok' }); } },
      { label: 'Kapat', kind: 'primary' },
    ],
  });
}
