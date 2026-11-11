# egUDF: iteration log

Each iteration ships as a working app: tests and the smoke suite pass, the
change is committed and pushed, and an installer
(`egUDF Setup <version>.exe`) is copied to Downloads.

---

## 0.1.1: Takip talebi readable (iteration 0)

- **UYAP form data merge:** unmerged UYAP forms (takip talebi and similar
  portal output) showed placeholder names (`alacakliAdiSoyadi`, `eol`,
  `auto`…). The `<data>` block is now merged into the document on open and
  before PDF export.
- **Tables across pages:** long tables continue on the next page row by row
  instead of jumping there whole and leaving page 1 blank.
- **Nested table widths:** nested tables no longer overflow their cells (no
  more cut-off text or stray scrollbars).
- **PDF export:** honours per-row column widths, so the takip talebi prints
  as one clean page.

## 0.2.0: Everyday comfort (iteration 1)

- **Light / dark theme:** Görünüm → Tema (Sistem / Açık / Koyu), plus a
  theme button in the status bar. The choice is remembered and the window
  frame follows it. The page itself stays white, as in Word.
- **Quick access toolbar:** Kaydet, Geri al, Yinele at the top left, always
  visible. Undo/redo grey out when unavailable.
- **New right-click menu:** spelling suggestions and "sözlüğe ekle", cut,
  copy, paste, plain paste, table row/column actions inside tables,
  Paragraf…, Büyük/küçük harf, Tümünü seç.
- **Format painter (Biçim boyacısı):** click once to copy formatting to the
  next selection, double-click to keep it on, Esc to stop. Also
  Ctrl+Shift+C / Ctrl+Shift+V copies and applies formatting.
- **Change case:** Cümle düzeni, küçük, BÜYÜK, Her Kelime, tersine. Handles
  Turkish İ/ı correctly. Shift+F3 cycles through them.
- **Paragraph dialog:** alignment, line spacing, left/right/first-line
  indent, spacing before/after in one place (ribbon or right-click).
- **Word count:** click the status bar for words and characters (with and
  without spaces), paragraphs and pages, for the document and for the
  selection. The status bar shows "seçim / toplam" while text is selected.
- **Keyboard shortcuts:** F1 or the key icon in the status bar opens the
  list. Ctrl+Space clears character formatting.
- **Fixes:** cut/copy/paste ribbon buttons now really work (Chromium blocked
  the old method), and the ribbon keeps one height on every tab.

## 0.3.0: Comments and the Gözden Geçir tab (iteration 2)

- **New "Gözden Geçir" ribbon tab:** Yeni yorum, Önceki/Sonraki, Sil,
  Tümünü sil, review pane, spell-check on/off.
- **Comments:** select text (or put the cursor in a word) and press
  Ctrl+Alt+M, the button, or right-click → Yeni yorum. The text is
  highlighted, and a card opens in the review pane on the right.
  - Enter saves; Shift+Enter adds a new line; Esc cancels an empty comment.
  - Double-click a comment to edit it.
  - Each card has a reply box, Çözüldü (resolved comments turn grey and
    their highlight fades), and delete.
  - The card for the comment under the cursor is highlighted, and clicking
    a card jumps to its text.
  - Author is the name in Avukat bilgilerim, otherwise "Ben".
- **Comments never reach UYAP:** content.xml stays exactly as before.
  Comments are stored in a separate entry inside the .udf zip
  (`egudf/review.json`). If the file is changed outside egUDF, the comments
  are kept but marked "metin bulunamadı".
  - **Signed documents:** adding a comment does not break an existing
    e-signature. content.xml and sign.sgn are written back unchanged, which
    the smoke test checks against a real signed file.
  - **Signing removes comments:** before signing you are warned that the
    signed file is saved without comments, and they are removed. Filed
    documents never carry review data.
- **Spell-check toggle:** Gözden Geçir → Yazım denetimi (remembered).

## 0.4.0: Track changes (iteration 3)

- **Değişiklikleri izle:** Gözden Geçir tab, Ctrl+Shift+E, or the
  "İzleme açık/kapalı" button in the status bar.
  - Typed text is underlined in the author's colour.
  - Deleted text stays visible with red strike-through instead of
    disappearing.
  - Backspace/Delete move the cursor over deleted text as in Word.
  - Deleting your own pending insertion simply removes it.
