// BQ: sheets (Bill 1, Bill 2…), multi-level descriptions, Excel-like import grid,
// qty = measured or manual override, and per-item markup list.
import { S, hooks, dirty, bqTotals, bqById, isHeading, bqName, markColor } from './state.js';
import { $, $$, esc, uid, modal, toast, ask, confirmBox, pickColor } from './ui.js';
import { fmt, unitKind } from './geometry.js';
import { snapshot } from './tools.js';
import { qtyText, TYPE_NAME } from './overlay.js';
import { focusMark } from './viewer.js';

const D = () => S.project.data;
const MAX_LEVEL = 6;
const plain = n => (Math.round(n * 1000) / 1000).toString();
const sheetItems = (id = S.activeSheet) => D().bq.filter(b => b.sheet === id);

// Older projects: one sheet, headings level 1, items level 2.
export function ensureSheets(data) {
  data.sheets = data.sheets || [];
  if (!data.sheets.length) data.sheets.push({ id: uid(), name: 'Bill 1' });
  for (const b of data.bq) {
    if (!b.sheet || !data.sheets.some(s => s.id === b.sheet)) b.sheet = data.sheets[0].id;
    if (!b.level) b.level = b.hdr ? 1 : 2;
    delete b.hdr;
  }
  if (!data.sheets.some(s => s.id === S.activeSheet)) S.activeSheet = data.sheets[0].id;
}

const itemMarks = id => D().marks.filter(m => m.bq === id).sort((a, b) => (b.created || 0) - (a.created || 0));

function markListRow(b) {
  const list = itemMarks(b.id);
  const when = t => t ? new Date(t).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  return `<tr class="mklist"><td colspan="8">${list.length ? list.map(m => {
    const d = D().drawings.find(x => x.id === m.dwg);
    return `<div class="mkrow ${m.id === S.selId ? 'on' : ''}" data-mark="${m.id}" title="Click to show on drawing">
      <span class="sw" style="background:${markColor(m)}"></span><span class="t">${when(m.created)}</span>
      <span>${TYPE_NAME[m.type]}</span><span class="t">${esc(d?.name || '?')} · p${m.page}</span>
      ${m.label ? `<span>${esc(m.label)}</span>` : ''}<span class="q">${esc(qtyText(m))}</span></div>`;
  }).join('') : '<div class="muted small">No markups yet – select this item and measure on the drawing.</div>'}</td></tr>`;
}

function qtyTitle(b, tot, n) {
  return tot.isManual
    ? `Manual qty (measured: ${fmt(tot.measured)}). Clear the box to use the measured qty.`
    : `Measured from ${n} markup${n === 1 ? '' : 's'}. Type a number to override manually.`;
}

