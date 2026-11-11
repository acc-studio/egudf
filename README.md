# UDF Editör

A modern editor for UYAP documents (`.udf`), built so a Turkish lawyer never has to open the UYAP Doküman Editörü again: **open → edit → e-sign → upload to UYAP**, all in one app.

It is the sibling of [egPDF](https://github.com/acc-studio/egpdf): same Electron + esbuild stack, same design tokens, and the same UDF→PDF layout engine, so a document exported or printed here looks exactly like it does in egPDF.

## What it does

| | |
|---|---|
| **Open / edit .udf** | Full-fidelity round-trip of UYAP's `content.xml` (format 1.8): paragraph alignment, indents, spacing, line spacing, tab stops, UYAP numbered/bulleted lists (`ListId`/`NumberType`), tables, inline images, headers/footers, page numbers, font family/size/colour/highlight, template **field runs** (`<field fieldName=…>`) and unknown template payloads (`<webID>`, `<data>`) are preserved. Unchanged files are saved byte-for-byte. |
| **Word-style editing** | Ribbon (Dosya · Giriş · Ekle · Düzen · İmza · UYAP · Görünüm + contextual Tablo), true page view with line-level pagination, styles gallery (Gövde, Mahkeme, Başlık, Alıntı, İmza…), find & replace, OS spellcheck (tr/en), zoom, focus mode, navigation pane (auto outline of AÇIKLAMALAR / SONUÇ VE İSTEM…, `[placeholder]` list, UYAP fields). |
| **Templates** | Dava, cevap, beyan/talep dilekçesi; insertable blocks (vekil, imza bloğu, sonuç ve istem, ekler) filled from *Avukat bilgilerim*. |
| **E-imza** | PKCS#11 smart-card signing (TÜBİTAK AKİS, SafeNet, IDPrime, …). Produces `sign.sgn` exactly like the UYAP editor: detached **CAdES-BES**, SHA-256 over the raw `content.xml`, signed attributes contentType · signingTime · messageDigest · signingCertificateV2. Opening a signed file verifies it; editing it warns that the signature will be dropped. |
| **UYAP** | In-app Avukat Portal window (own persistent session). *İmzala ve gönder* signs, saves, opens the portal and puts the signed file into the portal's upload field with one click. `.udf` files downloaded in the portal open straight in the editor. |
| **egPDF** | *PDF olarak kaydet*, and *Yazdır / egPDF'te aç* hand a PDF rendition to egPDF (or the system PDF viewer). |

Nothing is sent anywhere except by you, inside the UYAP portal window.

## Run

```bash
npm install          # also rebuilds pkcs11js for Electron (needs VS Build Tools + Python on Windows)
npm start            # build renderer + launch
npm test             # codec + CAdES unit tests (uses openssl if on PATH; reads ~/Downloads/*.udf as real samples)
npm run smoke        # drives the real app end to end, screenshots → test/.out/
npm run dist         # installer → release/
```

## Layout

```
main.js            Electron main: files, dialogs, e-imza IPC, UYAP portal window, smoke harness
preload.cjs        window.native bridge
sign/              der.js (DER), x509.js, cades.js (CAdES-BES), verify.js, pkcs11.js (smart cards)
src/udf/           codec.js (content.xml ⇄ editor JSON), zip.js, pdf.js (egPDF layout engine), templates.js
src/editor/        TipTap extensions (UDF paragraph/list/field/image/table), pagination.js
src/               renderer.js (app), ribbon.js, signflow.js, ui.js, icons.js, styles.css
```

## Notes and limits

- **Signature validity**: our signatures are structurally identical to UYAP's (verified with OpenSSL and against 21 real UYAP-signed files) but have not yet been submitted to UYAP from a real card in this build — do a first test filing before relying on it.
- Chain/revocation (KamuSM roots, SİL/OCSP) is not checked locally; UYAP checks on submission.
- The portal flow does not automate the portal's own steps; you log in, choose the file/evrak türü and confirm sending yourself. Some portal screens sign server-side with UYAP's own signing tool.
- UDF has no cell merging; merged cells are written as separate cells.
