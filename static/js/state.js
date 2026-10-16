// Shared app state, autosave and project-level helpers.
import { api, $, toast } from './ui.js';
import { bqQty, primary } from './geometry.js';

export const S = {
  project: null,        // {id, name, data}
  drawing: null,        // current drawing object (in project.data.drawings)
  pageNo: 1,
  pdf: null,            // pdf.js document for current drawing
  oldPdf: null,         // previous revision (compare)
  page: null,           // pdf.js page
  pageSize: [0, 0],     // PDF units (viewport scale 1)
  zoom: 1,
  tool: 'select',
  activeBq: null,
  activeSheet: null,    // BQ sheet shown in the grid
  openBq: null,         // BQ item whose markup list is expanded
  viewFileId: null,     // viewing an older drawing revision (temporary)
  activeCat: null,
  activeSig: null,
  selId: null,
  highlightBq: null,
  draft: null,          // in-progress mark {type, pts}
  hover: null,          // cursor point (PDF units)
  showValues: true,
  compare: false,
  signatures: [],
};

// Registered by app.js; called when data changes so panels re-render.
export const hooks = { refresh: () => {} };

const D = () => S.project.data;

let saveTimer, saving = false, pending = false;
export function dirty(parts = 'all') {
  hooks.refresh(parts);
  if (!S.project) return;
  $('#saveState').textContent = 'Unsaved…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

export async function save() {
  if (!S.project) return;
  if (saving) { pending = true; return; }
  saving = true;
  try {
    await api(`/api/projects/${S.project.id}`, { method: 'PUT', json: { name: S.project.name, data: S.project.data } });
    $('#saveState').textContent = 'Saved ✓';
  } catch (e) {
    $('#saveState').textContent = 'Save failed!';
    toast('Auto-save failed: ' + e.message, 5000);
  } finally {
    saving = false;
    if (pending) { pending = false; save(); }
  }
}
window.addEventListener('beforeunload', e => {
  if ($('#saveState').textContent !== 'Saved ✓' && S.project) { save(); e.preventDefault(); }
});

// ---- lookups ------------------------------------------------------------------
export const bqById = id => D().bq.find(b => b.id === id);
export const catById = id => D().categories.find(c => c.id === id);
export const markById = id => D().marks.find(m => m.id === id);
export const drawingById = id => D().drawings.find(d => d.id === id);

export function pageInfo(dwg = S.drawing, page = S.pageNo) {
  if (!dwg) return {};
  dwg.pages = dwg.pages || {};
  return (dwg.pages[page] = dwg.pages[page] || {});
}

export const scaleOf = (dwgId, page) => {
  const d = drawingById(dwgId);
  return d?.pages?.[page]?.scale || 0;
};

export function markColor(m) {
  return m.color || bqById(m.bq)?.color || catById(m.cat)?.color || '#e6194b';
}

// Category is hidden if it or any ancestor is hidden.
export function catHidden(id) {
  for (let c = catById(id), n = 0; c && n < 20; c = catById(c.parent), n++) if (c.hidden) return true;
  return false;
}

export const pageMarks = () => S.drawing
  ? D().marks.filter(m => m.dwg === S.drawing.id && m.page === S.pageNo) : [];

export const markQty = m => primary(m, scaleOf(m.dwg, m.page));

// Measured quantity of a BQ item = sum of linked marks (with multiplier/deduct).
export function bqMeasured(item) {
  let q = 0;
  for (const m of D().marks) if (m.bq === item.id) q += bqQty(m, scaleOf(m.dwg, m.page), item.unit);
  return q;
}

// Qty = manual override when one is typed, otherwise the measured qty.
export function bqTotals(item) {
  const measured = bqMeasured(item);
  const isManual = item.manual !== '' && item.manual != null && Number.isFinite(+item.manual);
  const total = isManual ? +item.manual : measured;
  return { measured, isManual, total, amount: total * (+item.rate || 0) };
}

// A BQ row without a unit is a heading (description level), not a measurable item.
export const isHeading = b => !String(b?.unit ?? '').trim();

// Headings above an item in its sheet, outermost first (level 1 → level n-1).
export function bqAncestors(item) {
  const list = D().bq.filter(b => b.sheet === item.sheet);
  const out = [];
  let lvl = item.level || 1;
  for (let i = list.indexOf(item) - 1; i >= 0 && lvl > 1; i--) {
    if ((list[i].level || 1) < lvl) { out.unshift(list[i]); lvl = list[i].level || 1; }
  }
  return out;
}

// Short name: nearest heading + own description, e.g. "600 x 600 U Drain – not exceeding 1m depth".
export function bqName(item, withRef = true) {
  if (!item) return '';
  const parent = bqAncestors(item).pop();
  const desc = parent && !isHeading(item) ? `${parent.desc} – ${item.desc}` : item.desc;
  return (withRef && item.ref ? item.ref + ' ' : '') + (desc || '');
}

export const bqFullPath = item => [...bqAncestors(item).map(b => b.desc), item.desc].filter(Boolean).join(' > ');

export function catDescendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of D().categories) if (c.parent && out.has(c.parent) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}
