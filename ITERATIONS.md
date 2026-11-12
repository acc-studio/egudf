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

## 0.14.0: Word documents as Word (iteration 13)

- **Header/footer no longer overlap the text:** a header taller than the
  space above the top margin pushes the body down (and a tall footer pushes
  the bottom up), on every page, as in Word. With "different first page",
  page 1 starts at its own height. Word headers keep their own colour and
  size (UDF headers stay grey, as UYAP draws them).
- **.docx opens as a Word document and saves as one:**
  - Ctrl+S writes the .docx back; the tab shows a blue **W**. Farklı kaydet
    offers .udf or .docx; signing or sending to UYAP asks for a .udf name.
  - Comments are saved with their **reply threads and "resolved" state**
    (Word's commentsExtended); tracked insertions, deletions and formatting
    changes as Word revisions. Checked by opening the result in Word.
  - What egUDF can't keep yet (footnotes, text boxes, section breaks,
    floating shapes, equations, charts…) is listed when the file opens. You
    are asked before overwriting the original: save a copy, or overwrite.
- **egUDF is registered for .docx:** the installer adds egUDF to "Open with"
  and to Windows Settings → Default apps, without taking .docx away from
  Word. Dosya → Bilgi → ".docx için varsayılan uygulama…" opens that page.
- **Paste from Word keeps everything:** Word puts the copied selection on the
  clipboard as a complete .docx ("Embed Source"). egUDF pastes that instead of
  the HTML, so Ctrl+A / Ctrl+C in Word and Ctrl+V here gives the same result as
  opening the file: fonts, sizes, colours, spacing, lists (numbering
  continues correctly), tables, images, comments and tracked changes. A few
  words pasted mid-sentence join that sentence.
