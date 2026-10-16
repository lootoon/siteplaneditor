// Draws markups, the in-progress draft and the legend into the SVG overlay (PDF units).
import { S, pageMarks, markColor, catHidden, bqById, catById, scaleOf, pageInfo, bqName } from './state.js';
import { $, esc } from './ui.js';
import { centroid, rectPts, fmt, primary, polyLength, angleDeg, polyArea, bqQty, unitKind } from './geometry.js';

const TYPE_NAME = { length: 'Length', area: 'Area', rect: 'Area', count: 'Count', angle: 'Angle', text: 'Comment', highlight: 'Highlight', signature: 'Signature' };
export { TYPE_NAME };

const P = pts => pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');

export function qtyText(m) {
  const { q, u } = primary(m, scaleOf(m.dwg, m.page));
  if (m.type === 'angle') return fmt(q, 1) + '°';
  if (m.type === 'count') return q + ' nr';
  if (!scaleOf(m.dwg, m.page)) return 'no scale';
  const mult = +m.mult && +m.mult !== 1 ? ` ×${m.mult}` : '';
  return (m.deduct ? '−' : '') + fmt(q) + ' ' + u + mult;
}

function label(x, y, text, color, k, anchor = 'middle') {
  return `<text class="lbl" x="${x}" y="${y}" font-size="${12 * k}" stroke-width="${3 * k}" fill="${color}" text-anchor="${anchor}" dominant-baseline="middle">${esc(text)}</text>`;
}

function textBox(m, c, sel) {
  const lines = String(m.text || '').split('\n'), fs = m.fs || 10;
  const w = Math.max(40, ...lines.map(l => l.length * fs * 0.55)) + 10, h = lines.length * fs * 1.25 + 8;
  const [x, y] = m.pts[0];
  m._w = w; m._h = h; // cached for PDF export / hit testing
  return `<g class="mk" data-id="${m.id}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fffbe6" fill-opacity=".95" stroke="${c}" stroke-width="${sel ? 1.6 : 1}" rx="2" class="hitfill"/>
    ${lines.map((l, i) => `<text x="${x + 5}" y="${y + 4 + fs * (i + 1)}" font-size="${fs}" font-family="Segoe UI, Arial" fill="#222" pointer-events="none">${esc(l)}</text>`).join('')}
  </g>`;
}

