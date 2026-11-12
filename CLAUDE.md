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
- **Lists in UYAP:** checked in Doküman Editörü 5.4.20, which is installed at `C:\Uyap\Uyap Kelime Islemci`. To test there, open a file and screenshot it with PowerShell PrintWindow.
  - **Bullets** sit ~12pt left of LeftIndent and ignore FirstLineIndent, so never write a negative FirstLineIndent on a list paragraph.
  - **Style names** are UYAP's own (from editor_lib.jar): `BULLET_TYPE_{ELLIPSE,RECTANGLE,RECTANGLE_D,DIAMOND,DIAMOND_2,ARROW,TRIANGLE}` and `NUMBER_TYPE_{NUMBER,CHAR_SMALL,CHAR_BIG,ROMAN_SMALL,ROMAN_BIG}_{DOT,TRE,PARANTHESE,D_PARANTHESE}`. There is no dash.
  - **Per level:** the style at level N is `SecListTypeLevelN`; otherwise the type at level 1, and the defaults at deeper levels: a. i. (1) (a) (i) for numbers, ■ □ ◆ ➤ ► for bullets.
  - All of this lives in `src/udf/common.js` (`uyapLevelType`, `uyapListType`).
- **What .udf can hold** (checked in UYAP; `src/udf/uyapify.js` converts Word content to it):
  - Only Swing StyleConstants attributes (no paragraph borders, letter spacing or tab leaders).
  - Tables have one `border` mode: `borderCell` grid / `borderRow` / `borderTable` frame / `borderNone`.
    - Cell-level `border="borderCell"` with colour/width draws a full box; `borderSpec` is not per side.
    - Cell backgrounds and row `height` are ignored.
  - Horizontal merge: a row with fewer cells plus its own `columnSpans`. There are no vertical merges.
  - The format has no page breaks; UYAP drops `<page-break/>`.
  - **Line spacing:** UYAP adds `LineSpacing × font size` to each line (12pt Times: 0.5 → 20pt pitch, 1.0 → 26pt). It is not a multiple of the line height. The editor (`--lsx` in UDF mode) and `src/udf/pdf.js` both use this.
    - egPDF's copy of the engine still multiplies; port the change there.
    - Page counts match UYAP on single-spaced, 1.5-spaced and mixed list/table test documents.
  - UYAP adds space-after and space-before; Word uses the larger.
- **Learning how UYAP writes something:** drive the official editor with `tools/uyap-keys.ps1` (SendKeys; screenshots: `tools/uyap-shot.ps1`) (wait for the full window, not the splash), save, and read its XML. Use only scratch copies.
- `npm test` asserts parse→serialize→parse idempotency over all real samples; keep it green when touching `src/udf/codec.js`.

## Review data, interop, comfort (0.2–0.7, see ITERATIONS.md)

- **Review entry:** comments (`comment` mark + `tab.review.comments`) and tracked changes (`insertion`/`deletion` marks, `src/review/changes.js`) never reach content.xml. The codec drops deletion text; insertions are plain text there.
  - The marked-up doc is stored in the zip entry `egudf/review.json`, bound to content.xml by SHA-256. It is ignored (markers lost, threads kept) if content.xml changed elsewhere.
  - Comment-only edits carry `reviewOnly` meta → `tab.reviewDirty`. Saving then rewrites only the review entry and keeps content.xml + sign.sgn byte-identical (smoke `comment-signed`).
  - Signing strips comments and requires accepting pending changes.
- **Track changes:** an appendTransaction pass. It skips `trackSkip` (accept/reject), `reviewOnly`, `history$` (undo/redo) and `addToHistory:false` transactions.
- **Word:** `src/interop/docx.js` imports and exports .docx (no extra deps). `npm test` round-trips up to 80 real .docx files from Downloads.
- **Other modules:**
  - Recovery snapshots: `userData/recovery/<session>-<tab>.json`, every 30 s.
  - User templates: `userData/templates/*.json`.
  - Theme: `nativeTheme.themeSource` via `theme:set`; the CSS just follows `prefers-color-scheme`.
  - The context menu is drawn by the renderer; main forwards Chromium's params, including spelling.
- **Smoke harness:** `--only=a,b` runs selected steps. results.json is written after every step, so a hang leaves partial results. Screenshots call `webContents.invalidate()` first; otherwise hidden windows return stale frames. In the hidden smoke window, status-bar UI refreshes lag (requestAnimationFrame), so assert on state, not on the status DOM.