- **Word fidelity** (measured against Word's own PDF of a test document):
  - Tab stops: right / center / decimal stops with dot, hyphen and line
    leaders ("Bedel ........ 1.500.000 TL"), default stops, hanging-indent
    stops. Also in headers.
  - Line breaks (Shift+Enter) stay inside the paragraph; page breaks
    (Ctrl+Enter in Word) start a new page.
  - Paragraph spacing collapses as in Word (the larger of "after" and the
    next "before"). Exact / at-least line spacing. Word's single line height
    per font (Calibri is taller than Times).
  - Lines are sized by their own text, not the document font (small-print
    tables, 9 pt headers, small empty spacer lines).
  - Paragraph borders (lines under headings and letterheads) and shading.
  - Tables: merged cells across rows, cell shading, vertical alignment, row
    heights, per-cell borders, cell margins, the table style's paragraph
    spacing ("Table Grid" has none).
  - Small caps, all caps, letter spacing, double strikethrough.
  - Theme fonts, and Office's downloaded fonts (Aptos…), which other apps
    can't see, are loaded from Office's font cache.
  - All of it is written back on save; a Word document round-trips without
    loss of these properties.
- **Fix:** a line ending within half a pixel of the page end could leave the
  next line in the bottom margin with no page break (all documents).
- **Testing:**
  - Smoke steps `docx-save`, `docx-header`, `wordpaste`. `wordpaste` uses the
    real Word clipboard when Word data is on it, else a generated package.
  - 80 real .docx files round-trip (docx → docx → udf); the full smoke suite
    passes in the packaged exe.

## 0.14.1: .udf files that look right in UYAP Doküman Editörü

A Word document saved as .udf looked fine in egUDF, but in the official
editor the bullets sat on top of the first letters. Everything here was
checked by opening test files in the official editor (5.4.20, installed on this
PC) and comparing screenshots.

- **Bullets no longer overlap the text:** UYAP draws a bullet ~12 pt left of
  the paragraph's left indent and ignores a negative first-line indent. Word's
  hanging lists (left 36, first line −18) therefore put the bullet on the
  first word. egUDF now writes list paragraphs without the hanging part. UYAP
  then shows Word's layout: label in the margin, every line of text aligned.
- **Correct bullet and number styles in UYAP:**
  - egUDF wrote some list style names UYAP doesn't know. They are now taken
    from the editor itself (its program files).
  - Fixed names: "1)" (`…PARANTHESE`), "a." / "A." (`…CHAR_…`).
  - New styles: "(1)", "(a)", □, ◆, ➤.
  - UYAP has no dash bullet: Word's "–" lists become ●.
  - At levels 2 and deeper UYAP ignored the chosen bullet and drew its own
    (■ □ ◆ ➤ ►; a. i. (1)…). egUDF now spells out each level's style
    (`SecListTypeLevelN`), so a Word level-2 "•" stays "•".
- **egUDF shows .udf lists as UYAP does:** labels hang left of the text,
  numbers are right-aligned, each level uses UYAP's default style when a file
  doesn't name one, and labels take the size of the item's text. Before,
  real UYAP files with sub-levels showed "1." where UYAP shows "a.".
- **Word → .udf:** "Farklı kaydet → .udf", signing a Word document and pasting
  Word content into a .udf adjust lists right away, so egUDF shows what UYAP
  will show.
- **Word export:** each list is one multi-level Word list with the right style
  per level (sub-items restart correctly).
- **Known UYAP quirk (not fixable from the file):** when a numbered item's first
  line moves to the next page, UYAP leaves the number alone at the bottom of
  the previous page.
- **Testing:**
  - A unit test pins the rules above.
  - Real UYAP files still re-save identically.
  - Older egUDF files with hanging lists are repaired on the first re-save.

## 0.15.0: Word → .udf as UYAP shows it (iteration 14)

Goal: a Word document saved as .udf looks right in UYAP Doküman Editörü, and
egUDF shows what UYAP will show. Everything below was found and checked by
opening test files in the official editor. I also drove it with keystrokes, so
UYAP itself could write test files.

- **What the .udf format can and can't hold:**
  - UYAP's attributes are Java Swing's: alignment, indents, line spacing,
    spacing, tab stops, bold/italic/underline/strike, sub/superscript, font,
    size, colours.
  - Tables have one border mode: grid, rows, frame or none.
  - UYAP has no paragraph borders, cell shading, row heights, vertical
    merges, per-side cell borders, letter spacing, tab leaders or page breaks.
    It drops a `<page-break/>` when it opens the file.
- **Converting a Word document (Farklı kaydet → .udf, signing, pasting Word into a .udf):**
  - Paragraph spacing: Word uses the larger of "after" and the next
    "before"; UYAP adds them. egUDF converts, so converted documents no
    longer spread out in UYAP.
  - Exact / at-least line spacing becomes UYAP's line spacing.
  - Caps and small caps become uppercase text (small caps at 80 % size).
    Double strikethrough becomes strikethrough.
  - Paragraph shading becomes a text highlight.
  - Tables get the nearest UYAP border mode from Word's borders (full grid /
    lines between rows / outer frame / none).
  - Fonts only Office has (Aptos, Grandview…) become installed ones: UYAP is
    a Java app and can't see them.
  - The open tab is converted too: what you see in egUDF is what UYAP shows.
- **Tables in .udf:**
  - Merged cells across columns are written the way UYAP writes them (a row
    with fewer cells and its own column widths), not as extra empty cells.
  - Reading a real UYAP file now restores those merges.
  - Cells merged down several rows become a top cell plus empty cells below,
    so UYAP's columns stay aligned (before, the following cells shifted left).
  - egUDF draws UYAP's frame-only and rows-only table borders.
- **Testing:**
  - New unit tests for every conversion rule and for the table layout.
  - New smoke step `docx-to-udf`.
  - Real UYAP files still re-save identically.

## 0.16.0: Word's page-break rules, links, symbols (iteration 15)

These come first among the Word features still missing: counted across the
343 .docx files in Downloads (features only, no content).

