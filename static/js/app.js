// App shell: projects, drawings & revisions, pages, bookmarks, categories, markups, signatures, menus.
import { S, hooks, dirty, save, pageInfo, bqById, catById, markById, markColor, scaleOf, catHidden, catDescendants, drawingById, markQty, isHeading, bqName } from './state.js';
import { $, $$, esc, uid, api, toast, modal, ask, askText, confirmBox, download, pickColor } from './ui.js';
import { openDrawing, gotoPage, fitPage, zoomAt, renderThumb, renderBitmap, setView, focusMark, viewRevision, shownFileId } from './viewer.js';
import { drawOverlay, qtyText, TYPE_NAME } from './overlay.js';
import { initTools, setTool, setScale, snapshot, deleteSelected, editComment } from './tools.js';
import { initBQ, renderBQ, refreshBQNumbers, ensureSheets } from './bq.js';
import { exportXlsx, exportPdf, exportPng, printPage } from './export.js';
import { fmt } from './geometry.js';

const D = () => S.project.data;

// ---- refresh dispatcher ---------------------------------------------------------------
hooks.refresh = (part = 'all') => {
  drawOverlay();
  if (!S.project) return;
  if (part === 'overlay') return;
  if (part === 'select') { renderMarks(); markSelectedComment(); return; }
  if (part === 'active') { renderStatus(); renderCats(); return; }
  if (part === 'bqnum' || part === 'marks') { refreshBQNumbers(); renderMarks(); renderCats(); renderPageDots(); renderComments(); return; }
  if (part === 'page') { renderStatus(); renderPages(); renderMarks(); return; }
  if (part === 'bqmeta') { renderBQ(); renderMarks(); renderStatus(); return; }
  renderBQ(); renderCats(); renderMarks(); renderDrawings(); renderPages(); renderBookmarks(); renderStatus(); renderSigs(); renderComments();
};

function renderStatus() {
  const info = S.drawing ? pageInfo() : {};
  const sl = $('#scaleLabel');
  sl.textContent = info.scale ? `${info.scaleLabel || 'Scaled'}` : 'Not scaled';
  sl.title = info.scale ? `1 PDF unit = ${(info.scale * 1000).toFixed(3)} mm` : '';
  sl.classList.toggle('warn', !info.scale);
  $('#optLegend').checked = !!info.legend?.show;
  $('#pgLabel').textContent = S.pdf ? `Page ${S.pageNo} / ${S.pdf.numPages}` : '–';
  const b = bqById(S.activeBq), c = catById(S.activeCat);
  $('#active').innerHTML = [b ? `<span class="sw" style="background:${b.color}"></span> ${esc(bqName(b).slice(0, 70))} [${esc(b.unit)}]` : '',
    c ? `📁 ${esc(c.name)}` : ''].filter(Boolean).join(' · ') || 'No BQ item / category selected';
  $('#projName').textContent = S.project?.name || 'No project';
}

// ---- projects ----------------------------------------------------------------------------
async function projectsDialog(force = false) {
  const list = await api('/api/projects');
  const html = `<h3>Projects</h3>
    <div class="row gap"><input type="text" id="npName" placeholder="New project name, e.g. Block A Substructure"><button class="btn primary" id="npGo">Create</button></div>
    <div class="plist">${list.map(p => `<div class="item" data-id="${p.id}"><span class="name">${esc(p.name)}</span>
      <span class="muted small">${new Date(p.updated * 1000).toLocaleString()}</span>
      <span class="acts"><button data-ren title="Rename">✎</button><button data-del title="Delete">🗑</button></span></div>`).join('') || '<p class="muted">No projects yet.</p>'}</div>
    <div class="actions"><button class="btn" id="npImport">📂 Open .takeoff file…</button>${force ? '' : '<button class="btn" data-close>Close</button>'}</div>`;
  const pid = await modal(html, (card, close) => {
    const create = async () => {
      const name = $('#npName', card).value.trim();
      if (!name) return $('#npName', card).focus();
      close((await api('/api/projects', { json: { name } })).id);
    };
    $('#npGo', card).onclick = create;
    $('#npName', card).onkeydown = e => { if (e.key === 'Enter') create(); };
    $('#npImport', card).onclick = () => { close(null); $('#fileProject').click(); };
    $$('.item', card).forEach(it => it.onclick = async e => {
      const id = it.dataset.id;
      if (e.target.closest('[data-del]')) {
        e.stopPropagation();
        if (!confirm(`Delete project "${it.querySelector('.name').textContent}" and all its drawings? This cannot be undone.\n\nTip: save a .takeoff file first as a backup.`)) return;
        await api(`/api/projects/${id}`, { method: 'DELETE' });
        if (S.project?.id === id) { S.project = null; localStorage.removeItem('takeoff.last'); }
        close(null); return projectsDialog(!S.project);
      }
      if (e.target.closest('[data-ren]')) {
        e.stopPropagation();
        const p = await api(`/api/projects/${id}`);
        const nm = prompt('Project name', p.name);
        if (!nm) return;
        await api(`/api/projects/${id}`, { method: 'PUT', json: { name: nm, data: p.data } });
        if (S.project?.id === id) { S.project.name = nm; renderStatus(); }
        close(null); return projectsDialog(force);
      }
      close(id);
    });
  });
  if (pid) openProject(pid);
}

