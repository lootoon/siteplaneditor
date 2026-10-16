// Mouse / keyboard interaction on the drawing: measure tools, select/edit, pan, zoom, undo.
import { S, dirty, markById, pageInfo, bqById, catById, markColor, scaleOf } from './state.js';
import { $, $$, uid, toast, modal, ask, askText } from './ui.js';
import { toPdf, zoomAt, renderBitmap, revOf, shownFileId } from './viewer.js';
import { drawOverlay, legendBox, visibleMarks } from './overlay.js';
import { ortho, dist, polyLength, similarity, similarityMatrix, compose, IDENTITY, fmt } from './geometry.js';

const DRAW_TOOLS = ['length', 'area', 'rect', 'count', 'angle', 'text', 'highlight', 'signature', 'calibrate', 'align'];
const HINTS = {
  select: 'Click a markup to select · drag to move · drag handles to edit · Del to delete · drag empty space to pan',
  pan: 'Drag to pan · wheel to zoom',
  length: 'Click points · double-click / Enter to finish · Shift = straight · Backspace = undo point · Esc = cancel',
  area: 'Click corners · double-click / Enter to close · Shift = straight · Backspace = undo point',
  rect: 'Click two opposite corners',
  count: 'Click each item to count · Esc / Enter when done (next clicks start a new count)',
  angle: 'Click 3 points: start, vertex, end',
  text: 'Click where the comment should go',
  highlight: 'Click two opposite corners',
  signature: 'Click to place the selected signature',
  calibrate: 'Click two ends of a known dimension',
  align: 'Click point A on the OLD (red) drawing',
};

// ---- undo ------------------------------------------------------------------------
const undoStack = [], redoStack = [];
export function snapshot() {
  undoStack.push(JSON.stringify(S.project.data));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}
function restore(from, to) {
  if (!from.length) return toast('Nothing to undo');
  to.push(JSON.stringify(S.project.data));
  const data = JSON.parse(from.pop());
  S.project.data = data;
  S.drawing = data.drawings.find(d => d.id === S.drawing?.id) || S.drawing;
  S.selId = null;
  dirty('all');
  renderBitmap(true); // drawing alignment may have changed
}
export const undo = () => restore(undoStack, redoStack);
export const redo = () => restore(redoStack, undoStack);

// ---- tool switching ----------------------------------------------------------------
export function setTool(t) {
  finishDraft(false);
  S.tool = t;
  S.countId = null;
  if (t === 'signature' && !S.activeSig) {
    toast('Pick or draw a signature in the Signatures tab first');
    $('[data-rtab=sigs]').click();
  }
  if (DRAW_TOOLS.includes(t) && t !== 'calibrate' && t !== 'align' && !S.drawing) toast('Add a PDF drawing first');
  $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const st = $('#stage');
  st.classList.toggle('t-pan', t === 'pan');
  st.classList.toggle('t-draw', DRAW_TOOLS.includes(t));
  $('#hint').textContent = HINTS[t] || '';
  if (['length', 'area', 'rect', 'count'].includes(t) && S.drawing && !scaleOf(S.drawing.id, S.pageNo))
    toast('This page has no scale yet — use 📐 Scale first', 3500);
  drawOverlay();
}

function newMark(type, pts, extra = {}) {
  snapshot();
  const isQty = ['length', 'area', 'rect', 'count'].includes(type);
  const m = {
    id: uid(), dwg: S.drawing.id, page: S.pageNo, type, pts,
    cat: S.activeCat || null, bq: isQty ? S.activeBq || null : null, mult: 1, deduct: false, label: '', created: Date.now(), ...extra,
  };
  S.project.data.marks.push(m);
  return m;
}

function draftColor() {
  return markColor({ bq: S.activeBq, cat: S.activeCat });
}

// Finish the current draft. commit=false discards it.
function finishDraft(commit = true) {
  const d = S.draft;
  S.draft = null;
  if (!d || !commit) { drawOverlay(); return; }
  const pts = d.pts;
  if (d.type === 'length' && pts.length >= 2) newMark('length', pts);
  else if (d.type === 'area' && pts.length >= 3) newMark('area', pts);
  else { drawOverlay(); return; }
  dirty('marks');
}