export function renderBQ() {
  const t = $('#bqTable'), tabs = $('#bqSheets');
  if (!S.project) { t.innerHTML = ''; tabs.innerHTML = ''; return; }
  ensureSheets(D());
  tabs.innerHTML = D().sheets.map(s => `<button class="sheet ${s.id === S.activeSheet ? 'on' : ''}" data-sheet="${s.id}"
    title="Double-click to rename · right-click to delete">${esc(s.name)}</button>`).join('')
    + `<button class="sheet add" data-sheet-add title="Add sheet">＋</button>`;
  const filter = $('#bqSearch').value.trim().toLowerCase();
  const rows = sheetItems().map(b => {
    const lvl = b.level || 1, pad = 4 + (lvl - 1) * 14;
    if (filter && !`${b.ref} ${b.desc} ${b.unit}`.toLowerCase().includes(filter)) return '';
    const on = b.id === S.activeBq ? 'on' : '';
    const desc = `<textarea data-f="desc" rows="1" style="padding-left:${pad}px" title="Level ${lvl} · Tab / Shift+Tab to change level">${esc(b.desc)}</textarea>`;
    if (isHeading(b)) return `<tr class="hdr l${Math.min(lvl, 4)} ${on}" data-id="${b.id}">
      <td><span class="lvl">L${lvl}</span></td><td style="width:44px"><input type="text" data-f="ref" value="${esc(b.ref)}"></td>
      <td>${desc}</td><td style="width:42px"><input type="text" data-f="unit" value="" placeholder="–" title="Type a unit to turn this heading into a measurable item"></td><td colspan="4"></td></tr>`;
    const tot = bqTotals(b), n = D().marks.filter(m => m.bq === b.id).length;
    return `<tr class="${on}" data-id="${b.id}">
      <td><input type="color" data-f="color" value="${b.color || '#e6194b'}" title="Markup colour"></td>
      <td style="width:44px"><input type="text" data-f="ref" value="${esc(b.ref)}"></td>
      <td>${desc}</td>
      <td style="width:42px"><input type="text" data-f="unit" value="${esc(b.unit)}" title="${unitKind(b.unit) ? 'Measures ' + unitKind(b.unit) : 'Unknown unit – uses each markup\'s own quantity'}"></td>
      <td style="width:76px"><input type="text" inputmode="decimal" data-f="qty" class="num qty ${tot.isManual ? 'manual' : 'measured'}" value="${plain(tot.total)}" title="${esc(qtyTitle(b, tot, n))}"></td>
      <td style="width:62px"><input type="number" step="any" class="num" data-f="rate" value="${b.rate ?? ''}"></td>
      <td class="num" data-c="amount">${fmt(tot.amount)}</td>
      <td><button class="mkbtn ${n ? 'has' : ''} ${S.openBq === b.id ? 'on' : ''}" data-mk title="Show markups of this item">${n}</button></td></tr>`
      + (S.openBq === b.id ? markListRow(b) : '');
  }).join('');
  t.innerHTML = `<thead><tr><th></th><th>Item</th><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th title="Markups">📍</th></tr></thead><tbody>${rows ||
    `<tr><td colspan="8" class="muted" style="padding:16px;text-align:center">This sheet is empty.<br>Click <b>📋 Import</b> to paste your BQ from Excel.</td></tr>`}</tbody>`;
  $$('#bqTable textarea').forEach(autoHeight);
  renderTotals();
}

function autoHeight(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

function renderTotals() {
  let sheet = 0, all = 0;
  for (const b of D().bq) {
    if (isHeading(b)) continue;
    const a = bqTotals(b).amount;
    all += a;
    if (b.sheet === S.activeSheet) sheet += a;
  }
  $('#bqSheetTotal').textContent = fmt(sheet);
  $('#bqGrand').textContent = fmt(all);
}

// Fast path while measuring: update numbers without rebuilding inputs.
export function refreshBQNumbers() {
  if (!S.project) return;
  for (const b of sheetItems()) {
    if (isHeading(b)) continue;
    const tr = $(`#bqTable tr[data-id="${b.id}"]`);
    if (!tr) continue;
    const tot = bqTotals(b), n = D().marks.filter(m => m.bq === b.id).length;
    const q = tr.querySelector('[data-f=qty]');
    if (document.activeElement !== q) {
      q.value = plain(tot.total);
      q.className = `num qty ${tot.isManual ? 'manual' : 'measured'}`;
      q.title = qtyTitle(b, tot, n);
    }
    tr.querySelector('[data-c=amount]').textContent = fmt(tot.amount);
    const mk = tr.querySelector('[data-mk]');
    mk.textContent = n; mk.classList.toggle('has', !!n);
    if (S.openBq === b.id) {
      const next = tr.nextElementSibling;
      if (next?.classList.contains('mklist')) next.outerHTML = markListRow(b);
    }
  }
  renderTotals();
}

export function setActiveBq(id) {
  S.activeBq = id;
  const b = bqById(id);
  if (b && b.sheet !== S.activeSheet) { S.activeSheet = b.sheet; renderBQ(); }
  $$('#bqTable tr[data-id]').forEach(tr => tr.classList.toggle('on', tr.dataset.id === id));
  hooks.refresh('active');
}

function changeLevel(b, delta) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, (b.level || 1) + delta));
  if (lvl === b.level) return;
  snapshot();
  b.level = lvl;
  dirty('bq');
}

function moveRow(b, dir) {
  const list = D().bq, i = list.indexOf(b);
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].sheet !== b.sheet) j += dir;
  if (j < 0 || j >= list.length) return;
  snapshot();
  [list[i], list[j]] = [list[j], list[i]];
  dirty('bq');
}