async function openProject(id) {
  try {
    await save();
    const p = await api(`/api/projects/${id}`);
    for (const k of ['drawings', 'categories', 'bq', 'marks', 'bookmarks']) p.data[k] = p.data[k] || [];
    S.project = p;
    S.activeBq = S.activeCat = S.selId = S.highlightBq = S.openBq = S.viewFileId = null;
    S.drawing = null;
    ensureSheets(p.data);
    try { localStorage.setItem('takeoff.last', id); } catch { /* storage blocked */ }
    $('#saveState').textContent = 'Saved ✓';
    const last = (() => { try { return JSON.parse(localStorage.getItem('takeoff.view.' + id)); } catch { return null; } })();
    const dwg = drawingById(last?.dwg) || p.data.drawings[0] || null;
    await openDrawing(dwg, dwg && last?.dwg === dwg.id ? last.page : 1);
    hooks.refresh('all');
  } catch (e) {
    toast('Could not open project: ' + e.message, 4000);
    projectsDialog(true);
  }
}

// remember last drawing/page per project
setInterval(() => {
  if (S.project && S.drawing) try { localStorage.setItem('takeoff.view.' + S.project.id, JSON.stringify({ dwg: S.drawing.id, page: S.pageNo })); } catch { /* ignore */ }
}, 3000);

// ---- drawings ------------------------------------------------------------------------------
function renderDrawings() {
  $('#drawingList').innerHTML = D().drawings.map(d => `<div class="item ${d.id === S.drawing?.id ? 'on' : ''}" data-id="${d.id}" title="${esc(d.name)}">
    <span class="name">📄 ${esc(d.name)}</span><span class="rev" title="Revision">R${d.rev || 1}</span>
    <span class="acts"><button data-act="ren" title="Rename">✎</button><button data-act="rep" title="Replace with new revision (markups kept)">⟳</button>
    <button data-act="align" title="Align markups to new revision">⤧</button><button data-act="revs" title="Revision history">🕘</button><button data-act="del" title="Delete">🗑</button></span></div>`).join('')
    || '<p class="muted small">No drawings yet.</p>';
}

async function uploadPdf(file) {
  const fd = new FormData();
  fd.append('file', file);
  return (await api(`/api/projects/${S.project.id}/files`, { method: 'POST', body: fd })).fileId;
}

async function addDrawings(files) {
  for (const f of files) {
    toast(`Uploading ${f.name}…`, 8000);
    try {
      const fileId = await uploadPdf(f);
      const d = { id: uid(), name: f.name.replace(/\.pdf$/i, ''), fileId, rev: 1, revisions: [{ rev: 1, fileId, name: f.name, date: Date.now() }], pages: {} };
      D().drawings.push(d);
      await openDrawing(d, 1);
      dirty('all');
    } catch (e) { toast(`${f.name}: ${e.message}`, 5000); }
  }
}

let replaceTarget = null;
async function replaceDrawing(d, file) {
  toast('Uploading new revision…', 8000);
  const fileId = await uploadPdf(file);
  snapshot();
  d.rev = (d.rev || 1) + 1;
  d.revisions = d.revisions || [{ rev: 1, fileId: d.fileId, date: Date.now() }];
  d.revisions.push({ rev: d.rev, fileId, name: file.name, date: Date.now() });
  d.fileId = fileId;
  await openDrawing(d, S.drawing?.id === d.id ? S.pageNo : 1, S.drawing?.id === d.id);
  S.compare = true; $('#optCompare').checked = true; renderBitmap(true);
  dirty('all');
  toast(`Revision R${d.rev} loaded – markups kept. Red = previous revision. If markups are shifted, use ⤧ Align.`, 7000);
}