- **Accept / reject:** Kabul et / Reddet act on the change under the
  cursor (or the selection) and jump to the next one.
  - Their drop-down menus: Tümünü kabul et / Tümünü reddet, and
    "… ve izlemeyi durdur".
  - Önceki / Sonraki step through changes; right-click on a change also
    offers Kabul et / Reddet.
  - Every change is listed in the review pane, with author, time and
    accept/reject buttons.
- **Display:** "Tüm işaretler" shows the markup; "İşaretsiz" shows the
  document as if every change were accepted.
- **Saving:** content.xml (what UYAP and any other UDF reader sees) always
  holds the accepted text. The markup itself, and whether tracking is on,
  are kept in the review entry and come back when you reopen the file in
  egUDF.
- **Signing:** with pending changes you are asked to accept them; the signed
  text is the accepted version.
- **Undo:** undo/redo work normally while tracking.
- **Limitations:** formatting changes (bold, size…) and paragraph
  splits/joins are not tracked; text changes are.
- **Fix:** comment and change times are shown in local time.

## 0.5.0: Ruler and crash recovery (iteration 4)

- **Ruler (Cetvel):** a centimetre ruler above the page that stays visible
  while scrolling and follows the zoom. Margins are shaded and the current
  paragraph's tab stops are shown.
  - Drag the markers like in Word: first-line ▽ (top), hanging △, left
    indent ■ (moves both), right indent △.
  - Drags snap to 0,25 cm; hold Alt for free movement. A dashed guide line
    shows the position while dragging.
  - Double-click the ruler to open the paragraph dialog.
  - Turn it on/off under Görünüm → Cetvel (remembered).
- **Crash recovery:** every 30 seconds, unsaved documents (text, comments,
  tracked changes, page settings) are written to the egUDF profile folder.
  - If egUDF closes unexpectedly, the next start offers them in "Belge
    kurtarma". Pick the ones to reopen, or delete them.
  - Snapshots are removed when you save, close or deliberately discard a
    document, so the prompt only appears after a real crash.
- **Smoke test harness:** screenshots are now forced to repaint, so visual
  checks see the current state.

## 0.6.0: Word (.docx) import and export (iteration 5)

- **Open Word files:** use Aç…, drag & drop, or "Open with" egUDF. The file
  becomes a new UDF document; Kaydet suggests a .udf name next to the
  original. Brought across:
  - Text and font, size, bold/italic/underline/strike, sub/superscript,
    colour, highlight.
  - Paragraph alignment, indents, spacing, line spacing, tab stops.
  - Numbered and bulleted lists (Word formats mapped to UYAP list types).
  - Tables (column widths scaled to fit the page, merged columns, borders)
    and images.
  - Page size, margins and orientation; header and footer, with page
    numbers detected.
  - Comments (author, date, replies) and tracked changes.
  - Style inheritance, Word's "no space between paragraphs of the same
    style", and fields (only the visible result is kept).
- **Save as Word:** Dosya / Görünüm → Dışa aktar → "Word olarak kaydet"
  writes a .docx with the same features. Comments become Word comments
  (replies included), and tracked changes stay tracked changes in Word.
- **Tested** on 80 real Word files from Downloads (read during the test,
  never stored):
  - import → Word export → import keeps the text identical;
  - import → UDF save keeps the text identical.
- **Known differences:**
  - Line breaks inside a paragraph become separate paragraphs (UDF has no
    in-paragraph break).
  - Text boxes, footnotes, EMF/WMF pictures and vertically merged cells are
    not imported.
  - Page counts can differ from Word. One 37-page Word document shows 61
    pages here, and part of the difference is not yet explained.

## 0.7.0: Writing aids, own styles and templates (iteration 6)

- **Otomatik düzeltme while typing** (Gözden Geçir → Otomatik düzeltme;
  every part can be switched off, and Ctrl+Z undoes a correction):
  - **Smart quotes:** "…" → “…” and '…' → ‘…’.
  - **Sentence capitals:** capitalised at the start of a paragraph and after
    . ! ?. This waits for the second letter, so "a)" enumerations stay as
    typed, and abbreviations like "md.", "vb.", "Av.", "No." and numbers
    like "1." don't trigger it.
  - **Dashes and symbols:** -- → –, ... → …, (c) → ©, -> → →.
  - **Editable replacement list**, with legal defaults: hmk → HMK, tmk,
    tbk, ttk, iik → İİK, cmk, tck, yargıtay → Yargıtay, yada → ya da,
    herşey → her şey…