// ---- level guessing --------------------------------------------------------------------
// Heading after heading → one level deeper; heading after an item → sibling of that item's
// parent heading; ALL-CAPS heading → level 1; item → one below the heading above it.
export function guessLevels(rows, onlyMissing = false) {
  let prev = null;
  for (const r of rows) {
    if (!r.desc && !r.ref) continue;
    const head = !String(r.unit || '').trim();
    let lvl;
    if (head) {
      if (!prev) lvl = 1;
      else if (/[A-Z]/.test(r.desc) && r.desc === r.desc.toUpperCase() && r.desc.length > 3) lvl = 1;
      else if (prev.head) lvl = Math.min(MAX_LEVEL - 1, prev.level + 1);
      else lvl = Math.max(1, prev.level - 1);
    } else {
      lvl = !prev ? 1 : prev.head ? Math.min(MAX_LEVEL, prev.level + 1) : prev.level;
    }
    if (!onlyMissing || !r.level) r.level = lvl;
    prev = { head, level: r.level };
  }
}

// ---- Excel-like grid editor (import and edit) ----------------------------------------------
const COLS = ['level', 'ref', 'desc', 'unit', 'qty', 'rate'];
const HEAD_RE = { ref: /^(item|ref|no\.?|bil|code)$/i, desc: /desc|particular/i, unit: /^(unit|uom)$/i, qty: /^(qty|quantity)$/i, rate: /rate|price/i };
const num = v => { const n = parseFloat(String(v ?? '').replace(/[, RM$]/g, '')); return Number.isFinite(n) ? n : ''; };
const blankRows = n => Array.from({ length: n }, () => ({ level: '', ref: '', desc: '', unit: '', qty: '', rate: '' }));

// Excel puts quotes around cells with line breaks; handle those when splitting TSV.
export function parseTSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Map an Excel sheet (array of arrays) onto grid rows by guessing the header row.
function mapSheet(aoa) {
  let header = -1, map = {};
  for (let r = 0; r < Math.min(15, aoa.length) && header < 0; r++) {
    const m = {};
    aoa[r].forEach((v, c) => { for (const [k, re] of Object.entries(HEAD_RE)) if (m[k] == null && re.test(String(v).trim())) m[k] = c; });
    if (Object.keys(m).length >= 2) { header = r; map = m; }
  }
  if (header < 0) map = { ref: 0, desc: 1, unit: 2, qty: 3, rate: 4 };
  return aoa.slice(header + 1).map(r => ({
    level: '', ref: String(r[map.ref] ?? '').trim(), desc: String(r[map.desc] ?? '').trim(), unit: String(r[map.unit] ?? '').trim(),
    qty: map.qty == null ? '' : num(r[map.qty]), rate: map.rate == null ? '' : num(r[map.rate]),
  })).filter(r => r.ref || r.desc);
}