function addPoint(p, e) {
  const t = S.tool;
  if (!S.drawing) return;
  if (t === 'count') {
    let m = S.countId && markById(S.countId);
    if (!m || m.page !== S.pageNo || m.dwg !== S.drawing.id) { m = newMark('count', []); S.countId = m.id; } else snapshot();
    m.pts.push(p);
    S.selId = m.id;
    return dirty('marks');
  }
  if (t === 'text') {
    return askText('New comment', '').then(txt => {
      if (!txt?.trim()) return;
      const m = newMark('text', [p], { text: txt, fs: Math.round(10 / Math.max(0.4, Math.min(S.zoom, 2.5))) });
      S.selId = m.id;
      dirty('marks');
    });
  }
  if (t === 'signature') {
    const sig = S.signatures.find(s => s.id === S.activeSig);
    if (!sig) return toast('Pick a signature in the Signatures tab first');
    const w = 140 / Math.max(S.zoom, 0.3), h = w / (sig.ratio || 3);
    const m = newMark('signature', [p, [p[0] + w, p[1] + h]], { img: sig.png, sig: sig.id });
    S.selId = m.id;
    setTool('select');
    return dirty('marks');
  }
  if (!S.draft) S.draft = { type: t, pts: [], color: draftColor() };
  const d = S.draft;
  if (e.shiftKey && d.pts.length) p = ortho(d.pts[d.pts.length - 1], p);
  d.pts.push(p);
  if ((t === 'rect' || t === 'highlight') && d.pts.length === 2) {
    S.draft = null;
    if (dist(d.pts[0], d.pts[1]) < 1) return drawOverlay();
    newMark(t, d.pts);
    return dirty('marks');
  }
  if (t === 'angle' && d.pts.length === 3) { S.draft = null; newMark('angle', d.pts); return dirty('marks'); }
  if (t === 'calibrate' && d.pts.length === 2) { S.draft = null; drawOverlay(); return calibrate(d.pts); }
  if (t === 'align') {
    $('#hint').textContent = ['Click point A on the OLD (red) drawing', 'Click the SAME point A on the NEW drawing',
      'Click point B on the OLD (red) drawing (far from A)', 'Click the SAME point B on the NEW drawing'][d.pts.length] || '';
    if (d.pts.length === 4) { S.draft = null; return applyAlign(d.pts); }
  }
  drawOverlay();
}

// ---- scale ------------------------------------------------------------------------
async function calibrate(pts) {
  const d = polyLength(pts);
  const res = await modal(`<h3>Set scale</h3>
    <p class="muted">Measured ${fmt(d, 1)} PDF units. Enter the real length of this dimension.</p>
    <form class="form" id="calF">
      <label>Real length</label><div class="row gap"><input type="number" step="any" id="calLen" required><select id="calU" style="width:90px"><option value="1">m</option><option value="0.001">mm</option></select></div>
      <label>Apply to</label><select id="calAll"><option value="page">This page only</option><option value="dwg">All pages of this drawing</option></select>
    </form>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="calOk">Set scale</button></div>`,
  (card, close) => {
    const ok = () => close({ len: +$('#calLen', card).value * +$('#calU', card).value, all: $('#calAll', card).value === 'dwg' });
    $('#calOk', card).onclick = ok;
    $('#calF', card).onsubmit = e => { e.preventDefault(); ok(); };
  });
  setTool('select');
  if (!res || !(res.len > 0)) return;
  snapshot();
  setScale(res.len / d, 'Calibrated', res.all);
}

export function setScale(mPerPt, label, allPages = false) {
  const pages = allPages ? Array.from({ length: S.pdf.numPages }, (_, i) => i + 1) : [S.pageNo];
  for (const n of pages) Object.assign(pageInfo(S.drawing, n), { scale: mPerPt, scaleLabel: label });
  toast(`Scale set${allPages ? ' for all pages' : ''}: ${label}`);
  dirty('all');
}