- **Word's pagination rules** (Word documents; .udf keeps UYAP's own layout,
  which has none of them):
  - "Keep with next" (90 of the 343 documents): a heading never sits alone
    at the bottom of a page.
  - "Keep lines together".
  - Widow/orphan control, on by default as in Word: the first or last line
    of a paragraph is never left alone on a page.
  - egUDF's saved Word files now turn widow control on in their defaults, as
    Word's Normal style does.
- **Hyperlinks** (35 documents):
  - Links stay links. Ctrl+click opens them in the browser; a plain click
    places the cursor, as in Word.
  - Pasted or typed web addresses become links.
  - Saved back to .docx as real Word hyperlinks (checked in Word: address
    intact). In .udf they are plain text, which is all UYAP has.
- **Symbol characters** (Wingdings checkboxes ☐ ☒, ticks ✓, arrows…) were
  dropped on import. They are now kept, with their font. Checked in Word and in
  UYAP: both show them.
- **Testing:**
  - New smoke step `docx-keep`: 60 headings across 11 pages. None is
    separated from its paragraph and no line is left alone. The same document
    under .udf rules does split, which proves the rules are what holds it
    together.

## 0.17.0: Footnotes (iteration 16)

- **Footnotes in Word documents, as in Word:**
  - The reference number sits in the text and numbers itself in document
    order.
  - The footnote text appears at the bottom of the page that holds the
    reference, under a short separator line. Pagination reserves that room,
    so the body text stops above the notes and never runs into them.
  - Ekle → **Dipnot ekle** (Ctrl+Alt+F, Word's shortcut) inserts one.
    Double-click a footnote number to edit or delete its text.
  - Read from and written to Word's own footnotes (`footnotes.xml`, with
    Word's separators and styles). Checked in Word: same notes, formatting
    kept.
- **In .udf:** UYAP has no footnotes. Each becomes a superscript number in the
  text, and the notes follow at the end of the document under "Dipnotlar".
  This applies on Save As .udf and is also enforced when saving, so no
  footnote text is ever lost in a .udf.
- **Page break** (Ekle → Sayfa sonu, Ctrl+Enter) in Word documents. For a
  .udf, egUDF explains that the format can't hold one.
- **Testing:**
  - New smoke step `footnotes`: 10 notes over 3 pages. Each note is on the
    page of its reference, between the last text line and the bottom margin.
    Inserting one through the dialog works, and all notes survive a Word
    round trip.
  - A unit test covers the .udf fallback.

## 0.18.0: Pasting from anywhere keeps lists and formatting (iteration 17)

Pasting from desktop Word was already exact (0.14). Word Online, Outlook,
Google Docs, web pages and e-mail don't carry the embedded .docx, so they went
through the browser's generic HTML paste and lost list structure, spacing and
highlights.

- **Word HTML** (Word Online, Outlook, Word when its .docx is missing):
  - Lists stay lists, with the right style and level, read from the label
    Word prints: "1.", "a)", "iii.", "(2)", bullets (•, ■, ○, ➤, ✓, –).
  - Indents come with them.
  - Word's class styles are applied: paragraph spacing, line spacing
    ("107 %"), the paragraph font, tab stops with dot leaders.
- **Google Docs, web pages:** bulleted and numbered lists, nested ones as
  sub-levels, with their numbering style. Google Docs' invisible "bold"
  wrapper no longer makes everything bold.
- **Everywhere:**
  - Text highlights (background colours) are kept.
  - Pasted lists get their own numbering, independent of the document's lists.
  - Pasting into an empty paragraph keeps the pasted paragraph's own
    formatting, as in Word.
- **Fix:** a Word table cell spanning several columns now keeps one width per
  column, so its widths don't shift when pasted.
- **Testing:** new smoke step `htmlpaste` covers Word-style HTML (with class
  CSS, list paragraphs, tabs and highlight) and Google Docs-style nested
  lists.

## 0.19.0: Word styles survive a save (iteration 18)

- **Headings stay headings:** egUDF used to save a Word document's Heading 1,
  Heading 2… as plain formatted text, so Word lost its navigation pane, table
  of contents and outline after a save. Paragraph styles are now kept and
  written back with their original definitions.
  - Checked in Word on a Turkish-template document: Başlık 1 and Başlık 2
    keep their outline levels; Liste Paragraf, bold, sizes and alignment are
    identical.
  - The page looks exactly as before: everything egUDF shows is still
    written explicitly. Where a style would add something the text doesn't
    have, the text says so ("not bold" inside a bold heading style, left
    aligned in a centered style).
  - References to parts egUDF doesn't write (style-linked numbering) are
    dropped, so Word never finds a broken link.
- **egUDF's navigation pane** (Gezinti → Başlıklar) uses the real heading
  levels in Word documents, as Word's navigation pane does, instead of
  guessing from bold or uppercase text.
- **Testing:**
  - A new unit test covers a localized heading based on a localized default
    style, with numbering, a centered style, and a non-bold run inside a bold
    style.
  - The 80 real .docx files still round-trip.

## 0.20.0: Nothing silently lost from Word files (iteration 19)

- **Text boxes:** their text used to vanish on import. It is now kept as
  ordinary paragraphs right after the paragraph the box was anchored to. Only
  the box's floating position is lost, and egUDF says so when the file opens.
- **Word 2010+ shapes and pictures** wrapped in Word's compatibility container
  (`mc:AlternateContent`) are read: the modern version only, never twice.
- **Older pictures** (VML, from Word 2003-era files) are kept, at their size.
- **Bookmarks and internal links:**
  - Bookmarks (in 129 of the 343 documents) are kept and saved back, so
    links like "see article 3" still work in Word after a save.
  - In egUDF, Ctrl+click on such a link jumps to its bookmark.
- **Theme and document properties** (author, title, dates, company) are saved
  back unchanged. The kept heading styles use the theme's fonts, so Word
  shows them exactly as before.
- **Testing:**
  - Checked in Word on a Word-made document with a text box, a floating
    picture, a bookmark and an internal link: same bookmark and link target,
    same theme, same heading level. The properties and theme files are
    byte-identical.
  - New smoke step `bookmarks` covers Ctrl+click navigation.

## 0.21.0: Floating pictures (iteration 20)

- **Floating pictures** (logos, stamps, signatures placed beside or behind
  text; in 25 of the 343 documents) used to become plain inline pictures, and
  their position was lost on save.
  - **On screen:**
    - Pictures with square or tight wrapping float left or right, with the
      text around them.
    - "Top and bottom" pictures sit on their own line at their offset.
    - "In front of text" and "behind text" pictures are placed over their
      paragraph at Word's offsets.
  - **Saving to .docx:** the picture's position and wrapping are written
    back exactly as Word stored them, at their current size. Checked in
    Word: same position, size and wrapping.
  - **In .udf:** UYAP only has inline pictures, so floating ones become
    inline when a Word document is saved as .udf.

## 0.22.0: Word's Paragraph and Font dialogs (iteration 21)

egUDF could show and keep most Word formatting, but there was no way to set
it.

- **Paragraph** (Giriş → Paragraf → Paragraf ayarları), in four sections as in
  Word:
  - Girintiler ve aralıklar: alignment; left/right indents; special first
    line or hanging; space before/after; line spacing single / 1.5 / double /
    multiple / at least / exactly.
  - Satır ve sayfa sonları: widow/orphan control, keep with next, keep lines
    together, page break before.
  - Sekmeler: tab stops with position, alignment (left, center, right,
    decimal) and leader (dots, dashes, line); the default tab interval.
  - Kenarlık ve gölge: paragraph borders (any side, line style, width,
    colour) and shading.
- **Font** (Ctrl+D, or the new button in Giriş → Yazı Tipi):
  - font, size and colour;
  - bold, italic, underline, strikethrough and double strikethrough;
  - superscript and subscript; small caps and all caps;
  - character spacing (wider or tighter);
  - a live preview.
- **In a .udf**, options UYAP can't show (exact line spacing, page breaks,
  borders, leaders, small caps…) are disabled with a note saying so, so nothing
  silently disappears on save.