function revisionsDialog(d) {
  const revs = [...(d.revisions || [])].reverse();
  modal(`<h3>Revisions – ${esc(d.name)}</h3>
    <p class="muted small">👁 View shows an older layout under your markups (a banner lets you close it). Make current switches the drawing for good.</p>
    <div class="plist">${revs.map(r => {
      const isCur = r.fileId === d.fileId, isView = S.drawing === d && shownFileId() === r.fileId;
      return `<div class="item ${isView ? 'on' : ''}"><span class="rev">R${r.rev}</span><span class="name" title="${esc(r.name || '')}">${esc(r.name || '')}</span>
      <span class="muted small">${new Date(r.date).toLocaleDateString()}</span>
      ${isCur ? '<span class="pill">current</span>' : ''}${r.xform ? '<span class="pill warn" title="This layout was moved to line up with the markups">aligned</span>' : ''}
      ${isView ? '<span class="pill">showing</span>' : `<button class="btn small" data-view="${r.fileId}">👁 View</button>`}
      ${isCur ? '' : `<button class="btn small" data-use="${r.fileId}">Make current</button>`}
      ${r.xform ? `<button class="btn small" data-reset="${r.fileId}" title="Undo the drawing alignment">Reset align</button>` : ''}
      <a class="btn small icon" href="/api/files/${r.fileId}" target="_blank" title="Open PDF in new tab">↗</a></div>`;
    }).join('')}</div>
    <div class="actions"><button class="btn" data-close>Close</button></div>`, (card, close) => {
    const rev = id => d.revisions.find(x => x.fileId === id);
    $$('[data-view]', card).forEach(b => b.onclick = async () => {
      close();
      if (S.drawing !== d) await openDrawing(d, 1);
      await viewRevision(b.dataset.view);
    });
    $$('[data-use]', card).forEach(b => b.onclick = async () => {
      snapshot();
      const r = rev(b.dataset.use);
      // move the chosen revision to the end so it becomes current; "compare" shows the one before it
      d.revisions = d.revisions.filter(x => x !== r).concat(r);
      d.fileId = r.fileId; d.rev = r.rev;
      S.viewFileId = null;
      close();
      await openDrawing(d, S.pageNo, true);
      dirty('all');
    });
    $$('[data-reset]', card).forEach(b => b.onclick = () => {
      snapshot();
      delete rev(b.dataset.reset).xform;
      close();
      renderBitmap(true);
      dirty('all');
      toast('Drawing alignment reset');
    });
  });
}

function onDrawingClick(e) {
  const it = e.target.closest('.item[data-id]');
  if (!it) return;
  const d = drawingById(it.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'ren') return ask('Rename drawing', 'Name', d.name).then(n => { if (n) { d.name = n; dirty('all'); } });
  if (act === 'rep') { replaceTarget = d; return $('#fileReplace').click(); }
  if (act === 'revs') return revisionsDialog(d);
  if (act === 'align') {
    const go = () => {
      if (!S.oldPdf) return toast('This drawing has no previous revision to align from');
      S.compare = true; $('#optCompare').checked = true; renderBitmap(true);
      setTool('align');
    };
    return d.id === S.drawing?.id ? go() : openDrawing(d, 1).then(go);
  }
  if (act === 'del') {
    const n = D().marks.filter(m => m.dwg === d.id).length;
    return confirmBox('Delete drawing', `Delete "${d.name}"${n ? ` and its ${n} markups` : ''}? (Undo with Ctrl+Z)`, 'Delete').then(ok => {
      if (!ok) return;
      snapshot();
      D().drawings = D().drawings.filter(x => x !== d);
      D().marks = D().marks.filter(m => m.dwg !== d.id);
      D().bookmarks = D().bookmarks.filter(b => b.dwg !== d.id);
      if (S.drawing === d) openDrawing(D().drawings[0] || null);
      dirty('all');
    });
  }
  if (d !== S.drawing) openDrawing(d, 1);
}

// ---- pages (thumbnails) ----------------------------------------------------------------------
let thumbObs, thumbKey = '';
function renderPages() {
  const el = $('#pageList');
  if (!S.pdf) { el.innerHTML = ''; thumbKey = ''; return; }
  const key = S.drawing.id + ':' + S.drawing.fileId;
  if (key !== thumbKey) {
    thumbKey = key;
    thumbObs?.disconnect();
    el.innerHTML = Array.from({ length: S.pdf.numPages }, (_, i) => `<div class="thumb" data-p="${i + 1}"><canvas></canvas>${i + 1}<span class="dot" hidden></span></div>`).join('');
    const pdf = S.pdf;
    thumbObs = new IntersectionObserver(ents => ents.forEach(en => {
      if (!en.isIntersecting) return;
      thumbObs.unobserve(en.target);
      renderThumb(pdf, +en.target.dataset.p, en.target.querySelector('canvas')).catch(() => {});
    }), { root: el.closest('section') });
    $$('.thumb', el).forEach(t => thumbObs.observe(t));
  }
  $$('.thumb', el).forEach(t => t.classList.toggle('on', +t.dataset.p === S.pageNo));
  renderPageDots();
}
function renderPageDots() {
  if (!S.drawing) return;
  const used = new Set(D().marks.filter(m => m.dwg === S.drawing.id).map(m => m.page));
  $$('#pageList .thumb').forEach(t => { t.querySelector('.dot').hidden = !used.has(+t.dataset.p); });
}

