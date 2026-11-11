# CLAUDE.md

egUDF (formerly "UDF Editör"): Electron editor for UYAP `.udf` documents with PKCS#11 e-signature and an in-app UYAP Avukat Portal window. Sibling of egPDF (`C:\Users\AzizCanCengiz\egpdf`): same stack (Electron 33 + esbuild, vanilla JS), same CSS tokens, same UDF→PDF engine. Personal project of Aziz Can Cengiz. Documents never leave the machine except through the user's own actions in the UYAP window.

## Commands

```
npm start          # node build.mjs (src/renderer.js → dist/renderer.js) + electron .
npm test           # node --test test/*.test.js — codec + CAdES; reads real samples from UDF_SAMPLES or ~/Downloads (never commit those: client data)
npm run smoke      # electron . --smoke=test/.out [file.udf] — renderer drives window.__smoke steps, screenshots + results.json
npm run smoke:packaged  # same steps inside release/win-unpacked/egUDF.exe → test/.pkg (run before shipping an installer)
npm run rebuild    # electron-rebuild pkcs11js (native; needs VS 2022 Build Tools + Python)
npm run dist       # electron-builder → release/
```
To add smoke coverage, add a step to `window.__smoke` in `src/renderer.js`. `--pgdebug` runs a short pagination-only scenario with a `debug` step dumping breaks.

## UDF format (verified against real UYAP files)

- ZIP: `content.xml` (+ `sign.sgn`, + `documentproperties.xml` with uyapdogrulamakodu/sicil after filing).
- `content.xml`: one CDATA with all text; every paragraph's last run includes the trailing `\n`; runs are `<content|field|space|tab|image startOffset length …>`; header first inside `<elements>`, footer last; `<webID>`/`<data>` after `<styles>` (kept verbatim in `meta.tail`). Image runs occupy one `U+00B8` char.
- Lists are paragraph attributes (`Numbered/Bulleted, NumberType, ListId, ListLevel`), not nested structures — the editor models them the same way (`paragraph.attrs.list`) and labels them via decorations (`computeListLabels`).
- Export writes explicit `family`+`size` on every run and drops `resolver`, so output never depends on style resolution. Imported tables carry a grid fingerprint (`_sig`); if unchanged, original `columnCount/columnSpans` are written back verbatim.
- **Unmerged UYAP forms** (e.g. takip talebi from the portal): CDATA holds placeholder field names and the values sit in `<data>`. `src/udf/template-data.js` merges them on open and before PDF export (rules in its header; digits in data tag names are encoded `Tablo40`→`TabloXeXa`; `dataRow` rows repeat per data instance). Signing an unchanged file still signs the original template bytes; editing + saving writes the merged, ordinary document.
- Rows may carry their own `columnSpans` that differ from the table's (`100,5,100` ×3 vs rows `91,109` ×2). Use the row grid when its count matches the cells.
- `npm test` asserts parse→serialize→parse idempotency over all real samples; keep it green when touching `src/udf/codec.js`.

## Signing

- `sign.sgn` = DER CMS SignedData, detached, SHA-256 over raw `content.xml` bytes, one cert, signed attrs contentType/signingTime/messageDigest/signingCertificateV2 (ESSCertIDv2 with issuerSerial, default hash omitted), digest AlgorithmIdentifiers without NULL, sha256WithRSA with NULL. The test compares our OpenSSL dump with a real UYAP signature — keep it identical.
- Signing never re-serializes an unchanged document: `contentBytes()` returns the original bytes when not dirty.
- `sign/pkcs11.js`: driver per call (load → init → work → finalize). AKİS 2.x returns CKR_ARGUMENTS_BAD from C_Initialize when no reader is attached → mapped to `CKR_NO_READER`. PIN goes straight to C_Login, never stored.
- main re-verifies every produced signature before returning it.

## Gotchas (found by testing)

- **Packaging**: `npm start` runs from the source tree, so a file missing from `build.files` only breaks the installed app (0.1.0 shipped without `src/styles.css` → unstyled, unusable window). `test/package.test.js` checks every file referenced by `index.html`/`main.js` is in `build.files`; also run `npm run smoke:packaged`.
- **Rename**: userData moved from `%APPDATA%\UDF Editör` to `%APPDATA%\egUDF`; `main.js` copies the old profile on first launch. Electron pre-creates the userData folder, so the guard checks for `Preferences`, not the folder. `appId` stays `com.azizcancengiz.udfeditor` so the NSIS installer upgrades the old install in place.
- **Pagination** (`src/editor/pagination.js`): measure line boxes in content space (subtract existing spacer heights), convert each line edge first, then take midpoints — midpoints in screen space can fall inside a spacer and make layout oscillate. Line starts come from DOM offsets (binary search over char rects + `posAtDOM`), not `posAtCoords` (viewport-only).
- Tables break across pages per top-level row. A widget can't sit between `<tr>`s, so the row that starts the new page gets `padding-top` on all of its cells, and the first cell is marked `.pg-row-break[data-pg-h]`. Anything that looks for page gaps must use `spacerBoxes()`, not just `.page-spacer`.
- **Quit**: with the Windows spellchecker active, Chromium lingers ~100 s after the last window closes (and would hold the single-instance lock). `window-all-closed` flushes storage/cookies then SIGKILLs itself. The smoke harness also hard-exits (capturePage triggers the same hang).
- egPDF's `src/udf.js` is copied to `src/udf/pdf.js` with an XML-string entry point; it uses CRLF upstream — normalize before patching. Keep the two in sync.
- PowerShell 5.1 `Get-Content/Set-Content` corrupt Turkish UTF-8 — use the file tools.
