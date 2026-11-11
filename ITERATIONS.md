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
