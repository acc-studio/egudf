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