// ---- bookmarks ---------------------------------------------------------------------------------
function renderBookmarks() {
  $('#bookmarkList').innerHTML = D().bookmarks.map(b => {
    const d = drawingById(b.dwg);
    return `<div class="item" data-id="${b.id}"><span class="name">🔖 ${esc(b.name)}<br><span class="muted small">${esc(d?.name || '?')} · p${b.page}</span></span>
      <span class="acts"><button data-act="ren">✎</button><button data-act="del">🗑</button></span></div>`;
  }).join('') || '<p class="muted small">No bookmarks yet.</p>';
  renderOutline();
}

let outlineFor = null;
async function renderOutline() {
  if (!S.pdf || outlineFor === S.pdf) return;
  outlineFor = S.pdf;
  const pdf = S.pdf, el = $('#outlineList');
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) { el.textContent = 'This PDF has no bookmarks.'; return; }
  const walk = (items, lvl) => items.map(o => `<div class="item" style="padding-left:${8 + lvl * 12}px" data-dest='${esc(JSON.stringify(o.dest ?? null))}'><span class="name">${esc(o.title)}</span></div>` + walk(o.items || [], lvl + 1)).join('');
  el.innerHTML = walk(outline, 0);
  el.onclick = async e => {
    const it = e.target.closest('[data-dest]');
    if (!it) return;
    let dest = JSON.parse(it.dataset.dest);
    if (typeof dest === 'string') dest = await pdf.getDestination(dest);
    if (!Array.isArray(dest)) return;
    const idx = typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : dest[0];
    gotoPage(idx + 1);
  };
}

async function onBookmarkClick(e) {
  const it = e.target.closest('.item[data-id]');
  if (!it) return;
  const b = D().bookmarks.find(x => x.id === it.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'del') { snapshot(); D().bookmarks = D().bookmarks.filter(x => x !== b); return dirty('all'); }
  if (act === 'ren') { const n = await ask('Rename bookmark', 'Name', b.name); if (n) { b.name = n; dirty('all'); } return; }
  const d = drawingById(b.dwg);
  if (!d) return;
  if (d !== S.drawing) await openDrawing(d, b.page);
  else await gotoPage(b.page);
  setView(b.zoom, b.sx, b.sy);
}

// ---- comments (like Foxit's comment list) --------------------------------------------------------
function renderComments() {
  const el = $('#commentList');
  if (!S.project) { el.innerHTML = ''; return; }
  const q = $('#cmtSearch').value.trim().toLowerCase(), all = $('#cmtAll').checked;
  const list = D().marks.filter(m => m.type === 'text' && (all || m.dwg === S.drawing?.id) && (!q || (m.text || '').toLowerCase().includes(q)));
  // group by drawing + page (in drawing order), newest first inside a group
  const order = new Map(D().drawings.map((d, i) => [d.id, i]));
  list.sort((a, b) => (order.get(a.dwg) - order.get(b.dwg)) || (a.page - b.page) || ((b.created || 0) - (a.created || 0)));
  let html = '', grp = '';
  for (const m of list) {
    const d = drawingById(m.dwg), g = `${d?.name || '?'} – Page ${m.page}`;
    if (g !== grp) { html += `<div class="cgroup">${esc(g)}</div>`; grp = g; }
    html += `<div class="cmt ${m.id === S.selId ? 'on' : ''}" data-id="${m.id}" title="Click to show · double-click to edit">
      <div class="txt">${esc(m.text || '')}</div>
      <div class="meta"><span>${m.created ? new Date(m.created).toLocaleString() : ''}</span><span class="grow"></span>
        <button data-act="edit" title="Edit">✎</button><button data-act="del" title="Delete">🗑</button></div></div>`;
  }
  el.innerHTML = html || '<p class="muted small">No comments. Use 💬 (T) and click on the drawing to add one.</p>';
}

function markSelectedComment() {
  $$('#commentList .cmt').forEach(c => c.classList.toggle('on', c.dataset.id === S.selId));
}

