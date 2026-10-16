// Pure geometry + quantity rules. Points are [x, y] in PDF units (pdf.js viewport scale 1).

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polyLength(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

export function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function centroid(pts) {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

export const rectPts = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];

export function angleDeg(a, v, b) {
  const a1 = Math.atan2(a[1] - v[1], a[0] - v[0]), a2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
  let d = Math.abs(a1 - a2) * 180 / Math.PI;
  return d > 180 ? 360 - d : d;
}

// Lock to horizontal / vertical (Shift) relative to the previous point.
export function ortho(prev, p) {
  if (!prev) return p;
  return Math.abs(p[0] - prev[0]) > Math.abs(p[1] - prev[1]) ? [p[0], prev[1]] : [prev[0], p[1]];
}

// Similarity transform mapping a1->a2 and b1->b2 (for re-aligning markups to a new drawing).
export function similarity(a1, b1, a2, b2) {
  const v1 = [b1[0] - a1[0], b1[1] - a1[1]], v2 = [b2[0] - a2[0], b2[1] - a2[1]];
  const l1 = Math.hypot(...v1) || 1, l2 = Math.hypot(...v2);
  const s = l2 / l1, rot = Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0]);
  const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  return p => {
    const x = p[0] - a1[0], y = p[1] - a1[1];
    return [a2[0] + c * x - sn * y, a2[1] + sn * x + c * y];
  };
}

// Same transform as a matrix [a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f.
export function similarityMatrix(a1, b1, a2, b2) {
  const v1 = [b1[0] - a1[0], b1[1] - a1[1]], v2 = [b2[0] - a2[0], b2[1] - a2[1]];
  const s = Math.hypot(...v2) / (Math.hypot(...v1) || 1), rot = Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0]);
  const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  return [c, sn, -sn, c, a2[0] - c * a1[0] + sn * a1[1], a2[1] - sn * a1[0] - c * a1[1]];
}
export const IDENTITY = [1, 0, 0, 1, 0, 0];
// compose(M2, M1) = apply M1 first, then M2
export function compose(m2, m1) {
  return [m2[0] * m1[0] + m2[2] * m1[1], m2[1] * m1[0] + m2[3] * m1[1],
    m2[0] * m1[2] + m2[2] * m1[3], m2[1] * m1[2] + m2[3] * m1[3],
    m2[0] * m1[4] + m2[2] * m1[5] + m2[4], m2[1] * m1[4] + m2[3] * m1[5] + m2[5]];
}
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export const applyM = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
export const scaleOfM = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// ---- quantities ---------------------------------------------------------------
// Raw measurements of a mark in real units, given page scale (metres per PDF unit).
export function measure(mark, scale) {
  const p = mark.pts, s = scale || 0;
  switch (mark.type) {
    case 'length': return { length: polyLength(p) * s };
    case 'area': return { area: polyArea(p) * s * s, perimeter: polyLength(p, true) * s };
    case 'rect': { const r = rectPts(p[0], p[1]); return { area: polyArea(r) * s * s, perimeter: polyLength(r, true) * s }; }
    case 'count': return { count: p.length };
    case 'angle': return { angle: p.length === 3 ? angleDeg(p[0], p[1], p[2]) : 0 };
    default: return {};
  }
}

export const MEASURE_TYPES = ['length', 'area', 'rect', 'count', 'angle'];

export function unitKind(unit) {
  const u = String(unit || '').toLowerCase().replace(/[\s.]/g, '').replace('²', '2').replace('³', '3');
  if (['m', 'lm', 'm1', 'rm', 'mr', 'lin.m', 'linm', 'meter', 'metre', 'mm'].includes(u)) return 'length';
  if (['m2', 'sqm', 'sq.m', 'sm', 'msq'].includes(u)) return 'area';
  if (['m3', 'cum', 'cu.m', 'cbm'].includes(u)) return 'volume';
  if (['nr', 'no', 'nos', 'pcs', 'pc', 'unit', 'units', 'set', 'sets', 'each', 'ea', 'item', 'lot', 'pair', 'point', 'pts'].includes(u)) return 'count';
  return null;
}

// Primary quantity (the number shown on the drawing) and its unit label.
export function primary(mark, scale) {
  const m = measure(mark, scale);
  switch (mark.type) {
    case 'length': return { q: m.length, u: 'm' };
    case 'area': case 'rect': return { q: m.area, u: 'm²' };
    case 'count': return { q: m.count, u: 'nr' };
    case 'angle': return { q: m.angle, u: '°' };
    default: return { q: 0, u: '' };
  }
}

// Quantity a mark contributes to a BQ item with the given unit. Multiplier and deduct applied.
export function bqQty(mark, scale, unit) {
  if (!MEASURE_TYPES.includes(mark.type) || mark.type === 'angle') return 0;
  const m = measure(mark, scale), kind = unitKind(unit);
  let base;
  if (kind === 'length') base = m.length ?? m.perimeter ?? (m.count || 0);
  else if (kind === 'area' || kind === 'volume') base = m.area ?? m.length ?? (m.count || 0);
  else if (kind === 'count') base = m.count ?? 1;
  else base = m.area ?? m.length ?? m.count ?? 0;
  if (kind === 'length' && /mm/i.test(unit)) base *= 1000;
  const mult = Number.isFinite(+mark.mult) && mark.mult !== '' && mark.mult != null ? +mark.mult : 1;
  return base * mult * (mark.deduct ? -1 : 1);
}

export const fmt = (n, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