function markSvg(m, k) {
  const c = markColor(m), sel = m.id === S.selId, hl = S.highlightBq && m.bq === S.highlightBq;
  const sw = sel ? 3.2 : 2.2;
  const glow = (shape) => hl || sel ? shape.replace('/>', ` stroke="${sel ? '#00b4ff' : '#ffd400'}" stroke-width="${(sw + 6)}" stroke-opacity=".55" fill="none" vector-effect="non-scaling-stroke" pointer-events="none"/>`) : '';
  let s = '';
  switch (m.type) {
    case 'length': {
      const pl = `<polyline points="${P(m.pts)}"/>`;
      s = glow(pl) + `<polyline points="${P(m.pts)}" fill="none" stroke="${c}" stroke-width="${sw}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"${m.deduct ? ' stroke-dasharray="6 4"' : ''}/>
        <polyline class="hit" points="${P(m.pts)}" stroke-width="${12 * k}"/>`
        + m.pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${2.2 * k}" fill="${c}" pointer-events="none"/>`).join('');
      if (S.showValues) {
        const a = m.pts[Math.floor((m.pts.length - 1) / 2)], b = m.pts[Math.floor((m.pts.length - 1) / 2) + 1] || a;
        s += label((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 9 * k, qtyText(m), c, k);
      }
      break;
    }
    case 'area': case 'rect': case 'highlight': {
      const pts = m.type === 'area' ? m.pts : rectPts(m.pts[0], m.pts[1] || m.pts[0]);
      const pg = `<polygon points="${P(pts)}"/>`;
      const fillOp = m.type === 'highlight' ? 0.3 : (m.deduct ? 0.08 : 0.22);
      s = glow(pg) + `<polygon class="hitfill" points="${P(pts)}" fill="${c}" fill-opacity="${fillOp}" stroke="${c}" stroke-width="${m.type === 'highlight' ? 1 : sw}" vector-effect="non-scaling-stroke"${m.deduct ? ' stroke-dasharray="6 4"' : ''}/>`;
      if (S.showValues && m.type !== 'highlight') { const [x, y] = centroid(pts); s += label(x, y, qtyText(m), c, k); }
      break;
    }
    case 'count': {
      const r = 6 * k;
      s = m.pts.map((p, i) => `<circle class="hitfill" data-pt="${i}" cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${c}" fill-opacity=".85" stroke="${sel || hl ? '#00b4ff' : '#fff'}" stroke-width="${sel || hl ? 2.5 : 1.5}" vector-effect="non-scaling-stroke"/>`).join('');
      if (S.showValues && m.pts.length) s += label(m.pts[0][0] + 9 * k, m.pts[0][1] - 9 * k, qtyText(m), c, k, 'start');
      break;
    }
    case 'angle': {
      s = `<polyline points="${P(m.pts)}" fill="none" stroke="${c}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>
        <polyline class="hit" points="${P(m.pts)}" stroke-width="${12 * k}"/>`;
      if (m.pts.length === 3) s += label(m.pts[1][0] + 14 * k, m.pts[1][1] - 12 * k, qtyText(m), c, k, 'start');
      break;
    }
    case 'text': return textBox(m, c, sel);
    case 'signature': {
      const [a, b] = m.pts, x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      return `<g class="mk" data-id="${m.id}"><image href="${m.img}" x="${x}" y="${y}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" preserveAspectRatio="none" class="hitfill"/>
        ${sel ? `<rect x="${x}" y="${y}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="none" stroke="#00b4ff" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none"/>` : ''}</g>`;
    }
  }
  return `<g class="mk" data-id="${m.id}">${s}</g>`;
}

function handles(m, k) {
  let pts = m.pts;
  if (m.type === 'text') return '';
  return pts.map((p, i) => `<rect class="hdl" data-v="${i}" x="${p[0] - 4.5 * k}" y="${p[1] - 4.5 * k}" width="${9 * k}" height="${9 * k}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('');
}

function draftSvg(k) {
  const d = S.draft, h = S.hover;
  if (!d) return '';
  const pts = h ? [...d.pts, h] : d.pts;
  const c = d.type === 'calibrate' || d.type === 'align' ? '#ff00aa' : (d.color || '#e6194b');
  let s = '';
  if (d.type === 'area' && pts.length > 1) {
    s = `<polygon points="${P(pts)}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
    const sc = scaleOf(S.drawing.id, S.pageNo);
    if (pts.length > 2 && sc) { const [x, y] = centroid(pts); s += label(x, y, fmt(polyArea(pts) * sc * sc) + ' m²', c, k); }
  } else if ((d.type === 'rect' || d.type === 'highlight') && pts.length === 2) {
    s = `<polygon points="${P(rectPts(pts[0], pts[1]))}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
  } else if (d.type === 'align') {
    const names = ['A old', 'A new', 'B old', 'B new'];
    s = d.pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${5 * k}" fill="none" stroke="${i % 2 ? '#0070ff' : '#e00'}" stroke-width="2" vector-effect="non-scaling-stroke"/>` + label(p[0] + 8 * k, p[1] - 8 * k, names[i], i % 2 ? '#0070ff' : '#e00', k, 'start')).join('');
    return s;
  } else {
    s = `<polyline points="${P(pts)}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`;
    const sc = scaleOf(S.drawing.id, S.pageNo);
    if (pts.length > 1 && (d.type === 'length' || d.type === 'calibrate')) {
      const last = pts[pts.length - 1];
      const txt = d.type === 'calibrate' || !sc ? fmt(polyLength(pts), 1) + ' pt' : fmt(polyLength(pts) * sc) + ' m';
      s += label(last[0] + 10 * k, last[1] + 14 * k, txt, c, k, 'start');
    }
    if (d.type === 'angle' && pts.length === 3) s += label(pts[1][0] + 14 * k, pts[1][1] - 12 * k, fmt(angleDeg(pts[0], pts[1], pts[2]), 1) + '°', c, k, 'start');
  }
  s += d.pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${3 * k}" fill="${c}"/>`).join('');
  return `<g pointer-events="none">${s}</g>`;
}