function initComments() {
  const el = $('#commentList');
  el.addEventListener('click', async e => {
    const c = e.target.closest('.cmt');
    if (!c) return;
    const m = markById(c.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') { S.selId = m.id; return deleteSelected(); }
    await focusMark(m);
    if (act === 'edit') editComment(m);
  });
  el.addEventListener('dblclick', e => { const c = e.target.closest('.cmt'); if (c) editComment(markById(c.dataset.id)); });
  $('#cmtSearch').oninput = renderComments;
  $('#cmtAll').onchange = renderComments;
  $('#cmtAdd').onclick = () => { setTool('text'); toast('Click on the drawing where the comment should go'); };
}

// ---- categories -----------------------------------------------------------------------------
function catSummary(id) {
  const ids = catDescendants(id), q = { m: 0, 'm²': 0, nr: 0 };
  for (const m of D().marks) {
    if (!ids.has(m.cat)) continue;
    const p = markQty(m);
    if (p.u in q) q[p.u] += p.u === 'nr' ? p.q : p.q * (+m.mult || 1) * (m.deduct ? -1 : 1);
  }
  return [q.m ? fmt(q.m) + ' m' : '', q['m²'] ? fmt(q['m²']) + ' m²' : '', q.nr ? q.nr + ' nr' : ''].filter(Boolean).join(' · ');
}

function renderCats() {
  const cats = D().categories;
  const walk = (parent, lvl) => cats.filter(c => (c.parent || null) === parent).map(c => `
    <div class="cat ${c.id === S.activeCat ? 'on' : ''}" data-id="${c.id}" style="padding-left:${6 + lvl * 16}px">
      <input type="color" value="${c.color}" data-f="color"><input type="text" value="${esc(c.name)}" data-f="name">
      <span class="q">${catSummary(c.id)}</span>
      <button data-act="eye" title="Show / hide">${c.hidden ? '🚫' : '👁'}</button><button data-act="del" title="Delete">🗑</button>
    </div>` + walk(c.id, lvl + 1)).join('');
  $('#catList').innerHTML = walk(null, 0) || '<p class="muted small">Create categories (e.g. Substructure → Ground beam) to group your measurements. Click one to make it active: new markups go into it.</p>';
}

function addCat(parent) {
  if (!S.project) return toast('Open a project first');
  snapshot();
  const c = { id: uid(), name: parent ? 'New sub-category' : 'New category', color: pickColor(D().categories.length + 3), parent: parent || null, hidden: false };
  D().categories.push(c);
  S.activeCat = c.id;
  dirty('all');
  setTimeout(() => { const i = $(`.cat[data-id="${c.id}"] [data-f=name]`); i?.focus(); i?.select(); });
}

function initCats() {
  const el = $('#catList');
  el.addEventListener('click', e => {
    const row = e.target.closest('.cat');
    if (!row) return;
    const c = catById(row.dataset.id), act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'eye') { c.hidden = !c.hidden; return dirty('all'); }
    if (act === 'del') {
      const ids = catDescendants(c.id);
      snapshot();
      D().categories = D().categories.filter(x => !ids.has(x.id));
      D().marks.forEach(m => { if (ids.has(m.cat)) m.cat = null; });
      if (ids.has(S.activeCat)) S.activeCat = null;
      return dirty('all');
    }
    if (e.target.tagName === 'INPUT') { if (S.activeCat !== c.id) { S.activeCat = c.id; $$('.cat', el).forEach(r => r.classList.toggle('on', r === row)); renderStatus(); } return; }
    S.activeCat = S.activeCat === c.id ? null : c.id;
    dirty('active');
  });
  el.addEventListener('change', e => {
    const row = e.target.closest('.cat'), f = e.target.dataset.f;
    if (!row || !f) return;
    snapshot();
    catById(row.dataset.id)[f] = e.target.value;
    dirty('all');
  });
  $('#catAdd').onclick = () => addCat(null);
  $('#catAddSub').onclick = () => S.activeCat ? addCat(S.activeCat) : toast('Select a parent category first');
  $('#catNone').onclick = () => { S.activeCat = null; dirty('active'); };
}

// ---- markups list + properties ----------------------------------------------------------------
function opts(list, sel, label) {
  return `<option value="">— none —</option>` + list.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
}

function bqOptions(sel) {
  return '<option value="">— none —</option>' + D().sheets.map(sh => `<optgroup label="${esc(sh.name)}">` +
    D().bq.filter(b => b.sheet === sh.id && !isHeading(b)).map(b =>
      `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(bqName(b).slice(0, 80))} [${esc(b.unit)}]</option>`).join('') + '</optgroup>').join('');
}

