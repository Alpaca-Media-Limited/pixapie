// Pixapie front end
const $ = (sel) => document.querySelector(sel);

const CONTENT_TYPES = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  form: 'application/x-www-form-urlencoded',
};

let saved = [];
let folders = []; // { id, name, parent: folder id or null, open }
let currentId = null;
let currentFolder = null; // folder the open request lives in, or will be saved to
let lastBody = '';

const els = {
  name: $('#reqName'),
  method: $('#method'),
  url: $('#url'),
  send: $('#sendBtn'),
  save: $('#saveBtn'),
  saveNew: $('#saveNewBtn'),
  paramRows: $('#paramRows'),
  paramCount: $('#paramCount'),
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
  newFolder: $('#newFolderBtn'),
  folder: $('#reqFolder'),
  filter: $('#filter'),
  toast: $('#toast'),
  urlPreview: $('#urlPreview'),
  envSelect: $('#envSelect'),
  envEditBtn: $('#envEditBtn'),
  envDialog: $('#envDialog'),
  envList: $('#envList'),
  envAdd: $('#envAdd'),
  envMain: $('#envMain'),
  envEmpty: $('#envEmpty'),
  envName: $('#envName'),
  envDelete: $('#envDelete'),
  envRows: $('#envRows'),
  envAddVar: $('#envAddVar'),
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
    // Removing a row doesn't fire input events, so tell the container it changed
    container.dispatchEvent(new Event('input', { bubbles: true }));
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

// ---------- query params ----------
// The URL box and the params rows mirror each other. Disabled params aren't in
// the URL, so they're kept in the rows (and saved) but left out when syncing.

function splitUrl(url) {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const q = rest.indexOf('?');
  return q >= 0 ? { base: rest.slice(0, q), query: rest.slice(q + 1), hash } : { base: rest, query: '', hash };
}

function decodePart(str) {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  } catch {
    return str;
  }
}

// Only encode what would break the query string, so commas, slashes etc. stay readable
function encodePart(str, isKey) {
  const unsafe = isKey ? /[ &#+=]/g : /[ &#+]/g;
  return str.replace(/%(?![0-9a-f]{2})/gi, '%25').replace(unsafe, encodeURIComponent);
}

function parseQuery(query) {
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq >= 0
        ? { key: decodePart(pair.slice(0, eq)), value: decodePart(pair.slice(eq + 1)), on: true }
        : { key: decodePart(pair), value: '', on: true };
    });
}

function updateParamCount() {
  const n = readKv(els.paramRows).filter((p) => p.on && p.key.trim()).length;
  els.paramCount.textContent = n ? `(${n})` : '';
}

function syncParamsFromUrl() {
  const disabled = readKv(els.paramRows).filter((p) => !p.on && p.key.trim());
  setKv(els.paramRows, [...parseQuery(splitUrl(els.url.value).query), ...disabled]);
  updateParamCount();
}

function buildUrl(base, rows, hash) {
  const query = rows
    .filter((p) => p.on && p.key.trim())
    .map((p) => encodePart(p.key.trim(), true) + (p.value ? `=${encodePart(p.value)}` : ''))
    .join('&');
  return base + (query ? `?${query}` : '') + hash;
}

function syncUrlFromParams() {
  const { base, hash } = splitUrl(els.url.value);
  els.url.value = buildUrl(base, readKv(els.paramRows), hash);
  updateParamCount();
  updateUrlPreview();
}

els.url.addEventListener('input', syncParamsFromUrl);
els.url.addEventListener('input', updateUrlPreview);
els.paramRows.addEventListener('input', syncUrlFromParams);
els.paramRows.addEventListener('change', syncUrlFromParams);
$('#addParam').addEventListener('click', () => addKvRow(els.paramRows).querySelector('.k').focus());

// ---------- environments ----------
// {{name}} anywhere in a request is swapped for the active environment's value when sending.

let envs = { active: null, list: [] };
let editingEnvId = null;

const VAR_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function activeEnv() {
  return envs.list.find((e) => e.id === envs.active) || null;
}

function envVars() {
  const vars = new Map();
  (activeEnv()?.vars || []).filter((v) => v.on && v.key.trim()).forEach((v) => vars.set(v.key.trim(), v.value));
  return vars;
}

