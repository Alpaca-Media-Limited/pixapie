// Pixapie front end
const $ = (sel) => document.querySelector(sel);

const CONTENT_TYPES = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  form: 'application/x-www-form-urlencoded',
};

let saved = [];
let currentId = null;
let lastBody = '';

const els = {
  name: $('#reqName'),
  method: $('#method'),
  url: $('#url'),
  send: $('#sendBtn'),
  save: $('#saveBtn'),
  saveNew: $('#saveNewBtn'),
  headerRows: $('#headerRows'),
  headerCount: $('#headerCount'),
  bodyType: $('#bodyType'),
  bodyText: $('#bodyText'),
  formWrap: $('#formWrap'),
  formRows: $('#formRows'),
  noBody: $('#noBody'),
  ctHint: $('#ctHint'),
  formatBtn: $('#formatBtn'),
  status: $('#status'),
  time: $('#time'),
  size: $('#size'),
  pretty: $('#pretty'),
  raw: $('#raw'),
  resHeaders: $('#resHeaders'),
  resHeaderCount: $('#resHeaderCount'),
  savedList: $('#savedList'),
  filter: $('#filter'),
  toast: $('#toast'),
};

// ---------- helpers ----------

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

let toastTimer;
function toast(msg, bad = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('bad', bad);
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 1800);
}

// ---------- tabs ----------

document.querySelectorAll('.tabs').forEach((tabs) => {
  const section = tabs.closest('section');
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    section.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
  });
});

// ---------- key/value rows ----------

function addKvRow(container, row = { key: '', value: '', on: true }, { keyList, valueList } = {}) {
  const div = el('div', 'kv-row');
  div.innerHTML = `
    <input type="checkbox" ${row.on ? 'checked' : ''} aria-label="Enabled">
    <input class="input k" placeholder="key" spellcheck="false" ${keyList ? `list="${keyList}"` : ''}>
    <input class="input v" placeholder="value" spellcheck="false" ${valueList ? `list="${valueList}"` : ''}>
    <button class="icon-btn" title="Remove">X</button>`;
  div.querySelector('.k').value = row.key;
  div.querySelector('.v').value = row.value;
  div.classList.toggle('off', !row.on);
  div.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
    div.classList.toggle('off', !e.target.checked);
    updateHeaderCount();
  });
  div.querySelector('.icon-btn').addEventListener('click', () => {
    div.remove();
    updateHeaderCount();
  });
  div.querySelector('.k').addEventListener('input', updateHeaderCount);
  container.appendChild(div);
  return div;
}

function readKv(container) {
  return [...container.querySelectorAll('.kv-row')].map((r) => ({
    key: r.querySelector('.k').value,
    value: r.querySelector('.v').value,
    on: r.querySelector('input[type=checkbox]').checked,
  }));
}

function setKv(container, rows, opts) {
  container.innerHTML = '';
  (rows.length ? rows : [{ key: '', value: '', on: true }]).forEach((r) => addKvRow(container, r, opts));
}

const HEADER_OPTS = { keyList: 'headerKeys', valueList: 'contentTypes' };

function updateHeaderCount() {
  const n = readKv(els.headerRows).filter((h) => h.on && h.key.trim()).length;
  els.headerCount.textContent = n ? `(${n})` : '';
  updateBodyUi();
}

$('#addHeader').addEventListener('click', () => addKvRow(els.headerRows, undefined, HEADER_OPTS).querySelector('.k').focus());
$('#addField').addEventListener('click', () => addKvRow(els.formRows).querySelector('.k').focus());

// ---------- body ----------

function hasContentTypeHeader() {
  return readKv(els.headerRows).some((h) => h.on && h.key.trim().toLowerCase() === 'content-type');
}

function updateBodyUi() {
  const type = els.bodyType.value;
  els.bodyText.hidden = type === 'none' || type === 'form';
  els.formWrap.hidden = type !== 'form';
  els.noBody.hidden = type !== 'none';
  els.formatBtn.hidden = type !== 'json';
  els.ctHint.textContent = type === 'none' ? '' : hasContentTypeHeader() ? 'Content-Type: set in headers' : `Content-Type: ${CONTENT_TYPES[type]} (auto)`;
}

els.bodyType.addEventListener('change', updateBodyUi);

els.formatBtn.addEventListener('click', () => {
  try {
    els.bodyText.value = JSON.stringify(JSON.parse(els.bodyText.value), null, 2);
  } catch (e) {
    toast('INVALID JSON', true);
  }
});

