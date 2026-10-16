// PDF rendering, zoom and page navigation. The SVG overlay is drawn by overlay.js.
import { S, hooks } from './state.js';
import { $, toast } from './ui.js';

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const MARGIN = 30;               // #pagewrap margin (px)
const MAX_PIXELS = 36e6;         // cap canvas size for huge sheets
const docCache = new Map();      // fileId -> Promise<PDFDocumentProxy>

export function loadPdf(fileId) {
  if (!docCache.has(fileId)) {
    const p = pdfjsLib.getDocument({ url: `/api/files/${fileId}`, withCredentials: true }).promise;
    p.catch(() => docCache.delete(fileId));
    docCache.set(fileId, p);
  }
  return docCache.get(fileId);
}

const stage = () => $('#stage');

export const revOf = (dwg, fileId) => (dwg?.revisions || []).find(r => r.fileId === fileId);
// File shown as the base: the current revision, or an older one being viewed.
export const shownFileId = () => S.viewFileId || S.drawing?.fileId;

export async function openDrawing(dwg, pageNo = 1, keepView = false) {
  if (dwg !== S.drawing) S.viewFileId = null;
  S.drawing = dwg;
  $('#empty').hidden = !!dwg;
  $('#pagewrap').classList.toggle('show', !!dwg);
  showRevBanner();
  if (!dwg) { S.pdf = null; hooks.refresh('all'); return; }
  try {
    S.pdf = await loadPdf(shownFileId());
  } catch (e) {
    toast('Could not open PDF: ' + e.message, 5000);
    return;
  }
  if (!S.viewFileId) dwg.pageCount = S.pdf.numPages;
  await loadOldRevision();
  await gotoPage(Math.min(pageNo, S.pdf.numPages), keepView);
  hooks.refresh('all');
}

// Temporarily show an older revision under the markups (null = back to current).
export async function viewRevision(fileId) {
  S.viewFileId = fileId && fileId !== S.drawing?.fileId ? fileId : null;
  await openDrawing(S.drawing, S.pageNo, true);
}

function showRevBanner() {
  const b = $('#revBanner'), r = S.viewFileId && revOf(S.drawing, S.viewFileId);
  b.hidden = !r;
  if (r) $('#revBannerText').textContent = `Viewing old revision R${r.rev} (${r.name || ''}) – current is R${S.drawing.rev}. Markups are drawn on top.`;
}

export async function loadOldRevision() {
  const revs = S.drawing?.revisions || [];
  const i = revs.findIndex(r => r.fileId === shownFileId());
  const prev = i > 0 ? revs[i - 1] : null;
  S.oldRev = prev;
  S.oldPdf = prev ? await loadPdf(prev.fileId).catch(() => null) : null;
  $('#optCompare').disabled = !S.oldPdf;
  if (!S.oldPdf) { S.compare = false; $('#optCompare').checked = false; }
}

export async function gotoPage(n, keepView = false) {
  if (!S.pdf || n < 1 || n > S.pdf.numPages) return;
  S.pageNo = n;
  S.selId = null;
  S.draft = null;
  S.page = await S.pdf.getPage(n);
  const vp = S.page.getViewport({ scale: 1 });
  S.pageSize = [vp.width, vp.height];
  if (!keepView) fitPage(); else applySize();
  renderBitmap(true);
  hooks.refresh('page');
}

function applySize() {
  const [w, h] = S.pageSize, z = S.zoom;
  const wrap = $('#pagewrap');
  wrap.style.width = w * z + 'px';
  wrap.style.height = h * z + 'px';
  for (const c of [$('#cvs'), $('#cvsOld')]) { c.style.width = w * z + 'px'; c.style.height = h * z + 'px'; }
  const svg = $('#ovl');
  svg.setAttribute('width', w * z);
  svg.setAttribute('height', h * z);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  $('#zLabel').textContent = Math.round(z * 100) + '%';
}

export function fitPage() {
  const st = stage(), [w, h] = S.pageSize;
  if (!w) return;
  S.zoom = Math.max(0.05, Math.min((st.clientWidth - MARGIN * 2) / w, (st.clientHeight - MARGIN * 2) / h));
  applySize();
  st.scrollLeft = 0; st.scrollTop = 0;
  renderBitmap();
  hooks.refresh('overlay');
}

// Zoom keeping the PDF point under (clientX, clientY) fixed on screen.
export function zoomAt(newZoom, clientX, clientY) {
  if (!S.page) return;
  newZoom = Math.max(0.05, Math.min(newZoom, 40));
  const st = stage(), r = st.getBoundingClientRect();
  if (clientX == null) { clientX = r.left + st.clientWidth / 2; clientY = r.top + st.clientHeight / 2; }
  const ox = clientX - r.left, oy = clientY - r.top;
  const px = (st.scrollLeft + ox - MARGIN) / S.zoom, py = (st.scrollTop + oy - MARGIN) / S.zoom;
  S.zoom = newZoom;
  applySize();
  st.scrollLeft = px * newZoom + MARGIN - ox;
  st.scrollTop = py * newZoom + MARGIN - oy;
  renderBitmap();
  hooks.refresh('overlay');
}