// Legend rows: one per BQ item (or category, or type) used on this page.
export function legendRows(marks) {
  const rows = new Map();
  for (const m of marks) {
    if (!['length', 'area', 'rect', 'count'].includes(m.type)) continue;
    const b = bqById(m.bq), c = catById(m.cat);
    const key = b ? 'b' + b.id : c ? 'c' + c.id : 't' + m.type + markColor(m);
    const name = b ? bqName(b) : c ? c.name : 'Unassigned ' + TYPE_NAME[m.type].toLowerCase();
    const r = rows.get(key) || { color: markColor(m), name, type: m.type, q: {} };
    if (b) {
      // BQ items: show what this page contributes, in the item's unit
      const u = b.unit || 'qty';
      r.q[u] = (r.q[u] || 0) + bqQty(m, scaleOf(m.dwg, m.page), b.unit);
    } else {
      const { q, u } = primary(m, scaleOf(m.dwg, m.page));
      r.q[u] = (r.q[u] || 0) + q * (m.deduct ? -1 : 1);
    }
    rows.set(key, r);
  }
  return [...rows.values()].map(r => ({ ...r, qty: Object.entries(r.q).map(([u, q]) => u === 'nr' || unitKind(u) === 'count' ? `${fmt(q, Number.isInteger(q) ? 0 : 2)} ${u}` : `${fmt(q)} ${u}`).join(', ') }));
}

export function legendBox(marks, info) {
  const rows = legendRows(marks);
  const fs = 8, lh = 13, x = info.legend?.x ?? 20, y = info.legend?.y ?? 20;
  const nameW = Math.min(300, Math.max(80, ...rows.map(r => r.name.length * fs * 0.52)));
  const qW = Math.max(50, ...rows.map(r => r.qty.length * fs * 0.55));
  const w = 26 + nameW + qW + 10, h = 22 + Math.max(1, rows.length) * lh + 4;
  return { x, y, w, h, fs, lh, nameW, rows };
}

function legendSvg(marks, info) {
  const L = legendBox(marks, info);
  const trunc = (s, w) => s.length * L.fs * 0.52 > w ? s.slice(0, Math.floor(w / (L.fs * 0.52)) - 1) + '…' : s;
  return `<g class="legend" data-legend="1">
    <rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="#fff" fill-opacity=".95" stroke="#333" stroke-width=".8"/>
    <text x="${L.x + 6}" y="${L.y + 13}" font-size="${L.fs + 1.5}" font-weight="700" font-family="Segoe UI, Arial">LEGEND</text>
    ${L.rows.map((r, i) => {
      const yy = L.y + 22 + i * L.lh;
      const sw = r.type === 'count' ? `<circle cx="${L.x + 13}" cy="${yy + 5}" r="4" fill="${r.color}"/>`
        : r.type === 'length' ? `<line x1="${L.x + 6}" y1="${yy + 5}" x2="${L.x + 20}" y2="${yy + 5}" stroke="${r.color}" stroke-width="2.5"/>`
          : `<rect x="${L.x + 6}" y="${yy}" width="14" height="10" fill="${r.color}" fill-opacity=".4" stroke="${r.color}"/>`;
      return sw + `<text x="${L.x + 26}" y="${yy + 8}" font-size="${L.fs}" font-family="Segoe UI, Arial">${esc(trunc(r.name, L.nameW))}</text>
        <text x="${L.x + L.w - 6}" y="${yy + 8}" font-size="${L.fs}" text-anchor="end" font-family="Segoe UI, Arial">${esc(r.qty)}</text>`;
    }).join('')}
    ${L.rows.length ? '' : `<text x="${L.x + 6}" y="${L.y + 30}" font-size="${L.fs}" fill="#888" font-family="Segoe UI, Arial">No measurements on this page</text>`}
  </g>`;
}

export const visibleMarks = () => pageMarks().filter(m => !catHidden(m.cat));

let scheduled = false;
export function drawOverlay() {
  if (scheduled) return;
  scheduled = true;
  // rAF for smooth dragging; timer fallback because rAF pauses in background windows
  let done = false;
  const run = () => { if (!done) { done = true; scheduled = false; paint(); } };
  requestAnimationFrame(run);
  setTimeout(run, 100);
}

function paint() {
  {
    const svg = $('#ovl');
    if (!S.drawing || !S.page) { svg.innerHTML = ''; return; }
    const k = 1 / S.zoom, marks = visibleMarks();
    // draw area/highlights first so lines and counts stay clickable on top
    const order = { highlight: 0, area: 1, rect: 1, length: 2, angle: 2, count: 3, signature: 4, text: 5 };
    marks.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || (a.id === S.selId) - (b.id === S.selId));
    let s = marks.map(m => markSvg(m, k)).join('');
    const info = pageInfo();
    if (info.legend?.show) s += legendSvg(marks, info);
    const sel = marks.find(m => m.id === S.selId);
    if (sel) s += `<g class="handles">${handles(sel, k)}</g>`;
    s += draftSvg(k);
    svg.innerHTML = s;
  }
}