// Tab key indents instead of leaving the textarea
els.bodyText.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const { selectionStart: s, selectionEnd: end, value } = els.bodyText;
  els.bodyText.value = value.slice(0, s) + '  ' + value.slice(end);
  els.bodyText.selectionStart = els.bodyText.selectionEnd = s + 2;
});

// ---------- method colour ----------

function paintMethod() {
  els.method.className = `input method m-${els.method.value}`;
}
els.method.addEventListener('change', paintMethod);

// ---------- request state ----------

function collect() {
  return {
    id: currentId,
    name: els.name.value.trim() || 'Untitled request',
    method: els.method.value,
    url: els.url.value.trim(),
    headers: readKv(els.headerRows),
    bodyType: els.bodyType.value,
    body: els.bodyText.value,
    form: readKv(els.formRows),
  };
}

function load(req) {
  currentId = req.id || null;
  els.name.value = req.name || '';
  els.method.value = req.method || 'GET';
  els.url.value = req.url || '';
  setKv(els.headerRows, req.headers || [], HEADER_OPTS);
  els.bodyType.value = req.bodyType || 'none';
  els.bodyText.value = req.body || '';
  setKv(els.formRows, req.form || []);
  paintMethod();
  updateHeaderCount();
  renderSaved();
}

// ---------- send ----------

async function send() {
  const req = collect();
  if (!req.url) {
    els.url.focus();
    return toast('ENTER A URL', true);
  }

  const url = /^https?:\/\//i.test(req.url) ? req.url : `http://${req.url}`;
  const headers = {};
  req.headers.filter((h) => h.on && h.key.trim()).forEach((h) => (headers[h.key.trim()] = h.value));

  let body;
  if (req.bodyType === 'form') {
    body = new URLSearchParams(req.form.filter((f) => f.on && f.key.trim()).map((f) => [f.key.trim(), f.value])).toString();
  } else if (req.bodyType !== 'none') {
    body = req.body;
  }
  if (body !== undefined && !hasContentTypeHeader()) headers['Content-Type'] = CONTENT_TYPES[req.bodyType];

  els.send.disabled = true;
  els.send.textContent = '...';
  els.pretty.innerHTML = '<div class="empty">SENDING<span class="blink">...</span></div>';

  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: req.method, url, headers, body }),
    });
    showResponse(await res.json());
  } catch (err) {
    showResponse({ ok: false, error: 'Local server not reachable. Is it running?' });
  } finally {
    els.send.disabled = false;
    els.send.textContent = 'SEND';
  }
}

// ---------- response ----------

function showResponse(r) {
  els.status.hidden = false;
  els.time.innerHTML = r.time != null ? `TIME <b>${r.time} ms</b>` : '';

  if (!r.ok) {
    els.status.className = 'badge err';
    els.status.textContent = 'ERROR';
    els.size.innerHTML = '';
    els.pretty.innerHTML = `<div class="empty err-msg">REQUEST FAILED<br><br>${esc(r.error)}</div>`;
    els.raw.textContent = r.error;
    els.resHeaders.innerHTML = '';
    els.resHeaderCount.textContent = '';
    lastBody = '';
    return;
  }

  els.status.className = `badge s${String(r.status)[0]}`;
  els.status.textContent = `${r.status} ${r.statusText}`.trim();
  els.size.innerHTML = `SIZE <b>${formatSize(r.size)}</b>`;
  lastBody = r.body;

  els.resHeaders.innerHTML = r.headers.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  els.resHeaderCount.textContent = `(${r.headers.length})`;

  let parsed;
  let isJson = false;
  try {
    parsed = JSON.parse(r.body);
    isJson = true;
  } catch {}

  els.raw.textContent = isJson ? JSON.stringify(parsed, null, 2) : r.body;
  els.pretty.innerHTML = '';
  if (isJson) {
    els.pretty.appendChild(jsonNode(null, parsed, true));
  } else if (r.body) {
    els.pretty.appendChild(el('pre', 'code-block')).textContent = r.body;
  } else {
    els.pretty.innerHTML = '<div class="empty">EMPTY RESPONSE BODY</div>';
  }
}