- **Testing:** new smoke step `worddialogs` sets values in both dialogs, as a
  user would, and checks the document. In a .udf it checks that the Word-only
  options are disabled.

## 0.23.0: Table properties (iteration 22)

- **Tablo → Tablo özellikleri**, as Word's Table Properties:
  - **Tablo:** alignment (left / center / right), indent from the left, and
    border presets (all borders, outside only, horizontal lines and outside,
    inside horizontal only, none) with line width and colour.
  - **Satır:** row height ("at least" or "exactly") and "repeat as header row
    on each page".
  - **Hücre:** shading colour and vertical alignment (top / center / bottom)
    for the selected cells.
  - Table alignment and indent now show on screen too (before, they were
    only kept for Word).
- **In a .udf** the dialog offers UYAP's four table border modes (all lines /
  row lines and frame / frame only / none). That is all UYAP can store; the
  editor draws each mode as UYAP does.
- **Testing:** new smoke step `tableprops` covers Word settings, their Word
  round trip, and the UYAP border mode written to content.xml.

## 0.24.0: Word documents print as they look (iteration 23)

- **PDF and printing of Word documents** used to go through the UDF→PDF
  engine, so the PDF lost what a .udf can't hold: page-bottom footnotes,
  borders, shading, small caps, floating pictures, Word's spacing. A Word
  document's PDF (Dosya → PDF olarak kaydet, Yazdır) is now exactly what egUDF
  shows, page for page on A4 (landscape too). A .udf keeps the UDF→PDF engine,
  whose output matches UYAP's.