function renderMarks() {
  const m = markById(S.selId), P = $('#markProps');
  if (m) {
    const isQty = ['length', 'area', 'rect', 'count'].includes(m.type);
    P.innerHTML = `<div class="ttl"><span>${TYPE_NAME[m.type]} · ${esc(qtyText(m))}</span><button class="btn small danger" data-act="del">Delete</button></div>
      <label>Label</label><input data-p="label" value="${esc(m.label || '')}" placeholder="e.g. GB1 grid A-C">
      ${m.type === 'text' ? `<label>Text</label><div class="row gap"><span class="grow small" style="white-space:pre-wrap">${esc(m.text || '')}</span><button class="btn small" data-act="edittext">✎ Edit</button></div>
        <label>Font size</label><input type="number" data-p="fs" value="${m.fs || 10}">` : ''}
      ${isQty ? `<label>BQ item</label><select data-p="bq">${bqOptions(m.bq)}</select>` : ''}
      <label>Category</label><select data-p="cat">${opts(D().categories, m.cat, c => c.name)}</select>
      ${isQty && m.type !== 'count' ? `<label title="e.g. wall height for m², thickness for m³, no. of floors">Multiplier</label><input type="number" step="any" data-p="mult" value="${m.mult ?? 1}">
      <label>Deduction</label><label class="chk"><input type="checkbox" data-p="deduct" ${m.deduct ? 'checked' : ''}> Deduct (opening / void)</label>` : ''}
      ${isQty && m.type === 'count' ? `<label>Multiplier</label><input type="number" step="any" data-p="mult" value="${m.mult ?? 1}">` : ''}
      <label>Colour</label><div class="row gap"><input type="color" data-p="color" value="${markColor(m)}" style="width:40px"><button class="btn small" data-act="nocolor">Use item colour</button></div>`;
  } else P.innerHTML = '';

  const all = $('#marksAllPages').checked;
  const list = D().marks.filter(x => x.dwg === S.drawing?.id && (all || x.page === S.pageNo));
  $('#marksCount').textContent = `${list.length} markups`;
  $('#markTable').innerHTML = `<thead><tr><th></th><th>Type</th><th>Item / label</th><th class="num">Qty</th><th>Pg</th></tr></thead><tbody>` +
    list.map(x => {
      const b = bqById(x.bq), c = catById(x.cat);
      return `<tr data-id="${x.id}" class="${x.id === S.selId ? 'on' : ''}" style="${catHidden(x.cat) ? 'opacity:.4' : ''}">
        <td><span class="sw" style="background:${markColor(x)}"></span></td><td>${TYPE_NAME[x.type]}</td>
        <td>${esc([b ? bqName(b).slice(0, 50) : '', x.label, x.type === 'text' ? x.text : '', c ? '📁' + c.name : ''].filter(Boolean).join(' · '))}</td>
        <td class="num">${['text', 'signature', 'highlight'].includes(x.type) ? '' : esc(qtyText(x))}</td><td>${x.page}</td></tr>`;
    }).join('') + '</tbody>';
}

function initMarks() {
  const P = $('#markProps');
  P.addEventListener('change', e => {
    const m = markById(S.selId), k = e.target.dataset.p;
    if (!m || !k) return;
    snapshot();
    m[k] = e.target.type === 'checkbox' ? e.target.checked : (k === 'mult' || k === 'fs') ? (e.target.value === '' ? 1 : +e.target.value) : (e.target.value || (k === 'bq' || k === 'cat' ? null : ''));
    dirty('marks');
  });
  P.addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act, m = markById(S.selId);
    if (a === 'del') deleteSelected();
    if (a === 'nocolor' && m) { snapshot(); delete m.color; dirty('marks'); }
    if (a === 'edittext' && m) editComment(m);
  });
  $('#markTable').addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const m = markById(tr.dataset.id);
    if (m.page !== S.pageNo) await gotoPage(m.page, true);
    S.selId = m.id;
    setTool('select');
    dirty('select');
  });
  $('#marksAllPages').onchange = renderMarks;
}

// ---- signatures --------------------------------------------------------------------------------
async function loadSigs() { S.signatures = await api('/api/signatures'); renderSigs(); }
const saveSigs = () => api('/api/signatures', { method: 'PUT', json: S.signatures });

function renderSigs() {
  $('#sigList').innerHTML = S.signatures.map(s => `<div class="sig ${s.id === S.activeSig ? 'on' : ''}" data-id="${s.id}">
    <img src="${s.png}" alt=""><span>${esc(s.name)}</span><button class="btn small ghost" data-del title="Delete">🗑</button></div>`).join('')
    || '<p class="muted small">No signatures saved.</p>';
}