- **Word shortcuts:**
  - Ctrl+1 / Ctrl+2 / Ctrl+5: line spacing 1 / 2 / 1.5.
  - Ctrl+] / Ctrl+[: font size up/down.
  - Ctrl+M / Ctrl+Shift+M: indent / outdent.
  - Ctrl+Shift+N: Normal style; Ctrl+Shift+L: bullets.
- **Stillerim:** format a paragraph, then Giriş → "Stil kaydet". It saves the
  alignment, indents, spacing, bold/italic, size and font as a style in the
  gallery (marked ★). "Stiller…" lists and deletes them. Styles are kept
  across documents.
- **Şablonlarım:** Ekle → "Şablon olarak kaydet" stores the current document
  as a template (text, layout, header/footer). It appears under Dosya → Yeni
  and on the start screen; hover to delete.

## 0.8.0: Formatting changes tracked; better find & replace (iteration 7)

- **Formatting is now tracked** while İzleme is on, like Word:
  - Text formatting (bold, italic, underline, font, size, colour, highlight,
    sub/superscript) gets a dotted underline in the author's colour. The
    review pane says what changed ("Kalın", "Boyut: 14pt", "İtalik değil").
  - Paragraph formatting (alignment, indents, spacing, line spacing, lists,
    tabs) gets a bar in the left margin and a "Paragraf biçimi" card
    ("Ortaya hizalı", "Numaralı liste").
  - Reject puts the old formatting back; accept keeps the new one. Undoing
    the formatting yourself (bold, then bold again) removes the change.
  - Word export/import keeps them as Word formatting revisions
    (w:rPrChange / w:pPrChange), so they survive a trip through Word.
  - As before, the saved UDF holds the "accepted" result; UYAP never sees
    the markup.
- **Find & replace:**
  - New options next to the search box: **Aa** match case, **ab** whole word,
    **.\*** regular expression (Alt+C / Alt+W / Alt+R). They are remembered.
  - Case-insensitive search follows Turkish rules (I↔ı, İ↔i).
  - Regex replacements can reuse groups: find `(\d{4})/(\d+)` and replace
    with `$2/$1` turns 2024/15 into 15/2024. In normal mode "$1" is literal.
  - Search starts at the cursor; Değiştir moves to the next match; an invalid
    regex says so instead of silently finding nothing.
  - Text deleted under track changes is no longer found or replaced.
- **Testing:** new smoke steps `fmttrack` and `find`, unit tests for search;
  smoke screenshots now always show the current state (they could lag one
  step behind).

## 0.9.0: Table tools (iteration 8)

The **Tablo** tab (it appears when the cursor is in a table) gained:
- **Seç:** select the cell, row, column or the whole table. Formatting and
  alignment then apply to every selected cell (this also fixes alignment
  buttons acting only on the first cell of a cell selection).
- **Hücre boyutu:**
  - **Sütunları eşitle** gives all columns the same width.
  - **Sayfaya sığdır** stretches or shrinks the table to the text width,
    keeping the column proportions.
  - **Sütun genişliği…** sets a column to an exact width in cm; the other
    columns give up the difference, so the table width doesn't change.
- **Hizalama:** left/centre/right/justify for the selected cells.
- **Sırala:** sorts the rows by the column the cursor is in, A → Z or Z → A.
  - Uses Turkish alphabetical order (Ç after C, İ after I), and numbers by
    value (30 < 200 < 1500).
  - Dates such as 05.03.2024 sort by date.
  - A bold first row is treated as a header and stays on top; this can be
    switched in the menu.
  - Refuses (with a message) when cells are merged vertically.
- **Metne dönüştür:** turns a table into tab-separated paragraphs.
- **Ekle → Metinden tablo:** turns selected paragraphs into a table, split at
  tabs, or at ";" when there are no tabs.
- The right-click menu inside a table also offers select row/column, equal
  columns and sort.
- **Testing:** smoke step `tabletools` checks every tool: sort orders,
  widths, alignment, table → text → table, and UDF output.

## 0.10.0: Page numbers and header/footer editing (iteration 9)

- **Page number menu:** Ekle/Düzen → Sayfa numarası.
  - **Format:** "1", "1 / 5", "Sayfa 1", "Sayfa 1 / 5".
  - **Position:** bottom right/centre/left, or top right/centre.
  - Also: "Biçimlendir…" and remove.
- **Header/footer dialog** has a page-number section: format, position,
  top/bottom, first number (for a document continuing another one), bold.
- **Double-click** in a page's top or bottom margin opens the header/footer
  dialog at that part, as in Word.
- **Go to page:** Ctrl+G, or click "Sayfa 3 / 12" in the status bar.
- **Editor, PDF and Word all follow these settings.** In Word, page numbers
  become PAGE/NUMPAGES fields in the right place. Importing Word page
  numbers brings their position, "Sayfa" prefix and separator. A
  first-page-only header no longer hides the footer in Word.
- **How UYAP stores this:** `pageNumber-spec="BSP32_<flags>"` is
  undocumented. The UYAP files in Downloads show:
  - 2048 means "with total". Only those files have a separator.
  - The other flags look like position bits.
  - The values egUDF writes are exactly the ones in your UYAP files
    (2120 = 1 / N bottom right, 2088 = 1 / N bottom centre, 72 = 1 bottom
    right, 40 = 1 bottom centre).
  - **Change you may notice:** older egUDF builds showed "1 / N" for every
    document with page numbers. Now a document saved with plain numbers
    shows only "1", which is how its flags read. The top-of-page and
    start-number options use the same reading but don't appear in any of
    your files, so check them once in UYAP before relying on them.
- **Testing:** smoke steps `pagenum` (labels, spec, PDF, Word round trip in
  both positions, go to page) and `hfdialog`, plus unit tests for the flag
  mapping.

## 0.11.0: Real Turkish spell checking (iteration 10)

- **Bug found and fixed: spell checking never worked.** To keep egUDF
  offline, Chromium was blocked from downloading its dictionaries, but none
  were shipped, so no dictionary ever loaded. Whether any red underlines
  appeared depended on Windows having its own Turkish spellchecker.
- **Now:**
  - egUDF ships the Turkish (MIT, Harun Reşit Zafer) and English Hunspell
    dictionaries and checks words with real Hunspell running inside the app.
  - Nothing leaves the computer.
  - It accepts legal vocabulary (müvekkil, ihtiyati, ilamsız, tensip,
    temerrüt, müzekkere, istinaf, and arabuluculuk/talikli, which I added).
- **Turkish-aware suggestions** for typical keyboard errors:
  - mahkme → mahkeme, yanlızca → yalnızca, birsey → bir şey,
    musteri → müşteri.
  - Covers ASCII letters for Turkish ones, swapped/missing/extra letters, and
    a missing space.
- **Fewer false alarms:**
  - ALL-CAPS abbreviations (HMK, İİK, TBMM) are skipped (can be switched
    off).
  - Also skipped: words with digits, numbers like 2024/15, e-mails and web
    addresses, UYAP form fields and deleted (tracked) text.
  - "Ankara'da" is checked as "Ankara".
  - The word being typed isn't underlined until you leave it.
- **F7 / Gözden Geçir → Yazım denetimi:** a Word-style walk-through. Shows
  each error in context with suggestions; Değiştir, Tümünü değiştir, Yoksay,
  Tümünü yoksay, Sözlüğe ekle.
- **Right-click** on an underlined word: suggestions, Tümünü yoksay,
  Sözlüğe ekle.
- **Status bar** shows "Türkçe · 3 yazım hatası". Click it to choose the
  dictionaries (Türkçe / İngilizce), the ALL-CAPS option, or the
  **Kullanıcı sözlüğü** (view, add and remove your own words).
- Comment boxes and the UYAP window also get a working Turkish spellchecker
  (the dictionaries are installed for Chromium too).
- **Testing:** smoke steps `spelling` and `spelling-ui` (detection,
  suggestions, typing behaviour, right-click, F7 change / ignore-all). The
  packaging test made sure the new spell service is in the installer.

## 0.12.0: Working together on a OneDrive file (iteration 11)

**What's possible:** Word's live co-authoring needs Microsoft's servers
(SharePoint/WOPI), which can't host a .udf. So egUDF does it over the
synced file. Everyone runs egUDF on the same .udf in a OneDrive folder;
OneDrive moves the bytes and egUDF merges them. Dropbox, Google Drive and
network folders work the same way.

**How to use it:** Gözden Geçir → **Ortak çalışma** (or accept the prompt
egUDF shows when someone else already has the file open).
- **Auto-save and auto-merge:** your edits are saved about 1.5 s after you
  stop typing. When someone else's version arrives, it is merged into your
  open document, never overwritten:
  - different paragraphs are simply combined;
  - if you both changed the same paragraph at the same moment, yours stays
    and theirs is inserted right after it as their **tracked change**, so
    you choose with Kabul et / Reddet;
  - comments and replies from both sides are kept;
  - page setup and header/footer changes come across too.
- **Who's here:** the status bar shows "Ortak: Ayşe Yılmaz". A coloured
  initials badge sits in the margin beside the paragraph each person is
  working in.
- **Conflict copies:** if OneDrive ever creates a conflict copy
  ("Dilekçe-PCADI.udf"), egUDF offers to merge it in, then moves it to the
  Recycle Bin. It asks first, because a file with a similar name could be
  your own.
- **How it works without a server:** each person writes only their own
  small hidden presence file next to the document
  (~$Dilekçe.egudf-ad.json), so OneDrive never sees two people writing one
  file. Presence disappears about 40 s after someone closes the document.
- **What the other person needs:**
  - egUDF;
  - the shared folder synced to their PC (for a shared OneDrive link: "Add
    shortcut to My files", or open it in the OneDrive app).
  - A browser link alone isn't enough: OneDrive on the web can't open .udf.
- **Limits:**
  - Changes arrive as fast as OneDrive syncs, usually seconds, sometimes
    longer. It is not keystroke-live like Word Online.
  - Signed documents can't be shared this way (editing would void the
    signature).
  - If someone edits the file in the UYAP editor meanwhile, egUDF still
    merges it, paragraph by paragraph.
- **Tested** with a simulated second user writing to the same file:
  - combining edits;
  - my edits reaching the disk;
  - a same-paragraph conflict;
  - a save made outside egUDF (no false conflicts);
  - presence;
  - conflict-copy merge.
  - Not tested: two real PCs on real OneDrive. That needs a second person.

## 0.13.0: Compare documents (iteration 12)

After the requested list, I asked what the most useful Word feature egUDF
still lacked. For a lawyer that is **Compare**: the other side sends back
"their version" of a contract or petition without tracked changes, and
you need a redline.

- **Gözden Geçir → Karşılaştır:**
  - Pick the original and the revised version: any open tab, or a .udf or
    Word (.docx) file. Enter who made the changes ("Av. Karşı Taraf").
  - The result opens in a new tab: the revised text, with every difference
    as a tracked change by that person.
  - Changes are word by word: "her ayın ~~beşinci~~ onuncu günü".
  - Whole paragraphs added or removed are marked as such.
  - Formatting differences (bold, size…) and paragraph differences
    (alignment, indents, lists) show as formatting changes.
  - Tables of the same shape are compared cell by cell.
- **What you can do with the result:**
  - Review it with Kabul et / Reddet, the review pane and next/previous.
  - "Tümünü kabul et" gives exactly the revised document; "Tümünü reddet"
    gives the original.
  - Save it as .udf (the redline stays as review data), or export to Word,
    where it arrives as real Word tracked changes.
- **Fixes found along the way:**
  - Accepting the deletion of a whole paragraph (or rejecting its
    insertion) now removes the paragraph too, instead of leaving an empty
    line. Word does the same.
  - F7 spelling dialog: Değiştir is disabled for the quarter second while
    suggestions load. Before, a fast click could insert the previous word's
    suggestion.
- **Testing:**
  - Unit tests for word-level, paragraph-level and formatting differences.
  - All 23 real UDFs in Downloads: compared with themselves → 0 changes;
    with one paragraph removed → exactly 1 deletion.
  - Smoke step `compare` drives the dialog and checks the accept-all and
    reject-all round trips.