export function setView(zoom, sx, sy) {
  S.zoom = zoom; applySize();
  stage().scrollLeft = sx; stage().scrollTop = sy;
  renderBitmap(); hooks.refresh('overlay');
}

// Client coords -> PDF units.
export function toPdf(e) {
  const r = $('#ovl').getBoundingClientRect();
  return [(e.clientX - r.left) / S.zoom, (e.clientY - r.top) / S.zoom];
}

// ---- bitmap rendering (debounced; old bitmap stays visible, CSS-scaled, meanwhile) ----
let renderTimer, renderSeq = 0, mainTask = null, oldTask = null;
export function renderBitmap(now = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, now ? 0 : 160);
}

function renderScale() {
  const [w, h] = S.pageSize;
  let sc = S.zoom * (window.devicePixelRatio || 1);
  if (w * h * sc * sc > MAX_PIXELS) sc = Math.sqrt(MAX_PIXELS / (w * h));
  return sc;
}

// Render a page into ctx at scale sc, optionally moved by xf (drawing -> markup space matrix).
export function renderPage(page, ctx, sc, xf) {
  const vp = page.getViewport({ scale: sc });
  const transform = xf ? [xf[0], xf[1], xf[2], xf[3], xf[4] * sc, xf[5] * sc] : undefined;
  return page.render({ canvasContext: ctx, viewport: vp, transform });
}

async function renderTo(page, target, recolor, which, xf) {
  const sc = renderScale();
  const off = document.createElement('canvas');
  off.width = Math.ceil(S.pageSize[0] * sc); off.height = Math.ceil(S.pageSize[1] * sc);
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, off.width, off.height);
  const task = renderPage(page, ctx, sc, xf);
  if (which === 'main') { mainTask?.cancel(); mainTask = task; } else { oldTask?.cancel(); oldTask = task; }
  await task.promise;
  if (recolor) {
    // dark lines -> red, white -> transparent, so the old revision can sit on top of the new one
    const img = ctx.getImageData(0, 0, off.width, off.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
      d[i] = 230; d[i + 1] = 30; d[i + 2] = 30; d[i + 3] = Math.max(0, 255 - lum) * 0.85;
    }
    ctx.putImageData(img, 0, 0);
  }
  target.width = off.width; target.height = off.height;
  target.getContext('2d').drawImage(off, 0, 0);
}

async function doRender() {
  if (!S.page) return;
  const seq = ++renderSeq;
  try {
    await renderTo(S.page, $('#cvs'), false, 'main', revOf(S.drawing, shownFileId())?.xform);
  } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); }
  const old = $('#cvsOld');
  old.hidden = !(S.compare && S.oldPdf);
  if (seq !== renderSeq || old.hidden) return;
  if (S.pageNo > S.oldPdf.numPages) { old.hidden = true; return; }
  try {
    const p = await S.oldPdf.getPage(S.pageNo);
    await renderTo(p, old, true, 'old', S.oldRev?.xform);
  } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); }
}

// Go to a markup: open its drawing/page, select it and centre it on screen.
export async function focusMark(m) {
  const d = S.project.data.drawings.find(x => x.id === m.dwg);
  if (!d) return;
  if (d !== S.drawing) await openDrawing(d, m.page);
  else if (m.page !== S.pageNo) await gotoPage(m.page, true);
  S.selId = m.id;
  const xs = m.pts.map(p => p[0]), ys = m.pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const st = stage(), bw = Math.max(x1 - x0, 40), bh = Math.max(y1 - y0, 40);
  // zoom out if it does not fit; otherwise keep the user's zoom
  const fit = Math.min((st.clientWidth - 2 * MARGIN) / (bw * 1.3), (st.clientHeight - 2 * MARGIN) / (bh * 1.3));
  if (S.zoom > fit) S.zoom = fit;
  applySize();
  st.scrollLeft = ((x0 + x1) / 2) * S.zoom + MARGIN - st.clientWidth / 2;
  st.scrollTop = ((y0 + y1) / 2) * S.zoom + MARGIN - st.clientHeight / 2;
  renderBitmap();
  hooks.refresh('select');
}

// ---- thumbnails ------------------------------------------------------------------
export async function renderThumb(pdf, n, canvas) {
  const page = await pdf.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 180 / vp1.width });
  canvas.width = vp.width; canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}