## Word documents (0.14)

- **Native .docx tabs:** `tab.format === 'docx'`. Save writes `exportDocx`, and Save As picks the format from the extension. Signing, UYAP and collab need .udf. `importDocx().warnings` lists what export would drop; the user is asked before overwriting the original.
- **Word-only model data:** none of it is written to UDF.
  - Paragraph attrs `lineRule/lineHeight`, `pageBreakBefore`, `keepNext`, `border`, `shading`, `strut`.
  - `fmt` on table, row and cell.
  - textStyle `letterSpacing/smallCaps/allCaps/dstrike`.
  - The `hardBreak` node: `splitBreaks` turns it into one UDF paragraph per line.
  - `tabSet` is `pos:align:leader`, using Java Swing TabStop codes (shared with UDF).
- **Word rendering:** the sheet gets class `word-hf`.
  - Spacing uses `--sa/--sb` as collapsing margins (Word = max(after, next before); verified via COM). UDF keeps padding.
  - `--lhf` is the base font's single-line factor.
  - `strut` sets a paragraph's font when all its runs are smaller or another family (CSS line boxes have a strut, Word doesn't).
  - Tabs come from the `TabStops` plugin (`src/editor/tabs.js`); the header/footer overlay uses `layoutTabsDom`.
- **Header/footer fitting:** `fitHeaderFooter` measures header/footer HTML and sets `geom.top/firstTop/bottom`. Pagination supports a different first-page top (`L.firstTop`).
- **Paste from Word:** `clipboard.readBuffer('Embed Source')` is an OLE compound file whose `Package` stream is the selection as a .docx (`src/interop/cfb.js`, `paste.js`). Only used when the clipboard HTML is Word's. Pasted text ends with a newline iff the last paragraph mark was copied.
- **Office cloud fonts** (Aptos…) live in `%LOCALAPPDATA%\Microsoft\FontCache\4\CloudFonts\<Family>\<id>.ttf`, invisible to Chromium. `lib/officefonts.js` lists them and the renderer registers the ones a document uses as FontFaces.
- **.docx association:** `build/installer.nsh` (UTF-8 BOM) registers egUDF as a capable handler: OpenWithProgids + RegisteredApplications. Don't add .docx to `fileAssociations`: electron-builder's `APP_ASSOCIATE` overwrites the user's .docx default.
- **Testing against Word:** Word 16 is installed and scriptable over COM (PowerShell). Build test documents with Word itself, rather than viewing client files, and compare with `ExportAsFixedFormat` PDFs (PyMuPDF is installed). Smoke `page1..3` (dev-only, via `--only`) show whole pages at 70 %; `page9` dumps computed paragraph styles. Word here is Turkish, so use built-in style constants, not English style names.

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
- **Spelling**: the editor draws its own underlines (`src/editor/spell.js`, decorations). Words are checked in batches by Hunspell compiled to WASM (`hunspell-asm`) in the main process (`lib/spellcheck.js`), using the bundled `assets/hunspell/{tr,en}.{aff,dic}`.
  - `webFrame.isWordMisspelled` always returns false in this Electron, even with dictionaries loaded, so it is useless.
  - Chromium's own spellcheck download is pointed at a dead URL for privacy, so before 0.11 no Hunspell dictionary ever loaded. The `.bdic` files in `assets/dictionaries` are copied to `userData/Dictionaries` for the remaining native fields (comment boxes, the UYAP window), and `WinUseBrowserSpellChecker` is disabled so those fields use them.
  - Use `settle(st)` (src/spelling.js) in tests: dictionary answers arrive asynchronously.
- **Page numbers**: `pageNumber-spec=BSP32_<flags>` is inferred, not documented (see `src/udf/pagenum.js`). 2048 means "with total"; the values egUDF writes match the real files (72, 40, 2120, 2088).
- PowerShell 5.1 `Get-Content/Set-Content` corrupt Turkish UTF-8 — use the file tools.
- **Scripted source edits:**
  - Inside a JS template literal in a patch script, `\b` becomes a backspace byte (0x08) and `\s`/`\d` lose their backslash. Write regex-bearing patches with `String.raw` or the Edit tool. Check with a control-character scan.
  - `String.replace` treats `$'`/`$&` in the replacement as patterns (`'history$'` appended the rest of the file once). Use `split(a).join(b)`, or the Edit tool. Bash heredocs in this environment can also mangle `$'…` and `\t`.