function addSig(png, w, h, name) {
  const s = { id: uid(), name, png, ratio: w / h };
  S.signatures.push(s);
  S.activeSig = s.id;
  saveSigs(); renderSigs();
  setTool('signature');
}

function trimCanvas(cv) {
  const ctx = cv.getContext('2d'), { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 <= x0) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 8; out.height = y1 - y0 + 8;
  out.getContext('2d').drawImage(cv, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function sigPad() {
  modal(`<h3>Draw signature</h3>
    <canvas id="sigPad" width="560" height="200"></canvas>
    <div class="row gap"><label>Name</label><input type="text" id="sigName" value="My signature" style="flex:1">
      <label>Colour</label><select id="sigCol" style="width:90px"><option value="#0b2a8a">Blue</option><option value="#111">Black</option></select></div>
    <div class="actions"><button class="btn" id="sigClr">Clear</button><button class="btn" data-close>Cancel</button><button class="btn primary" id="sigOk">Save</button></div>`,
  (card, close) => {
    const cv = $('#sigPad', card), ctx = cv.getContext('2d');
    let drawing = false, last;
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.onpointerdown = e => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = e => {
      if (!drawing) return;
      const p = pos(e);
      ctx.strokeStyle = $('#sigCol', card).value; ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
      last = p;
    };
    cv.onpointerup = () => { drawing = false; };
    $('#sigClr', card).onclick = () => ctx.clearRect(0, 0, cv.width, cv.height);
    $('#sigOk', card).onclick = () => {
      const t = trimCanvas(cv);
      if (!t) return toast('Draw your signature first');
      addSig(t.toDataURL('image/png'), t.width, t.height, $('#sigName', card).value || 'Signature');
      close();
    };
  });
}

function initSigs() {
  $('#sigNew').onclick = sigPad;
  $('#sigUpload').onclick = () => $('#fileSig').click();
  $('#fileSig').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      // re-encode as PNG (white made transparent) so it overlays cleanly and embeds in PDF
      const cv = document.createElement('canvas'), sc = Math.min(1, 800 / img.width);
      cv.width = img.width * sc; cv.height = img.height * sc;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225) d[i + 3] = 0;
      ctx.putImageData(id, 0, 0);
      const t = trimCanvas(cv) || cv;
      addSig(t.toDataURL('image/png'), t.width, t.height, f.name.replace(/\.\w+$/, ''));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  $('#sigList').addEventListener('click', e => {
    const it = e.target.closest('.sig');
    if (!it) return;
    if (e.target.closest('[data-del]')) {
      S.signatures = S.signatures.filter(s => s.id !== it.dataset.id);
      if (S.activeSig === it.dataset.id) S.activeSig = null;
      saveSigs(); return renderSigs();
    }
    S.activeSig = it.dataset.id;
    renderSigs();
    setTool('signature');
  });
}

// ---- file menu ---------------------------------------------------------------------------------
const needProject = fn => () => S.project ? fn() : toast('Open a project first');
const COMMANDS = {
  saveFile: needProject(async () => {
    await save();
    toast('Preparing project file…', 8000);
    download(await api(`/api/projects/${S.project.id}/export`), `${S.project.name.replace(/[\\/:*?"<>|]/g, '_')}.takeoff`);
    toast('Saved. Keep the .takeoff file in OneDrive as your backup.');
  }),
  openFile: () => $('#fileProject').click(),
  exportXlsx: needProject(exportXlsx),
  exportPdf: needProject(() => exportPdf().catch(e => toast('PDF export failed: ' + e.message, 5000))),
  exportPng: needProject(exportPng),
  print: needProject(printPage),
  changePw: async () => {
    const res = await modal(`<h3>Change password</h3><div class="form"><label>Current</label><input type="password" id="pwO"><label>New</label><input type="password" id="pwN"></div>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pwOk">Change</button></div>`,
    (card, close) => { $('#pwOk', card).onclick = () => close({ old: $('#pwO', card).value, new: $('#pwN', card).value }); });
    if (!res) return;
    try { await api('/api/auth/change', { json: res }); toast('Password changed'); } catch (e) { toast(e.message); }
  },
  logout: async () => { await save(); await api('/api/auth/logout', { json: {} }); location.href = '/login.html'; },
};

// ---- wiring ------------------------------------------------------------------------------------
function initShell() {
  $$('[data-cmd]').forEach(b => b.onclick = () => { document.activeElement?.blur(); COMMANDS[b.dataset.cmd](); });
  $('#btnProjects').onclick = () => projectsDialog(false);
  $('#fileProject').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    toast('Opening project file…', 8000);
    try { const r = await api('/api/import', { method: 'POST', body: fd }); await loadSigs(); openProject(r.id); toast('Project imported'); }
    catch (err) { toast(err.message, 5000); }
  };

  $$('[data-ltab]').forEach(b => b.onclick = () => {
    $$('[data-ltab]').forEach(x => x.classList.toggle('on', x === b));
    $$('[data-lpanel]').forEach(p => p.hidden = p.dataset.lpanel !== b.dataset.ltab);
  });
  $$('[data-rtab]').forEach(b => b.onclick = () => {
    $$('[data-rtab]').forEach(x => x.classList.toggle('on', x === b));
    $$('[data-rpanel]').forEach(p => p.hidden = p.dataset.rpanel !== b.dataset.rtab);
  });

  $('#btnAddDrawing').onclick = needProject(() => $('#fileDrawing').click());
  $('#fileDrawing').onchange = e => { addDrawings([...e.target.files]); e.target.value = ''; };
  $('#fileReplace').onchange = e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f && replaceTarget) replaceDrawing(replaceTarget, f).catch(err => toast(err.message, 5000));
  };
  $('#drawingList').onclick = onDrawingClick;
  $('#pageList').onclick = e => { const t = e.target.closest('.thumb'); if (t) gotoPage(+t.dataset.p); };
  $('#bookmarkList').onclick = onBookmarkClick;
  $('#btnAddBookmark').onclick = async () => {
    if (!S.drawing) return toast('Open a drawing first');
    const name = await ask('Add bookmark', 'Name', `${S.drawing.name} p${S.pageNo}`);
    if (!name) return;
    D().bookmarks.push({ id: uid(), name, dwg: S.drawing.id, page: S.pageNo, zoom: S.zoom, sx: $('#stage').scrollLeft, sy: $('#stage').scrollTop });
    dirty('all');
  };

  $('#pgPrev').onclick = () => gotoPage(S.pageNo - 1);
  $('#pgNext').onclick = () => gotoPage(S.pageNo + 1);
  $('#zIn').onclick = () => zoomAt(S.zoom * 1.25);
  $('#zOut').onclick = () => zoomAt(S.zoom / 1.25);
  $('#zFit').onclick = fitPage;

  $('#scalePreset').onchange = e => {
    const v = e.target.value; e.target.value = '';
    if (!v || !S.drawing) return;
    const ratio = +v.split(':')[1];
    snapshot();
    // 1 PDF unit = 1/72 inch on paper
    setScale(0.0254 / 72 * ratio, v + ' (paper)', confirm(`Apply ${v} to ALL pages of this drawing?\n\nOK = all pages, Cancel = this page only`));
  };
  $('#optValues').onchange = e => { S.showValues = e.target.checked; drawOverlay(); };
  $('#optLegend').onchange = e => {
    if (!S.drawing) return;
    const info = pageInfo();
    info.legend = { ...(info.legend || {}), show: e.target.checked };
    dirty('overlay');
  };
  $('#optCompare').onchange = e => { S.compare = e.target.checked; renderBitmap(true); };
  window.addEventListener('resize', () => drawOverlay());

  // collapsible side panels (remembered)
  const side = (id, show) => {
    $('#' + id).classList.toggle('collapsed', !show);
    try { localStorage.setItem('takeoff.' + id, show ? '1' : '0'); } catch { /* ignore */ }
  };
  for (const id of ['left', 'right']) { try { if (localStorage.getItem('takeoff.' + id) === '0') side(id, false); } catch { /* ignore */ } }
  $('#tglLeft').onclick = () => side('left', $('#left').classList.contains('collapsed'));
  $('#tglRight').onclick = () => side('right', $('#right').classList.contains('collapsed'));
  window.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !$('#modal').hidden || e.ctrlKey || e.altKey) return;
    if (e.key === '[') $('#tglLeft').click();
    if (e.key === ']') $('#tglRight').click();
  });
  $('#revBannerClose').onclick = () => viewRevision(null);
}

async function boot() {
  initShell(); initTools(); initBQ(); initCats(); initMarks(); initSigs(); initComments();
  loadSigs().catch(() => {});
  let last = null;
  try { last = localStorage.getItem('takeoff.last'); } catch { /* ignore */ }
  const list = await api('/api/projects');
  if (last && list.some(p => p.id === last)) openProject(last);
  else projectsDialog(true);
}
boot();