function jsonNode(key, value, last) {
  const comma = last ? '' : ',';
  const keyHtml = key !== null ? `<span class="j-key">${esc(JSON.stringify(key))}</span>: ` : '';

  if (value === null || typeof value !== 'object') {
    let cls = 'j-null';
    if (typeof value === 'string') cls = 'j-str';
    else if (typeof value === 'number') cls = 'j-num';
    else if (typeof value === 'boolean') cls = 'j-bool';
    return el('div', 'j-line j-leaf', `${keyHtml}<span class="${cls}">${esc(JSON.stringify(value))}</span>${comma}`);
  }

  const isArr = Array.isArray(value);
  const entries = isArr ? value.map((v, i) => [null, v]) : Object.entries(value);
  const [open, close] = isArr ? ['[', ']'] : ['{', '}'];

  if (!entries.length) {
    return el('div', 'j-line j-leaf', `${keyHtml}<span class="j-brace">${open}${close}</span>${comma}`);
  }

  const node = el('div', 'j-node');
  const summary = `${entries.length} ${isArr ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}`;
  const head = el('div', 'j-line', `<span class="j-tog"></span>${keyHtml}<span class="j-brace">${open}</span><span class="j-sum"> ${summary} <span class="j-brace">${close}</span>${comma}</span>`);
  head.addEventListener('click', () => node.classList.toggle('collapsed'));

  const kids = el('div', 'j-kids');
  entries.forEach(([k, v], i) => kids.appendChild(jsonNode(k, v, i === entries.length - 1)));

  node.append(head, kids, el('div', 'j-line j-close', `<span class="j-brace">${close}</span>${comma}`));
  return node;
}

$('#expandAll').addEventListener('click', () => {
  els.pretty.querySelectorAll('.j-node').forEach((n) => n.classList.remove('collapsed'));
});

$('#collapseAll').addEventListener('click', () => {
  // Keep the root open so the top-level keys stay visible
  els.pretty.querySelectorAll('.j-node .j-node').forEach((n) => n.classList.add('collapsed'));
});

$('#copyBtn').addEventListener('click', async () => {
  if (!lastBody) return toast('NOTHING TO COPY', true);
  try {
    await navigator.clipboard.writeText(lastBody);
    toast('COPIED!');
  } catch {
    toast('COPY FAILED', true);
  }
});

// ---------- saved requests ----------

async function loadSaved() {
  try {
    saved = await (await fetch('/api/saved')).json();
  } catch {
    saved = [];
  }
  renderSaved();
}

async function persist() {
  await fetch('/api/saved', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(saved),
  });
}

// A loaded saved request gets UPDATE + SAVE NEW; a fresh one just gets SAVE
function updateSaveButtons() {
  const loaded = saved.some((s) => s.id === currentId);
  els.save.textContent = loaded ? 'UPDATE' : 'SAVE';
  els.save.title = loaded ? 'Overwrite this saved request (Ctrl+S)' : 'Ctrl+S';
  els.saveNew.hidden = !loaded;
}

function renderSaved() {
  updateSaveButtons();
  const q = els.filter.value.trim().toLowerCase();
  const list = saved.filter((r) => !q || `${r.name} ${r.url} ${r.method}`.toLowerCase().includes(q));
  els.savedList.innerHTML = '';

  if (!list.length) {
    els.savedList.appendChild(el('li', 'saved-empty', saved.length ? 'No matches.' : 'Nothing saved yet. Hit SAVE.'));
    return;
  }

  list.forEach((r) => {
    const li = el('li', `saved-item${r.id === currentId ? ' active' : ''}`);
    li.innerHTML = `
      <span class="tag m-${esc(r.method)}">${esc(r.method)}</span>
      <div class="info"><div class="name">${esc(r.name)}</div><div class="sub">${esc(r.url || '-')}</div></div>
      <button class="icon-btn" title="Delete">X</button>`;
    li.addEventListener('click', () => load(structuredClone(r)));
    li.querySelector('.icon-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${r.name}"?`)) return;
      saved = saved.filter((s) => s.id !== r.id);
      if (currentId === r.id) currentId = null;
      await persist();
      renderSaved();
      toast('DELETED');
    });
    els.savedList.appendChild(li);
  });
}

async function save(asNew = false) {
  const req = collect();
  const idx = saved.findIndex((s) => s.id === req.id);
  const updating = idx >= 0 && !asNew;

  if (updating) {
    saved[idx] = req;
  } else {
    if (saved.some((s) => s.name === req.name)) req.name = `${req.name} copy`;
    req.id = currentId = crypto.randomUUID();
    saved.unshift(req);
  }
  els.name.value = req.name;

  try {
    await persist();
    renderSaved();
    toast(updating ? 'UPDATED!' : 'SAVED!');
  } catch {
    toast('SAVE FAILED', true);
  }
}

els.filter.addEventListener('input', renderSaved);
els.send.addEventListener('click', send);
els.save.addEventListener('click', () => save());
els.saveNew.addEventListener('click', () => save(true));
$('#newBtn').addEventListener('click', () => {
  load({});
  els.url.focus();
});

els.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    send();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save(e.shiftKey);
  }
});

// ---------- boot ----------

load({});
loadSaved();