// Unknown names are left as they are and collected into `missing`
function applyVars(str, vars, missing) {
  return str.replace(VAR_PATTERN, (match, name) => {
    if (vars.has(name)) return vars.get(name);
    missing.add(name);
    return match;
  });
}

function updateUrlPreview() {
  const url = els.url.value.trim();
  const missing = new Set();
  const resolved = applyVars(url, envVars(), missing);
  if (resolved === url && !missing.size) {
    els.urlPreview.hidden = true;
    return;
  }
  const env = activeEnv();
  els.urlPreview.hidden = false;
  els.urlPreview.classList.toggle('bad', missing.size > 0);
  els.urlPreview.innerHTML = missing.size
    ? `Unknown variable${missing.size > 1 ? 's' : ''}: <b>${esc([...missing].join(', '))}</b> ${env ? `(not in ${esc(env.name)})` : '(no environment selected)'}`
    : `Sends to: <b>${esc(resolved)}</b>`;
}

function renderEnvSelect() {
  els.envSelect.innerHTML =
    '<option value="">NO ENVIRONMENT</option>' + envs.list.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  els.envSelect.value = activeEnv() ? envs.active : '';
}

async function loadEnvs() {
  try {
    const data = await (await fetch('/api/environments')).json();
    if (Array.isArray(data.list)) envs = data;
  } catch {}
  renderEnvSelect();
  updateUrlPreview();
}

async function persistEnvs() {
  try {
    await fetch('/api/environments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envs),
    });
  } catch {
    toast('SAVE FAILED', true);
  }
}

els.envSelect.addEventListener('change', () => {
  envs.active = els.envSelect.value || null;
  persistEnvs();
  updateUrlPreview();
});

// --- edit dialog ---

function editingEnv() {
  return envs.list.find((e) => e.id === editingEnvId) || null;
}

// Copy what's in the editor back into the environment being edited
function commitEnvEdits() {
  const env = editingEnv();
  if (!env) return;
  env.name = els.envName.value.trim() || 'Untitled environment';
  env.vars = readKv(els.envRows).filter((v) => v.key.trim() || v.value);
}

function renderEnvDialog() {
  const env = editingEnv();
  els.envMain.hidden = !env;
  els.envEmpty.hidden = !!env;
  els.envList.innerHTML = '';
  envs.list.forEach((e) => {
    const li = el('li', e.id === editingEnvId ? 'editing' : '');
    li.innerHTML = `<span class="env-li-name">${esc(e.name)}</span>${e.id === envs.active ? '<span class="active-tag">ACTIVE</span>' : ''}`;
    li.addEventListener('click', () => {
      commitEnvEdits();
      editingEnvId = e.id;
      renderEnvDialog();
    });
    els.envList.appendChild(li);
  });
  if (env) {
    els.envName.value = env.name;
    setKv(els.envRows, env.vars);
  }
}

els.envName.addEventListener('input', () => {
  const name = els.envList.querySelector('.editing .env-li-name');
  if (name) name.textContent = els.envName.value || 'Untitled environment';
});

els.envAdd.addEventListener('click', () => {
  commitEnvEdits();
  const env = { id: crypto.randomUUID(), name: 'New environment', vars: [] };
  envs.list.push(env);
  // The first environment you make is switched on straight away
  if (!activeEnv()) envs.active = env.id;
  editingEnvId = env.id;
  renderEnvDialog();
  els.envName.focus();
  els.envName.select();
});

els.envDelete.addEventListener('click', () => {
  const env = editingEnv();
  if (!env || !confirm(`Delete environment "${env.name}"?`)) return;
  envs.list = envs.list.filter((e) => e.id !== env.id);
  if (envs.active === env.id) envs.active = null;
  editingEnvId = envs.list[0]?.id || null;
  renderEnvDialog();
});

els.envAddVar.addEventListener('click', () => addKvRow(els.envRows).querySelector('.k').focus());

els.envEditBtn.addEventListener('click', () => {
  editingEnvId = envs.active || envs.list[0]?.id || null;
  renderEnvDialog();
  els.envDialog.showModal();
});