/** Opens the grid. mode 'import' (new rows into a chosen sheet) or 'edit' (the active sheet's rows). */
async function gridEditor(mode) {
  let rows;
  if (mode === 'edit') {
    rows = sheetItems().map(b => ({ id: b.id, level: b.level || 1, ref: b.ref, desc: b.desc, unit: b.unit, qty: b.manual ?? '', rate: b.rate ?? '' }));
    rows.push(...blankRows(10));
  } else rows = blankRows(40);
  let cur = { r: 0, c: 1 }, xlsxBook = null;
  const sheetName = D().sheets.find(s => s.id === S.activeSheet)?.name;

  const html = `<h3>${mode === 'edit' ? `Edit sheet – ${esc(sheetName)}` : 'Import BQ from Excel'}</h3>
    <div class="muted small">${mode === 'edit' ? '' : 'In Excel select the rows and press Ctrl+C. Click the first <b>Item</b> cell below and press Ctrl+V. If your columns are in a different order, paste them one column at a time.'}
      Rows <b>without a unit</b> are headings. Set the description <b>level</b> with Tab / Shift+Tab in the Description cell (or type it in Lvl).</div>
    <div class="xbar">
      <button class="btn small" id="gXlsx">📂 Load Excel file…</button><select id="gXSheet" hidden></select>
      <span class="vsep"></span>
      <button class="btn small" id="gAuto" title="Guess levels from headings/items">✨ Auto levels</button>
      <button class="btn small icon" id="gOut" title="Level up (Shift+Tab)">⇤</button><button class="btn small icon" id="gIn" title="Level down (Tab)">⇥</button>
      <button class="btn small" id="gMerge" title="Join this row's description onto the row above (for descriptions spread over several Excel rows)">⤒ Merge into row above</button>
      <button class="btn small" id="gInsert">＋ Insert row</button>
      <button class="btn small" id="gDel">🗑 Delete row</button>
      <button class="btn small" id="gClear">Clear all</button>
    </div>
    <div class="xgrid-wrap"><table class="xgrid" id="gTable"></table></div>
    <div class="xbar">
      ${mode === 'edit' ? '' : `<label>Into sheet</label><select id="gSheet">${D().sheets.map(s => `<option value="${s.id}" ${s.id === S.activeSheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__new">＋ New sheet…</option></select>
      <input type="text" id="gNewName" placeholder="New sheet name, e.g. Bill 2" hidden style="width:200px">
      <select id="gMode"><option value="append">Add to end of sheet</option><option value="replace">Replace the sheet</option></select>`}
      <span class="grow"></span><span class="muted small" id="gCount"></span>
      <button class="btn" data-close>Cancel</button><button class="btn primary" id="gOk">${mode === 'edit' ? 'Save sheet' : 'Import'}</button>
    </div>`;

  return modal(html, (card, close) => {
    const table = $('#gTable', card);
    const draw = () => {
      table.innerHTML = `<thead><tr><th></th><th style="width:44px">Lvl</th><th style="width:70px">Item</th><th>Description</th><th style="width:70px">Unit</th><th style="width:90px">Qty</th><th style="width:90px">Rate</th></tr></thead><tbody>` +
        rows.map((r, i) => {
          const head = !String(r.unit).trim() && (r.desc || r.ref);
          return `<tr class="${head ? 'h' : ''} ${i === cur.r ? 'cur' : ''}" data-r="${i}"><td class="rn">${i + 1}</td>` + COLS.map((c, ci) =>
            `<td><input data-c="${c}" data-ci="${ci}" value="${esc(r[c])}" class="${c === 'qty' || c === 'rate' ? 'num' : ''}"
              ${c === 'desc' ? `style="padding-left:${5 + Math.max(0, (+r.level || 1) - 1) * 16}px"` : ''}></td>`).join('') + '</tr>';
        }).join('') + '</tbody>';
      const n = rows.filter(r => r.desc || r.ref).length;
      $('#gCount', card).textContent = `${n} rows · ${rows.filter(r => (r.desc || r.ref) && String(r.unit).trim()).length} items`;
    };
    const focus = () => table.querySelector(`tr[data-r="${cur.r}"] input[data-ci="${cur.c}"]`)?.focus();
    const redraw = () => { draw(); focus(); };
    draw();

    table.addEventListener('focusin', e => {
      const tr = e.target.closest('tr[data-r]');
      if (!tr) return;
      const r = +tr.dataset.r;
      if (r !== cur.r) { table.querySelector('tr.cur')?.classList.remove('cur'); tr.classList.add('cur'); }
      cur = { r, c: +e.target.dataset.ci };
    });
    table.addEventListener('input', e => {
      const c = e.target.dataset.c, r = rows[cur.r];
      r[c] = c === 'level' ? (parseInt(e.target.value) || '') : e.target.value;
      if (c === 'unit' || c === 'level') { e.target.closest('tr').classList.toggle('h', !String(r.unit).trim()); }
      if (c === 'level') e.target.closest('tr').querySelector('[data-c=desc]').style.paddingLeft = `${5 + Math.max(0, (+r.level || 1) - 1) * 16}px`;
    });
    const level = d => { const r = rows[cur.r]; r.level = Math.max(1, Math.min(MAX_LEVEL, (+r.level || 1) + d)); redraw(); };
    table.addEventListener('keydown', e => {
      if (e.key === 'Tab' && COLS[cur.c] === 'desc') { e.preventDefault(); level(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (cur.r < rows.length - 1) { cur.r++; focus(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (cur.r > 0) { cur.r--; focus(); } }
    });
    table.addEventListener('paste', e => {
      const text = e.clipboardData.getData('text/plain');
      if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // single value: normal paste
      e.preventDefault();
      let data = parseTSV(text.replace(/\r?\n$/, ''));
      // drop a header row copied together with the data
      if (data.length > 1 && data[0].some(v => /^(item|description|unit|qty|quantity|rate)$/i.test(String(v).trim()))) data = data.slice(1);
      while (rows.length < cur.r + data.length + 5) rows.push(...blankRows(10));
      data.forEach((vals, i) => {
        const r = rows[cur.r + i];
        vals.forEach((v, j) => {
          const c = COLS[cur.c + j];
          if (!c) return;
          v = String(v).trim();
          r[c] = c === 'level' ? (parseInt(v) || '') : c === 'qty' || c === 'rate' ? num(v) : v;
        });
      });
      guessLevels(rows, true);
      redraw();
      toast(`Pasted ${data.length} rows – check the levels (Tab / Shift+Tab)`);
    });

    $('#gAuto', card).onclick = () => { rows.forEach(r => { r.level = ''; }); guessLevels(rows); redraw(); };
    $('#gIn', card).onclick = () => level(1);
    $('#gOut', card).onclick = () => level(-1);
    $('#gMerge', card).onclick = () => {
      if (cur.r < 1) return;
      const a = rows[cur.r - 1], b = rows[cur.r];
      a.desc = [a.desc, b.desc].filter(Boolean).join(' ');
      for (const k of ['unit', 'qty', 'rate']) if (!String(a[k]).trim() && String(b[k]).trim()) a[k] = b[k];
      if (b.id && !a.id) a.id = b.id;
      rows.splice(cur.r, 1); cur.r--;
      redraw();
    };
    $('#gInsert', card).onclick = () => { rows.splice(cur.r, 0, ...blankRows(1)); redraw(); };
    $('#gDel', card).onclick = () => { rows.splice(cur.r, 1); if (!rows.length) rows.push(...blankRows(1)); cur.r = Math.min(cur.r, rows.length - 1); redraw(); };
    $('#gClear', card).onclick = () => { rows = blankRows(40); cur = { r: 0, c: 1 }; redraw(); };

    // Load .xlsx straight into the grid
    const xin = $('#fileXlsx'), xs = $('#gXSheet', card);
    const loadSheet = name => {
      rows = mapSheet(XLSX.utils.sheet_to_json(xlsxBook.Sheets[name], { header: 1, raw: true, defval: '' }));
      guessLevels(rows);
      rows.push(...blankRows(10));
      const nn = $('#gNewName', card);
      if (nn && $('#gSheet', card).value === '__new') nn.value = name;
      cur = { r: 0, c: 1 }; redraw();
    };
    $('#gXlsx', card).onclick = () => xin.click();
    xin.onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      xlsxBook = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      xs.innerHTML = xlsxBook.SheetNames.map(n => `<option>${esc(n)}</option>`).join('');
      xs.hidden = xlsxBook.SheetNames.length < 2;
      loadSheet(xlsxBook.SheetNames[0]);
    };
    xs.onchange = () => loadSheet(xs.value);

    const sel = $('#gSheet', card);
    if (sel) sel.onchange = () => { $('#gNewName', card).hidden = sel.value !== '__new'; if (sel.value === '__new') $('#gNewName', card).focus(); };

    $('#gOk', card).onclick = () => {
      const data = rows.filter(r => String(r.desc).trim() || String(r.ref).trim());
      if (mode === 'import' && sel.value === '__new' && !$('#gNewName', card).value.trim()) return toast('Type a name for the new sheet');
      close({ rows: data, sheet: sel?.value, newName: $('#gNewName', card)?.value.trim(), mode: mode === 'edit' ? 'edit' : $('#gMode', card).value });
    };
    setTimeout(focus);
  }, 'wide').then(res => res && applyGrid(res));
}

function applyGrid({ rows, sheet, newName, mode }) {
  snapshot();
  if (sheet === '__new') {
    const s = { id: uid(), name: newName };
    D().sheets.push(s);
    sheet = s.id;
  }
  sheet = sheet || S.activeSheet;
  const old = sheetItems(sheet), byId = new Map(old.map(b => [b.id, b]));
  let colorIdx = D().bq.length;
  const make = r => {
    const prev = r.id && byId.get(r.id);
    return {
      id: prev ? prev.id : uid(), sheet, level: +r.level || 1, ref: String(r.ref).trim(), desc: String(r.desc).trim(),
      unit: String(r.unit).trim(), rate: r.rate === '' ? '' : num(r.rate), manual: r.qty === '' || r.qty == null ? '' : num(r.qty),
      color: prev?.color || pickColor(colorIdx++),
    };
  };
  const fresh = rows.map(make);
  if (mode === 'append') {
    // insert after the last row of the sheet so sheets stay contiguous
    const last = D().bq.map(b => b.sheet).lastIndexOf(sheet);
    D().bq.splice(last >= 0 ? last + 1 : D().bq.length, 0, ...fresh);
  } else {
    const keep = new Set(fresh.map(b => b.id));
    const lost = old.filter(b => !keep.has(b.id)).map(b => b.id);
    D().marks.forEach(m => { if (lost.includes(m.bq)) m.bq = null; });
    const first = D().bq.findIndex(b => b.sheet === sheet);
    D().bq = D().bq.filter(b => b.sheet !== sheet);
    D().bq.splice(first >= 0 ? first : D().bq.length, 0, ...fresh);
  }
  S.activeSheet = sheet;
  toast(`${mode === 'edit' ? 'Saved' : 'Imported'} ${fresh.length} rows`);
  dirty('all');
}

// ---- sheets ------------------------------------------------------------------------------
async function sheetTabs(e, kind) {
  const el = e.target.closest('[data-sheet],[data-sheet-add]');
  if (!el || !S.project) return;
  if (el.hasAttribute('data-sheet-add')) {
    if (kind !== 'click') return;
    const name = await ask('New BQ sheet', 'Sheet name', `Bill ${D().sheets.length + 1}`);
    if (!name) return;
    snapshot();
    const s = { id: uid(), name };
    D().sheets.push(s);
    S.activeSheet = s.id;
    return dirty('all');
  }
  const s = D().sheets.find(x => x.id === el.dataset.sheet);
  if (kind === 'click') { S.activeSheet = s.id; return renderBQ(); }
  if (kind === 'dbl') {
    const name = await ask('Rename sheet', 'Sheet name', s.name);
    if (name) { snapshot(); s.name = name; dirty('bq'); }
    return;
  }
  if (kind === 'ctx') {
    e.preventDefault();
    if (D().sheets.length < 2) return toast('A project needs at least one sheet');
    const items = sheetItems(s.id);
    const n = D().marks.filter(m => items.some(b => b.id === m.bq)).length;
    if (!await confirmBox('Delete sheet', `Delete sheet "${s.name}" with ${items.length} rows?${n ? ` ${n} markups will be unlinked (kept).` : ''} (Ctrl+Z to undo)`, 'Delete')) return;
    snapshot();
    const ids = new Set(items.map(b => b.id));
    D().marks.forEach(m => { if (ids.has(m.bq)) m.bq = null; });
    D().bq = D().bq.filter(b => b.sheet !== s.id);
    D().sheets = D().sheets.filter(x => x !== s);
    S.activeSheet = D().sheets[0].id;
    dirty('all');
  }
}

export function initBQ() {
  const t = $('#bqTable');
  t.addEventListener('click', e => {
    const mr = e.target.closest('[data-mark]');
    if (mr) { const m = D().marks.find(x => x.id === mr.dataset.mark); if (m) focusMark(m); return; }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.target.closest('[data-mk]')) {
      const open = S.openBq === tr.dataset.id ? null : tr.dataset.id;
      S.openBq = open;
      S.highlightBq = open;
      renderBQ();
      hooks.refresh('select');
    }
    if (S.activeBq !== tr.dataset.id) setActiveBq(tr.dataset.id);
  });
  t.addEventListener('focusin', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && S.activeBq !== tr.dataset.id) setActiveBq(tr.dataset.id);
  });
  t.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoHeight(e.target); });
  t.addEventListener('keydown', e => {
    if (e.key === 'Tab' && e.target.dataset.f === 'desc') {
      e.preventDefault();
      const b = bqById(e.target.closest('tr').dataset.id);
      changeLevel(b, e.shiftKey ? -1 : 1);
      setTimeout(() => $(`#bqTable tr[data-id="${b.id}"] [data-f=desc]`)?.focus());
    } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
  });
  t.addEventListener('change', e => {
    const f = e.target.dataset.f, tr = e.target.closest('tr[data-id]');
    if (!f || !tr) return;
    const b = bqById(tr.dataset.id);
    snapshot();
    if (f === 'qty') {
      const v = e.target.value.trim(), tot = bqTotals(b);
      if (v === '') b.manual = '';
      else if (!(tot.isManual === false && v === plain(tot.measured))) b.manual = num(v);
      return dirty('bqnum');
    }
    const wasHead = isHeading(b);
    b[f] = e.target.value;
    dirty(f === 'rate' ? 'bqnum' : (f === 'unit' && wasHead !== isHeading(b)) ? 'bq' : 'bqmeta');
  });
  const tabs = $('#bqSheets');
  tabs.addEventListener('click', e => sheetTabs(e, 'click'));
  tabs.addEventListener('dblclick', e => sheetTabs(e, 'dbl'));
  tabs.addEventListener('contextmenu', e => sheetTabs(e, 'ctx'));

  $('#bqSearch').oninput = renderBQ;
  $('#bqPaste').onclick = () => S.project ? gridEditor('import') : toast('Open a project first');
  $('#bqGrid').onclick = () => S.project ? gridEditor('edit') : toast('Open a project first');
  const addRow = head => {
    if (!S.project) return toast('Open a project first');
    snapshot();
    const a = bqById(S.activeBq);
    const level = !a ? 1 : head ? (a.level || 1) : isHeading(a) ? Math.min(MAX_LEVEL, (a.level || 1) + 1) : a.level;
    const b = { id: uid(), sheet: S.activeSheet, level, ref: '', desc: head ? 'New heading' : '', unit: head ? '' : 'm2', rate: '', manual: '', color: pickColor(D().bq.length) };
    const i = D().bq.indexOf(a);
    if (a && a.sheet === S.activeSheet) D().bq.splice(i + 1, 0, b);
    else { const last = D().bq.map(x => x.sheet).lastIndexOf(S.activeSheet); D().bq.splice(last + 1, 0, b); }
    S.activeBq = b.id;
    dirty('bq');
    setTimeout(() => { const el = $(`#bqTable tr[data-id="${b.id}"] [data-f=desc]`); el?.focus(); el?.select(); });
  };
  $('#bqAdd').onclick = () => addRow(false);
  $('#bqAddHdr').onclick = () => addRow(true);
  const withActive = fn => () => { const b = bqById(S.activeBq); b ? fn(b) : toast('Select a BQ row first'); };
  $('#bqIn').onclick = withActive(b => changeLevel(b, 1));
  $('#bqOut').onclick = withActive(b => changeLevel(b, -1));
  $('#bqUp').onclick = withActive(b => moveRow(b, -1));
  $('#bqDown').onclick = withActive(b => moveRow(b, 1));
  $('#bqDel').onclick = withActive(async b => {
    const n = D().marks.filter(m => m.bq === b.id).length;
    if (n && !await confirmBox('Delete BQ row', `${n} markups are linked to "${bqName(b)}". Delete the row? Markups are kept but unlinked.`, 'Delete')) return;
    snapshot();
    D().bq = D().bq.filter(x => x.id !== b.id);
    D().marks.forEach(m => { if (m.bq === b.id) m.bq = null; });
    S.activeBq = null;
    dirty('all');
  });
  $('#bqNone').onclick = () => setActiveBq(null);
}
