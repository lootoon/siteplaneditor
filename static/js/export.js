// Exports: Excel BQ + measurement sheets, marked-up PDF (pdf-lib), page PNG / print.
import { S, bqTotals, bqById, catById, markColor, scaleOf, drawingById, isHeading, bqFullPath } from './state.js';
import { $, toast, download, api } from './ui.js';
import { primary, bqQty, rectPts, centroid, fmt, invert, applyM, scaleOfM, IDENTITY } from './geometry.js';
import { qtyText, legendBox, TYPE_NAME } from './overlay.js';
import { loadPdf, revOf, renderPage, shownFileId } from './viewer.js';

const D = () => S.project.data;
const stamp = () => new Date().toISOString().slice(0, 10);
const safe = s => String(s).replace(/[\\/:*?"<>|]/g, '_');

function catPath(id) {
  const names = [];
  for (let c = catById(id), n = 0; c && n < 20; c = catById(c.parent), n++) names.unshift(c.name);
  return names.join(' / ');
}

// ---- Excel ------------------------------------------------------------------------
export function exportXlsx() {
  const wb = XLSX.utils.book_new(), used = new Set(['Summary', 'Measurements', 'By Category']);
  const summary = [['Sheet', 'Amount']];
  let grand = 0;
  const sheets = [];
  for (const sh of D().sheets) {
    const aoa = [['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Qty source', 'Measured qty', 'Level']];
    let total = 0;
    for (const b of D().bq.filter(x => x.sheet === sh.id)) {
      const indent = '    '.repeat((b.level || 1) - 1);
      if (isHeading(b)) { aoa.push([b.ref, indent + b.desc, '', null, null, null, '', null, b.level || 1]); continue; }
      const t = bqTotals(b);
      total += t.amount;
      aoa.push([b.ref, indent + b.desc, b.unit, +t.total.toFixed(3), b.rate === '' ? null : +b.rate, +t.amount.toFixed(2),
        t.isManual ? 'Manual' : 'Measured', +t.measured.toFixed(3), b.level || 1]);
    }
    aoa.push([], ['', `TOTAL ${sh.name}`.toUpperCase(), '', null, null, +total.toFixed(2)]);
    summary.push([sh.name, +total.toFixed(2)]);
    grand += total;
    // Excel sheet names: max 31 chars, unique, none of []:*?/\
    let nm = sh.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet', k = 2;
    while (used.has(nm)) nm = `${nm.slice(0, 28)} ${k++}`;
    used.add(nm);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 7 }, { wch: 70 }, { wch: 7 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 6 }];
    sheets.push([nm, ws]);
  }
  summary.push([], ['GRAND TOTAL', +grand.toFixed(2)]);
  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws['!cols'] = [{ wch: 30 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, sws, 'Summary');
  for (const [nm, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, nm);

  const det = [['Drawing', 'Rev', 'Page', 'Category', 'BQ Sheet', 'BQ Item', 'BQ Description', 'Type', 'Label', 'Measured', 'Unit', 'Multiplier', 'Deduct', 'Qty to BQ', 'BQ Unit']];
  for (const m of D().marks) {
    if (!['length', 'area', 'rect', 'count', 'angle'].includes(m.type)) continue;
    const d = drawingById(m.dwg), b = bqById(m.bq), sc = scaleOf(m.dwg, m.page), p = primary(m, sc);
    det.push([d?.name, d?.rev, m.page, catPath(m.cat), D().sheets.find(x => x.id === b?.sheet)?.name || '', b?.ref || '', b ? bqFullPath(b) : '', TYPE_NAME[m.type], m.label || '',
      +p.q.toFixed(3), p.u, +m.mult || 1, m.deduct ? 'Yes' : '', b ? +bqQty(m, sc, b.unit).toFixed(3) : '', b?.unit || '']);
  }

  const cat = [['Category', 'Length (m)', 'Area (m²)', 'Count (nr)']];
  const agg = new Map();
  for (const m of D().marks) {
    const k = catPath(m.cat) || '(no category)', a = agg.get(k) || { m: 0, 'm²': 0, nr: 0 };
    const p = primary(m, scaleOf(m.dwg, m.page)), mult = (+m.mult || 1) * (m.deduct ? -1 : 1);
    if (p.u in a) a[p.u] += p.q * (p.u === 'nr' ? 1 : mult);
    agg.set(k, a);
  }
  for (const [k, a] of [...agg].sort()) cat.push([k, +a.m.toFixed(3), +a['m²'].toFixed(3), a.nr]);

  const ws2 = XLSX.utils.aoa_to_sheet(det);
  ws2['!cols'] = [{ wch: 24 }, { wch: 4 }, { wch: 5 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 60 }, { wch: 9 }, { wch: 14 }, { wch: 11 }, { wch: 5 }, { wch: 9 }, { wch: 7 }, { wch: 11 }, { wch: 7 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Measurements');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cat), 'By Category');
  XLSX.writeFile(wb, `${safe(S.project.name)} BQ ${stamp()}.xlsx`);
}

// ---- marked-up PDF ------------------------------------------------------------------
const hex = h => { const n = parseInt(h.slice(1), 16); return PDFLib.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
// Standard fonts only cover WinAnsi; replace what they cannot encode.
const ansi = s => String(s ?? '').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ÿ…]/g, '?');

export async function exportPdf() {
  const dwg = S.drawing;
  if (!dwg) return toast('Open a drawing first');
  toast('Building PDF…', 10000);
  const { PDFDocument, StandardFonts, degrees } = PDFLib;
  const bytes = await (await api(`/api/files/${dwg.fileId}`)).arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const jsPdf = await loadPdf(dwg.fileId);
  const imgCache = new Map();
  // the drawing may be shifted under the markups (Align → Move the drawing)
  const xf = revOf(dwg, dwg.fileId)?.xform || IDENTITY, inv = invert(xf), k = 1 / scaleOfM(xf);

  for (let n = 1; n <= jsPdf.numPages; n++) {
    const marks = D().marks.filter(m => m.dwg === dwg.id && m.page === n);
    const info = dwg.pages?.[n] || {};
    if (!marks.length && !info.legend?.show) continue;
    const vp = (await jsPdf.getPage(n)).getViewport({ scale: 1 });
    const pg = doc.getPage(n - 1);
    const T = (x, y) => { const q = applyM(inv, [x, y]); return vp.convertToPdfPoint(q[0], q[1]); };
    const o = T(0, 0), ox = T(10, 0), rot = Math.atan2(ox[1] - o[1], ox[0] - o[0]) * 180 / Math.PI;
    const path = (pts, close) => pts.map((p, i) => { const q = T(p[0], p[1]); return `${i ? 'L' : 'M'}${q[0]} ${-q[1]}`; }).join(' ') + (close ? ' Z' : '');
    const text = (s, x, y, size, color, f = font, anchor = 'start') => {
      s = ansi(s);
      const w = f.widthOfTextAtSize(s, size);
      const sx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      const [px, py] = T(sx, y + size * 0.35);
      pg.drawText(s, { x: px, y: py, size: size * k, font: f, color, rotate: degrees(rot) });
    };
    const box = (x, y, w, h, opts) => pg.drawSvgPath(path(rectPts([x, y], [x + w, y + h]), true), { x: 0, y: 0, ...opts });
    const white = PDFLib.rgb(1, 1, 1);

    for (const m of marks) {
      const c = hex(markColor(m)), lbl = qtyText(m);
      switch (m.type) {
        case 'length': case 'angle': {
          pg.drawSvgPath(path(m.pts), { x: 0, y: 0, borderColor: c, borderWidth: 1.6, borderDashArray: m.deduct ? [5, 3] : undefined });
          const i = Math.floor((m.pts.length - 1) / 2), a = m.pts[i], b = m.pts[i + 1] || a;
          if (m.type === 'length') text(lbl, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 7, 8, c, bold, 'middle');
          else if (m.pts.length === 3) text(lbl, m.pts[1][0] + 10, m.pts[1][1] - 8, 8, c, bold);
          break;
        }
        case 'area': case 'rect': case 'highlight': {
          const pts = m.type === 'area' ? m.pts : rectPts(m.pts[0], m.pts[1]);
          pg.drawSvgPath(path(pts, true), { x: 0, y: 0, color: c, opacity: m.type === 'highlight' ? 0.3 : (m.deduct ? 0.08 : 0.2), borderColor: c, borderWidth: m.type === 'highlight' ? 0.5 : 1.4, borderDashArray: m.deduct ? [5, 3] : undefined });
          if (m.type !== 'highlight') { const [x, y] = centroid(pts); text(lbl, x, y, 8, c, bold, 'middle'); }
          break;
        }
        case 'count':
          for (const p of m.pts) { const [x, y] = T(p[0], p[1]); pg.drawCircle({ x, y, size: 4 * k, color: c, borderColor: white, borderWidth: 0.8 }); }
          if (m.pts.length) text(lbl, m.pts[0][0] + 7, m.pts[0][1] - 7, 8, c, bold);
          break;
        case 'text': {
          const lines = String(m.text || '').split('\n'), fs = m.fs || 10;
          const w = Math.max(40, ...lines.map(l => font.widthOfTextAtSize(ansi(l), fs))) + 10, h = lines.length * fs * 1.25 + 8;
          const [x, y] = m.pts[0];
          box(x, y, w, h, { color: PDFLib.rgb(1, 0.98, 0.9), opacity: 0.95, borderColor: c, borderWidth: 0.8 });
          lines.forEach((l, i) => text(l, x + 5, y + 4 + fs * (i + 1) - fs * 0.35, fs, PDFLib.rgb(0.13, 0.13, 0.13)));
          break;
        }
        case 'signature': {
          if (!imgCache.has(m.img)) imgCache.set(m.img, m.img.startsWith('data:image/png') ? await doc.embedPng(m.img) : await doc.embedJpg(m.img));
          const [a, b] = m.pts, x = Math.min(a[0], b[0]), y = Math.max(a[1], b[1]);
          const [px, py] = T(x, y);
          pg.drawImage(imgCache.get(m.img), { x: px, y: py, width: Math.abs(b[0] - a[0]) * k, height: Math.abs(b[1] - a[1]) * k, rotate: degrees(rot) });
          break;
        }
      }
    }
    if (info.legend?.show) {
      const L = legendBox(marks, info), black = PDFLib.rgb(0, 0, 0);
      box(L.x, L.y, L.w, L.h, { color: white, opacity: 0.95, borderColor: PDFLib.rgb(0.2, 0.2, 0.2), borderWidth: 0.8 });
      text('LEGEND', L.x + 6, L.y + 9, L.fs + 1.5, black, bold);
      L.rows.forEach((r, i) => {
        const yy = L.y + 22 + i * L.lh, c = hex(r.color);
        if (r.type === 'count') { const [x, y] = T(L.x + 13, yy + 5); pg.drawCircle({ x, y, size: 4, color: c }); }
        else if (r.type === 'length') pg.drawSvgPath(path([[L.x + 6, yy + 5], [L.x + 20, yy + 5]]), { x: 0, y: 0, borderColor: c, borderWidth: 2.5 });
        else box(L.x + 6, yy, 14, 10, { color: c, opacity: 0.4, borderColor: c, borderWidth: 0.8 });
        let name = ansi(r.name);
        while (name.length > 3 && font.widthOfTextAtSize(name, L.fs) > L.nameW) name = name.slice(0, -2) + '…';
        text(name, L.x + 26, yy + 5, L.fs, black);
        text(r.qty, L.x + L.w - 6, yy + 5, L.fs, black, font, 'end');
      });
    }
  }
  const out = await doc.save();
  download(new Blob([out], { type: 'application/pdf' }), `${safe(dwg.name.replace(/\.pdf$/i, ''))} - marked up ${stamp()}.pdf`);
  toast('PDF exported');
}

// ---- page image ------------------------------------------------------------------------
async function pageImage() {
  if (!S.page) { toast('Open a drawing first'); return null; }
  const [w, h] = S.pageSize, sc = Math.min(3, Math.sqrt(30e6 / (w * h)));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * sc); cv.height = Math.ceil(h * sc);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await renderPage(S.page, ctx, sc, revOf(S.drawing, shownFileId())?.xform).promise;
  const svg = $('#ovl').cloneNode(true);
  svg.querySelectorAll('.handles').forEach(n => n.remove());
  svg.setAttribute('width', cv.width); svg.setAttribute('height', cv.height);
  svg.insertAdjacentHTML('afterbegin', `<style>.lbl{font-family:Segoe UI,sans-serif;paint-order:stroke;stroke:#fff;stroke-linejoin:round;font-weight:600}.hit{stroke:transparent;fill:none}</style>`);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(url);
  return cv;
}

export async function exportPng() {
  const cv = await pageImage();
  if (!cv) return;
  cv.toBlob(b => download(b, `${safe(S.drawing.name.replace(/\.pdf$/i, ''))} p${S.pageNo}.png`), 'image/png');
}

export async function printPage() {
  const cv = await pageImage();
  if (!cv) return;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(`<title>Print</title><style>@page{margin:8mm}body{margin:0}img{width:100%;}</style><img src="${cv.toDataURL('image/png')}" onload="setTimeout(()=>print(),200)">`);
  w.document.close();
}
