// Small DOM helpers: $, escaping, toast, modal dialogs, API fetch.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.method = init.method || 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, init);
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Not logged in'); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.blob();
}

// Open a modal with given inner HTML. `onMount(card, close)` wires it up.
// Returns a promise resolved by close(value).
export function modal(html, onMount, cls = '') {
  const m = $('#modal'), card = $('#modalCard');
  card.className = 'modal-card ' + cls;
  card.innerHTML = html;
  m.hidden = false;
  return new Promise(resolve => {
    const close = v => { m.hidden = true; card.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    $$('[data-close]', card).forEach(b => b.onclick = () => close(null));
    onMount?.(card, close);
    const first = card.querySelector('input,textarea,select');
    first?.focus(); first?.select?.();
  });
}

export function ask(title, label, value = '', type = 'text') {
  return modal(`<h3>${esc(title)}</h3>
    <form class="form" id="askF"><label>${esc(label)}</label><input type="${type}" step="any" id="askV" value="${esc(value)}"></form>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="askOk">OK</button></div>`,
  (card, close) => {
    const ok = () => close($('#askV', card).value);
    $('#askOk', card).onclick = ok;
    $('#askF', card).onsubmit = e => { e.preventDefault(); ok(); };
  });
}

// Multi-line text (comments). Ctrl+Enter saves.
export function askText(title, value = '') {
  return modal(`<h3>${esc(title)}</h3>
    <textarea id="atV" style="min-height:120px;font-family:inherit;font-size:13px">${esc(value)}</textarea>
    <div class="muted small">Ctrl+Enter to save</div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="atOk">Save</button></div>`,
  (card, close) => {
    const ok = () => close($('#atV', card).value);
    $('#atOk', card).onclick = ok;
    $('#atV', card).onkeydown = e => { if (e.key === 'Enter' && e.ctrlKey) ok(); };
  });
}

export function confirmBox(title, text, okLabel = 'OK') {
  return modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cOk">${esc(okLabel)}</button></div>`,
  (card, close) => { $('#cOk', card).onclick = () => close(true); });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5a5', '#f032e6', '#9a6324',
  '#808000', '#000075', '#e6a800', '#008080', '#800000', '#aa6e28', '#5f9ea0', '#d2691e'];
export const pickColor = i => PALETTE[i % PALETTE.length];