- **Pagination fixes found along the way (all documents):**
  - A page-gap spacer kept its old height when the layout changed but the
    page breaks didn't (after changing margins or the header height). Later
    pages could then drift.
  - The last paragraph's "space after" made the document a few pixels taller
    than its pages.
- **Testing:** new smoke step `wordpdf`: a 2-page Word document with
  footnotes gives a 2-page A4 PDF, and the editor's layout is restored
  afterwards.

## 0.25.0: Long tables across pages (iteration 24)

- **Repeated header rows (Word):** rows marked "repeat as header row" (in
  Word, or in Tablo özellikleri → Satır) appear again at the top of every page
  the table continues on, as in Word. They also appear in the PDF.
- **Cleaner page breaks inside tables (all documents):** a table split across
  pages used to show empty bordered cell stubs in the bottom margin of one page
  and the top margin of the next. The page now ends at the last row's border,
  and the next page starts with the table.
- **Not done for .udf:** I couldn't confirm in the official editor whether UYAP
  repeats its own header rows (`headerRow`), so .udf tables are drawn as
  before.
- **Testing:** new smoke step `headerrows`: a 70-row table over 2 pages has
  exactly one repeated header per continuation page, placed above that page's
  first row, and the header isn't duplicated in the document.

## 0.26.0: Table of contents (iteration 25)

- **Ekle → İçindekiler:** a table of contents built from the document's
  headings.
  - Entries have dot leaders and right-aligned page numbers, indented by
    level. The numbers are recalculated once the contents itself has moved
    the text.
  - Headings are Word's heading styles where the document has them;
    otherwise egUDF recognises headings as petitions write them (bold capitals,
    "I. TARAFLAR", "A) …", centered titles), as in the navigation pane.
  - Each entry links to its heading (Ctrl+click).
  - **Güncelle** refreshes it after edits.
- **In Word:** the contents is a real Word table-of-contents field, and
  egUDF gives the headings Word's outline levels. Checked in Word: it sees the
  contents and its own "Update table" rebuilds it with the same entries.
- **In a .udf:** UYAP has no links or dot leaders, so entries show the heading
  and a right-aligned page number. Page numbers follow egUDF's page layout,
  which can differ slightly from UYAP's own page breaks.
- **Testing:** new smoke step `toc` covers 5 headings over 3 pages: each page
  number matches where its heading lands, every link reaches its heading, and
  the saved .docx contains one TOC field.