// Save as you type, so nothing is lost if the page is closed with the dialog open
let envSaveTimer;
function onEnvEdit() {
  commitEnvEdits();
  clearTimeout(envSaveTimer);
  envSaveTimer = setTimeout(persistEnvs, 400);
}
els.envDialog.addEventListener('input', onEnvEdit);
els.envDialog.addEventListener('change', onEnvEdit);

$('#envDone').addEventListener('click', () => els.envDialog.close());
$('#envClose').addEventListener('click', () => els.envDialog.close());

// Fires for DONE, X and Esc alike
els.envDialog.addEventListener('close', () => {
  commitEnvEdits();
  clearTimeout(envSaveTimer);
  persistEnvs();
  renderEnvSelect();
  updateUrlPreview();
});

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
    params: readKv(els.paramRows),
    headers: readKv(els.headerRows),
    bodyType: els.bodyType.value,
    body: els.bodyText.value,
    form: readKv(els.formRows),
    folder: reqFolder({ folder: currentFolder }),
  };
}

function load(req) {
  currentId = req.id || null;
  els.name.value = req.name || '';
  els.method.value = req.method || 'GET';
  els.url.value = req.url || '';
  // Enabled params come from the URL; disabled ones only exist in the saved list
  setKv(els.paramRows, (req.params || []).filter((p) => !p.on));
  syncParamsFromUrl();
  setKv(els.headerRows, req.headers || [], HEADER_OPTS);
  els.bodyType.value = req.bodyType || 'none';
  els.bodyText.value = req.body || '';
  setKv(els.formRows, req.form || []);
  currentFolder = reqFolder(req);
  paintMethod();
  updateHeaderCount();
  updateUrlPreview();
  renderSaved();
}

// ---------- send ----------

async function send() {
  const req = collect();
  if (!req.url) {
    els.url.focus();
    return toast('ENTER A URL', true);
  }

  const vars = envVars();
  const missing = new Set();
  const sub = (str) => applyVars(str, vars, missing);

  const rawUrl = sub(req.url);
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
  const headers = {};
  req.headers.filter((h) => h.on && h.key.trim()).forEach((h) => (headers[sub(h.key.trim())] = sub(h.value)));

  let body;
  if (req.bodyType === 'form') {
    body = new URLSearchParams(req.form.filter((f) => f.on && f.key.trim()).map((f) => [sub(f.key.trim()), sub(f.value)])).toString();
  } else if (req.bodyType !== 'none') {
    body = sub(req.body);
  }
  if (missing.size) return toast(`UNKNOWN VARIABLE: ${[...missing].join(', ')}`, true);
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
  // Each new response starts at the top, not wherever the last one was scrolled to
  $('.resp-body').scrollTop = 0;
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

  els.pretty.innerHTML = '';
  if (r.image) {
    const type = r.image.slice('data:'.length, r.image.indexOf(';'));
    els.raw.textContent = `(${type} image, ${formatSize(r.size)}: see PRETTY)`;
    const img = el('img');
    img.src = r.image;
    img.alt = 'Image returned by the request';
    els.pretty.appendChild(el('div', 'resp-image')).appendChild(img);
    return;
  }

  let parsed;
  let isJson = false;
  try {
    parsed = JSON.parse(r.body);
    isJson = true;
  } catch {}

  els.raw.textContent = isJson ? JSON.stringify(parsed, null, 2) : r.body;
  if (isJson) {
    imagePreviewsLeft = MAX_IMAGE_PREVIEWS;
    els.pretty.appendChild(jsonNode(null, parsed, true));
  } else if (r.body) {
    els.pretty.appendChild(el('pre', 'code-block')).textContent = r.body;
  } else {
    els.pretty.innerHTML = '<div class="empty">EMPTY RESPONSE BODY</div>';
  }
}

// ---------- image previews in the JSON tree ----------

// Previews only load once scrolled into view (and not inside folded nodes); the cap just
// keeps enormous lists of image links from flooding the tree
const MAX_IMAGE_PREVIEWS = 500;
let imagePreviewsLeft = 0;

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const IMAGE_KEY = /avatar|image|img|photo|picture|thumb|icon|logo|sprite|flag|banner|cover/i;

