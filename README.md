# TakeOff – PDF measurement + BQ

## Start
Double-click **run.bat**. The browser opens at http://localhost:8000.
- The first time, it installs the Python packages and asks you to create a password.
- Colleagues on the office network can open `http://<your-PC-name>:8000`. Windows Firewall may ask you to allow Python the first time.
- Live data is kept in `%LOCALAPPDATA%\TakeOff`, not OneDrive, so syncing can't corrupt it.
- Use **File → Save project file (.takeoff)** to keep a backup or share a project.

## Daily workflow
1. **☰ Projects**: create or open a project. **+ Add PDF** loads drawings.
2. **📐 Scale**: click both ends of a known dimension and type the real length. Or pick a preset such as 1:100 (only for a drawing at its true paper size).
3. **BQ tab**:
   - Sheets (Bill 1, Bill 2 …) are tabs above the grid. Click **＋** to add one, double-click to rename, right-click to delete.
   - Click **📋 Import**. In Excel, copy the rows, click the first **Item** cell in the grid and press **Ctrl+V**. Columns are Item / Description / Unit / Qty / Rate. If your Excel columns are in a different order, paste one column at a time. You can also use **Load Excel file…**.
   - Rows **without a unit are headings**. Levels are guessed automatically (e.g. L1 Drainage works → L2 Precast U drain → L3 600×600 U drain → L4 items). Fix them with **Tab / Shift+Tab** in the Description cell.
   - Use **⤒ Merge into row above** when Excel splits one description over several rows.
   - **▦** edits the whole sheet in the same grid.
4. **Click a BQ item** to make it active.
   - Measure with Length (L), Area (A), Rect (R) or Count (C). The qty fills in automatically (**teal = measured**).
   - Type in the Qty box to override it (**orange italic = manual**). Clear the box to go back to the measured qty.
   - Click the **📍 number** on a row to highlight its markups. A list opens, newest first. Click one to jump to it on the drawing.
5. **Select a markup** (V) to edit it in the **Markups** tab:
   - **Multiplier**, e.g. wall height, so length × 3.0 = m².
   - **Deduct**, for openings.
   - BQ item, category and colour.
6. **Categories**: create groups and sub-groups. Click one to make it active, so new markups go into it. 👁 shows or hides it.
7. **Legend**: tick *Legend* in the top bar. Drag the box to move it.
8. **Comment** (T), **Highlight** (K), **Sign** (S). Draw or upload a signature in the Signatures tab first.
   - Drag a comment to move it. Double-click it to edit.
   - The **💬** tab on the left lists all comments by page. Click one to go to it, ✎ to edit.
   - **◧ / ◨** (or the **[ / ]** keys) hide and show the side panels.
9. **Bookmarks** (left panel): save the current view. The PDF's own bookmarks are listed there too.

## New drawing revision
In the Drawings list, click **⟳** on the drawing and pick the new PDF.
- Markups stay on top. The previous revision shows in **red** (*Compare rev*).
- If the new drawing was plotted shifted or at a different size, click **⤧ Align**. Click point A on the red (old) drawing, then the same point on the new one. Do the same for point B. Then choose:
  - **Move the drawing** (recommended): your markups and scale stay untouched.
  - **Move markups**: the markups move onto the new drawing instead.
- **🕘 Revisions**:
  - **👁 View** shows an older layout under your markups. Close it from the orange banner.
  - **Make current** switches revisions for good.
  - **Reset align** undoes a drawing alignment.

## Output
In the File menu:
- **Export BQ to Excel**: a Summary sheet, one sheet per Bill (indented by level, with measured/manual shown), plus Measurements and By Category sheets.
- **Export marked-up PDF**.
- **Save page as PNG**.
- **Print page**.

## Shortcuts
| Key | Action |
|---|---|
| V | select |
| H / Space | pan |
| L | length |
| A | area |
| R | rectangle |
| C | count |
| G | angle |
| T | comment |
| K | highlight |
| S | signature |
| Enter / double-click | finish |
| Esc | cancel |
| Backspace | remove last point |
| Shift | straight lines |
| Del | delete markup |
| Ctrl+Z / Ctrl+Y | undo / redo |
| Mouse wheel | zoom |
| F | fit |
| PgUp / PgDn | change page |