// ---- align markups to a new revision ----------------------------------------------------
async function applyAlign(pts) {
  setTool('select');
  const [a1, a2, b1, b2] = pts;
  if (dist(a1, b1) < 5) return toast('Points A and B are too close — try again with points far apart');
  const scope = await modal(`<h3>Align</h3>
    <p>What should move so the old markups and the new drawing line up?</p>
    <div class="form">
      <button class="btn primary" id="alX">Move the drawing</button><span class="muted small">Markups and scale stay exactly as they are; the new drawing is shifted / scaled / rotated under them. Recommended.</span>
      <button class="btn" id="alD">Move markups (all pages)</button><span class="muted small">Markups move onto the new drawing; page scales are adjusted.</span>
      <button class="btn" id="alP">Move markups (this page)</button><span class="muted small">As above, for this page only.</span>
    </div>
    <div class="actions"><button class="btn" data-close>Cancel</button></div>`,
  (card, close) => { $('#alP', card).onclick = () => close('page'); $('#alD', card).onclick = () => close('dwg'); $('#alX', card).onclick = () => close('drawing'); });
  if (!scope) return drawOverlay();
  if (scope === 'drawing') {
    const rev = revOf(S.drawing, shownFileId());
    if (!rev) return toast('No revision record for this drawing');
    snapshot();
    // clicked points are where things appear now; map new-drawing points onto the old (markup) points
    rev.xform = compose(similarityMatrix(a2, b2, a1, b1), rev.xform || IDENTITY);
    renderBitmap(true);
    toast('Drawing aligned to markups. Undo with Ctrl+Z, or reset in 🕘 Revisions.');
    return dirty('all');
  }
  snapshot();
  const T = similarity(a1, b1, a2, b2), sFactor = dist(a2, b2) / dist(a1, b1);
  const pages = new Set();
  for (const m of S.project.data.marks) {
    if (m.dwg !== S.drawing.id || (scope === 'page' && m.page !== S.pageNo)) continue;
    m.pts = m.pts.map(T);
    if (m.type === 'text' && m.fs) m.fs *= sFactor;
    pages.add(m.page);
  }
  // Real distances are unchanged, so metres-per-unit scales inversely with the drawing.
  if (Math.abs(sFactor - 1) > 0.002) {
    const ps = scope === 'page' ? [S.pageNo] : Object.keys(S.drawing.pages || {}).map(Number);
    for (const n of ps) { const pi = pageInfo(S.drawing, n); if (pi.scale) pi.scale /= sFactor; }
  }
  toast(`Markups aligned (scale ×${fmt(sFactor, 3)})`);
  dirty('all');
}

// ---- pointer handling ---------------------------------------------------------------
let drag = null, spaceDown = false;

function startPan(e) {
  const st = $('#stage');
  drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: st.scrollLeft, st: st.scrollTop };
  st.classList.add('panning');
}

function onDown(e) {
  if (!S.page) return;
  $('#stage').focus({ preventScroll: true });
  if (e.button === 1 || (e.button === 0 && (spaceDown || S.tool === 'pan'))) { e.preventDefault(); return startPan(e); }
  if (e.button !== 0) return;
  const p = toPdf(e);

  const onText = S.tool === 'text' && e.target.closest('.mk') && markById(e.target.closest('.mk').dataset.id)?.type === 'text';
  if (S.tool === 'select' || onText) {
    const hdl = e.target.closest('.hdl'), mk = e.target.closest('.mk'), lg = e.target.closest('[data-legend]');
    if (hdl && S.selId) {
      snapshot();
      drag = { kind: 'vertex', id: S.selId, v: +hdl.dataset.v, start: p };
      return;
    }
    if (mk) {
      const m = markById(mk.dataset.id);
      S.selId = m.id;
      snapshot();
      drag = { kind: 'move', id: m.id, start: p, orig: m.pts.map(q => [...q]), moved: false };
      dirty('select');
      return;
    }
    if (lg) {
      const info = pageInfo(), L = legendBox(visibleMarks(), info);
      snapshot();
      drag = { kind: 'legend', start: p, ox: L.x, oy: L.y };
      return;
    }
    if (S.selId) { S.selId = null; dirty('select'); }
    return startPan(e);
  }
  if (DRAW_TOOLS.includes(S.tool)) addPoint(p, e);
}

function onMove(e) {
  if (!S.page) return;
  if (drag?.kind === 'pan') {
    const st = $('#stage');
    st.scrollLeft = drag.sl - (e.clientX - drag.x);
    st.scrollTop = drag.st - (e.clientY - drag.y);
    return;
  }
  let p = toPdf(e);
  if (drag) {
    const m = drag.id && markById(drag.id);
    if (drag.kind === 'vertex' && m) {
      if (e.shiftKey && m.pts.length > 1) p = ortho(m.pts[drag.v === 0 ? 1 : drag.v - 1], p);
      if (m.type === 'signature' && drag.v === 1) { // keep aspect ratio
        const a = m.pts[0], r = Math.abs((m.pts[1][0] - a[0]) / (m.pts[1][1] - a[1])) || 3;
        p = [p[0], a[1] + (p[0] - a[0]) / r];
      }
      m.pts[drag.v] = p;
    } else if (drag.kind === 'move' && m) {
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      if (Math.hypot(dx, dy) * S.zoom > 2) drag.moved = true;
      if (drag.moved) m.pts = drag.orig.map(q => [q[0] + dx, q[1] + dy]);
    } else if (drag.kind === 'legend') {
      const info = pageInfo();
      info.legend = { ...info.legend, x: drag.ox + p[0] - drag.start[0], y: drag.oy + p[1] - drag.start[1] };
    }
    drawOverlay();
    return;
  }
  if (S.draft && e.shiftKey && S.draft.pts.length) p = ortho(S.draft.pts[S.draft.pts.length - 1], p);
  S.hover = p;
  showCursor(p);
  if (S.draft) drawOverlay();
}

function onUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  $('#stage').classList.remove('panning');
  if (d.kind === 'pan') return;
  if (d.kind === 'move' && !d.moved) { undoStack.pop(); return; }
  dirty('marks');
}

export function editComment(m) {
  return askText('Edit comment', m.text || '').then(t => { if (t != null) { snapshot(); m.text = t; dirty('marks'); } });
}

function onDbl(e) {
  const mk = e.target.closest('.mk'), m = mk && markById(mk.dataset.id);
  if (m?.type === 'text' && (S.tool === 'select' || S.tool === 'text')) return editComment(m);
  if (S.tool === 'select') return;
  if (S.draft && (S.tool === 'length' || S.tool === 'area')) {
    // the two clicks of a double-click each added a point; drop the duplicate
    const pts = S.draft.pts;
    while (pts.length > 1 && dist(pts[pts.length - 1], pts[pts.length - 2]) * S.zoom < 4) pts.pop();
    finishDraft(true);
  }
}

function showCursor(p) {
  const sc = scaleOf(S.drawing?.id, S.pageNo);
  let txt = sc ? `x ${fmt(p[0] * sc)} m  y ${fmt(p[1] * sc)} m` : '';
  if (S.draft?.pts.length && (S.draft.type === 'length' || S.draft.type === 'area') && sc) {
    const seg = dist(S.draft.pts[S.draft.pts.length - 1], p) * sc;
    txt = `segment ${fmt(seg)} m · total ${fmt((polyLength(S.draft.pts) + dist(S.draft.pts[S.draft.pts.length - 1], p)) * sc)} m`;
  }
  $('#cursor').textContent = txt;
}

function onWheel(e) {
  if (!S.page) return;
  e.preventDefault();
  const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  zoomAt(S.zoom * f, e.clientX, e.clientY);
}

function deleteSelected() {
  const m = markById(S.selId);
  if (!m) return;
  snapshot();
  S.project.data.marks = S.project.data.marks.filter(x => x.id !== m.id);
  S.selId = null;
  dirty('marks');
}

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !$('#modal').hidden) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); return redo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { spaceDown = true; $('#stage').classList.add('t-pan'); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (S.draft && ['length', 'area'].includes(S.draft.type) && S.draft.pts.length >= (S.draft.type === 'area' ? 3 : 2)) return finishDraft(true);
    if (S.draft) return finishDraft(false);
    if (S.countId) { S.countId = null; return toast('Count finished'); }
    if (S.selId) { S.selId = null; return dirty('select'); }
    return setTool('select');
  }
  if (e.key === 'Enter') { if (S.draft) finishDraft(true); else S.countId = null; return; }
  if (e.key === 'Backspace' && S.draft) { S.draft.pts.pop(); if (!S.draft.pts.length) S.draft = null; return drawOverlay(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selId) return deleteSelected();
  if (e.key === 'PageDown') return $('#pgNext').click();
  if (e.key === 'PageUp') return $('#pgPrev').click();
  const map = { v: 'select', h: 'pan', l: 'length', a: 'area', r: 'rect', c: 'count', g: 'angle', t: 'text', k: 'highlight', s: 'signature' };
  if (map[k]) setTool(map[k]);
  else if (k === 'f') import('./viewer.js').then(v => v.fitPage());
  else if (k === '+' || k === '=') zoomAt(S.zoom * 1.25);
  else if (k === '-') zoomAt(S.zoom / 1.25);
}

export function initTools() {
  const ovl = $('#ovl'), st = $('#stage');
  ovl.addEventListener('pointerdown', onDown);
  st.addEventListener('pointerdown', e => { if (e.target === st && S.page && (e.button === 1 || S.tool === 'pan' || S.tool === 'select' || spaceDown)) startPan(e); });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  ovl.addEventListener('dblclick', onDbl);
  st.addEventListener('wheel', onWheel, { passive: false });
  st.addEventListener('auxclick', e => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; $('#stage').classList.toggle('t-pan', S.tool === 'pan'); } });
  st.addEventListener('mouseleave', () => { S.hover = null; if (S.draft) drawOverlay(); });
  $$('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  setTool('select');
}

export { deleteSelected };