// A link counts as an image if it ends like one, or its key says so (e.g. GitHub's avatar_url)
function isImageUrl(value, key) {
  if (/^data:image\//i.test(value)) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return IMAGE_EXTENSION.test(url.pathname) || (typeof key === 'string' && IMAGE_KEY.test(key));
}

function imagePreview(src) {
  const img = el('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  // Not every link that looks like an image is one
  img.addEventListener('error', () => wrap.remove());
  // Browsers won't open data: links in a new tab, so only real links are clickable
  const wrap = src.startsWith('data:') ? el('span', 'j-img') : el('a', 'j-img');
  if (wrap.tagName === 'A') {
    wrap.href = src;
    wrap.target = '_blank';
    wrap.rel = 'noopener noreferrer';
    wrap.title = 'Open full size';
  }
  wrap.appendChild(img);
  return wrap;
}

function jsonNode(key, value, last) {
  const comma = last ? '' : ',';
  const keyHtml = key !== null ? `<span class="j-key">${esc(JSON.stringify(key))}</span>: ` : '';

  if (value === null || typeof value !== 'object') {
    let cls = 'j-null';
    if (typeof value === 'string') cls = 'j-str';
    else if (typeof value === 'number') cls = 'j-num';
    else if (typeof value === 'boolean') cls = 'j-bool';
    const line = el('div', 'j-line j-leaf', `${keyHtml}<span class="${cls}">${esc(JSON.stringify(value))}</span>${comma}`);
    if (typeof value === 'string' && imagePreviewsLeft > 0 && isImageUrl(value, key)) {
      imagePreviewsLeft--;
      line.appendChild(imagePreview(value));
    }
    return line;
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

async function getList(url) {
  try {
    const data = await (await fetch(url)).json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadSaved() {
  [saved, folders] = await Promise.all([getList('/api/saved'), getList('/api/folders')]);
  // Repair hand-edited data: unknown parents go to the top level, and loops are broken
  folders = folders.filter((f) => f && f.id);
  for (const f of folders) {
    if (!folderById(f.parent) || isInside(f.parent, f.id)) f.parent = null;
  }
  renderSaved();
}

function putJson(url, data) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((res) => {
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
  });
}

async function persist() {
  await Promise.all([putJson('/api/saved', saved), putJson('/api/folders', folders)]);
}

// ---------- folders ----------

function folderById(id) {
  return id ? folders.find((f) => f.id === id) : undefined;
}

// The request's folder, or null when it has none or the folder is gone
function reqFolder(r) {
  return folderById(r.folder) ? r.folder : null;
}

function childFolders(parent) {
  return folders
    .filter((f) => (folderById(f.parent) ? f.parent : null) === parent)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

// True when folder `id` is `ancestorId` or sits somewhere inside it
function isInside(id, ancestorId) {
  const seen = new Set();
  for (let f = folderById(id); f && !seen.has(f.id); f = folderById(f.parent)) {
    if (f.id === ancestorId) return true;
    seen.add(f.id);
  }
  return false;
}

function folderPath(id) {
  const names = [];
  const seen = new Set();
  for (let f = folderById(id); f && !seen.has(f.id); f = folderById(f.parent)) {
    seen.add(f.id);
    names.unshift(f.name);
  }
  return names.join(' / ');
}

function countIn(id) {
  return saved.filter((r) => isInside(reqFolder(r), id)).length;
}

// Folders in tree order, for the folder picker
function folderTree(parent = null, depth = 0, out = []) {
  for (const f of childFolders(parent)) {
    out.push({ f, depth });
    folderTree(f.id, depth + 1, out);
  }
  return out;
}

function renderFolderSelect() {
  const loaded = saved.find((s) => s.id === currentId);
  if (loaded) currentFolder = reqFolder(loaded);
  if (!folderById(currentFolder)) currentFolder = null;
  els.folder.innerHTML = '<option value="">NO FOLDER</option>' +
    folderTree().map(({ f }) => `<option value="${esc(f.id)}">${esc(folderPath(f.id))}</option>`).join('');
  els.folder.value = currentFolder || '';
  els.folder.hidden = !folders.length;
}

async function saveChange(msg) {
  try {
    await persist();
    toast(msg);
  } catch {
    toast('SAVE FAILED', true);
  }
  renderSaved();
}

function askFolderName(title, value = '') {
  const name = prompt(title, value);
  return name === null ? null : name.trim().slice(0, 80) || null;
}

function createFolder(parent = null) {
  const name = askFolderName(parent ? `New folder inside "${folderPath(parent)}":` : 'New folder name:');
  if (!name) return;
  const id = crypto.randomUUID();
  folders.push({ id, name, parent, open: true });
  const p = folderById(parent);
  if (p) p.open = true;
  // A fresh, unsaved request goes into the folder you just made
  if (!saved.some((s) => s.id === currentId)) currentFolder = id;
  saveChange('FOLDER ADDED!');
}

function renameFolder(f) {
  const name = askFolderName('Rename folder:', f.name);
  if (!name || name === f.name) return;
  f.name = name;
  saveChange('RENAMED!');
}

function deleteFolder(f) {
  const parent = folderById(f.parent) ? f.parent : null;
  const inside = countIn(f.id) + folders.filter((c) => c.parent === f.id).length;
  const where = parent ? `"${folderPath(parent)}"` : 'the top level';
  if (!confirm(inside ? `Delete folder "${f.name}"?\n\nWhat's inside it moves up to ${where}. Nothing else is deleted.` : `Delete folder "${f.name}"?`)) return;
  for (const c of folders) if (c.parent === f.id) c.parent = parent;
  for (const r of saved) if (r.folder === f.id) r.folder = parent;
  if (currentFolder === f.id) currentFolder = parent;
  folders = folders.filter((c) => c !== f);
  saveChange('FOLDER DELETED');
}

// Move a request or folder (by drag and drop or the picker) into a folder, or to the top level (null)
function canMove(item, target) {
  if (!item) return false;
  if (item.type === 'folder') return !isInside(target, item.id);
  return true;
}

function moveItem(item, target) {
  if (!canMove(item, target)) return;
  if (item.type === 'folder') {
    const f = folderById(item.id);
    if (!f || (f.parent || null) === target) return;
    f.parent = target;
  } else {
    const r = saved.find((s) => s.id === item.id);
    if (!r || reqFolder(r) === target) return;
    r.folder = target;
  }
  const t = folderById(target);
  if (t) t.open = true;
  saveChange('MOVED!');
}

const PIX = {
  caret: '<svg class="caret" viewBox="0 0 5 3" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h5v1H0zM1 1h3v1H1zM2 2h1v1H2z" fill="currentColor"/></svg>',
  folder: '<svg class="folder-icon" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h3v1h4v5H0z" fill="currentColor"/></svg>',
  pencil: '<svg viewBox="0 0 7 7" width="10" height="10" shape-rendering="crispEdges" aria-hidden="true"><path d="M5 0h1v1h1v1H6v1H5v1H4v1H3v1H2v1H0V5h1V4h1V3h1V2h1V1h1z" fill="currentColor"/></svg>',
};

function folderRow(f, depth, open) {
  const count = countIn(f.id);
  const li = el('li', `folder-item${open ? '' : ' closed'}`);
  li.style.setProperty('--depth', depth);
  li.dataset.folder = f.id;
  li.draggable = true;
  li.innerHTML = `
    <button class="folder-toggle" aria-expanded="${open}" title="${esc(folderPath(f.id))}">
      ${PIX.caret}${PIX.folder}<span class="folder-name">${esc(f.name)}</span><span class="count">${count || ''}</span>
    </button>
    <button class="icon-btn icon-go" data-act="sub" title="New folder inside" aria-label="New folder inside ${esc(f.name)}">+</button>
    <button class="icon-btn icon-go" data-act="rename" title="Rename" aria-label="Rename ${esc(f.name)}">${PIX.pencil}</button>
    <button class="icon-btn" data-act="delete" title="Delete folder" aria-label="Delete ${esc(f.name)}">X</button>`;
  li.querySelector('.folder-toggle').addEventListener('click', () => {
    f.open = !open;
    renderSaved();
    persist().catch(() => {});
  });
  li.querySelector('[data-act="sub"]').addEventListener('click', () => createFolder(f.id));
  li.querySelector('[data-act="rename"]').addEventListener('click', () => renameFolder(f));
  li.querySelector('[data-act="delete"]').addEventListener('click', () => deleteFolder(f));
  return li;
}

function requestRow(r, depth) {
  const li = el('li', `saved-item${r.id === currentId ? ' active' : ''}`);
  li.style.setProperty('--depth', depth);
  li.dataset.req = r.id;
  li.draggable = true;
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
    saveChange('DELETED');
  });
  return li;
}

// Rows for one level of the tree. While filtering, folders with no matches are left out,
// and a folder whose own name matches shows everything inside it.
function branchRows(parent, depth, q) {
  const rows = [];
  for (const f of childFolders(parent)) {
    const nameHit = q && f.name.toLowerCase().includes(q);
    const inner = branchRows(f.id, depth + 1, nameHit ? '' : q);
    if (q && !nameHit && !inner.length) continue;
    const open = q ? true : f.open !== false;
    rows.push(folderRow(f, depth, open));
    if (open) rows.push(...inner);
  }
  for (const r of saved) {
    if (reqFolder(r) !== parent) continue;
    if (q && !`${r.name} ${r.url} ${r.method}`.toLowerCase().includes(q)) continue;
    rows.push(requestRow(r, depth));
  }
  return rows;
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
  renderFolderSelect();
  const q = els.filter.value.trim().toLowerCase();
  const rows = branchRows(null, 0, q);
  els.savedList.innerHTML = '';

  if (!rows.length) {
    els.savedList.appendChild(el('li', 'saved-empty', q ? 'No matches.' : 'Nothing saved yet. Hit SAVE.'));
    return;
  }
  els.savedList.append(...rows);
}

// ---------- drag and drop ----------

let dragging = null; // { type: 'req' | 'folder', id }

// Where a drop at this element lands: a folder row means into it, a request row means
// alongside it, and empty list space means the top level
function dropTarget(node) {
  const li = node.closest('li');
  if (li && li.dataset.folder) return li.dataset.folder;
  if (li && li.dataset.req) return reqFolder(saved.find((s) => s.id === li.dataset.req) || {});
  return null;
}

function clearDropMarks() {
  els.savedList.classList.remove('drop-root');
  els.savedList.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
}

els.savedList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li[draggable="true"]');
  if (!li) return;
  dragging = li.dataset.folder ? { type: 'folder', id: li.dataset.folder } : { type: 'req', id: li.dataset.req };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragging.id);
  li.classList.add('dragging');
});

els.savedList.addEventListener('dragend', () => {
  dragging = null;
  clearDropMarks();
  els.savedList.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
});

els.savedList.addEventListener('dragover', (e) => {
  if (!dragging) return;
  const target = dropTarget(e.target);
  clearDropMarks();
  if (!canMove(dragging, target)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = target && els.savedList.querySelector(`li[data-folder="${CSS.escape(target)}"]`);
  if (row) row.classList.add('drop-target');
  else els.savedList.classList.add('drop-root');
});

els.savedList.addEventListener('dragleave', (e) => {
  if (!els.savedList.contains(e.relatedTarget)) clearDropMarks();
});

els.savedList.addEventListener('drop', (e) => {
  e.preventDefault();
  const item = dragging;
  dragging = null;
  clearDropMarks();
  moveItem(item, dropTarget(e.target));
});

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
    toast(updating ? 'UPDATED!' : 'SAVED!');
  } catch {
    toast('SAVE FAILED', true);
  }
  renderSaved();
}

els.filter.addEventListener('input', renderSaved);
els.newFolder.addEventListener('click', () => createFolder(null));
// Picking a folder moves a saved request straight away; an unsaved one goes there when you save
els.folder.addEventListener('change', () => {
  const target = els.folder.value || null;
  currentFolder = target;
  if (saved.some((s) => s.id === currentId)) moveItem({ type: 'req', id: currentId }, target);
});
els.send.addEventListener('click', send);
els.save.addEventListener('click', () => save());
els.saveNew.addEventListener('click', () => save(true));
$('#newBtn').addEventListener('click', () => {
  // Stay in the same folder, so it's quick to add several requests to one group
  load({ folder: currentFolder });
  els.url.focus();
});

els.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

document.addEventListener('keydown', (e) => {
  // Send/save shortcuts shouldn't fire behind an open dialog
  if (document.querySelector('dialog[open]')) return;
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
loadEnvs();
