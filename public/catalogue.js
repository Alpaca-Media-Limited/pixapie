// API catalogue: ready-made requests with docs, plus templates people make themselves.
// Loaded after app.js and uses its helpers and state (els, load, saved, envs, toast...).

const LIBRARY_REPO = 'https://github.com/Alpaca-Media-Limited/pixapie';
const { validateTemplate, usedVariables, slugify } = window.PixapieTemplates;

// Header and param names that usually hold secrets; their values are left out of templates
const SECRET_NAMES = /auth|token|key|secret|password|cookie|session/i;

const cat = {
  dialog: $('#catDialog'),
  search: $('#catSearch'),
  chips: $('#catChips'),
  list: $('#catList'),
  detail: $('#catDetail'),
  importFile: $('#catImportFile'),
  categories: $('#catCategories'),
};

let builtinTemplates = [];
let myTemplates = [];
let catFilter = 'All';
let selectedTplId = null;
let editingTpl = null; // the template being made or edited; null while browsing

const allTemplates = () => [...myTemplates, ...builtinTemplates];
const selectedTemplate = () => allTemplates().find((t) => t.id === selectedTplId) || null;

async function loadCatalogue() {
  const get = (url) => fetch(url).then((r) => r.json()).catch(() => []);
  const [builtin, mine] = await Promise.all([get('/api/catalogue'), get('/api/templates')]);
  builtinTemplates = builtin;
  myTemplates = mine.map((t) => ({ ...t, mine: true }));
}

// The template as it's shared, without the app's own bookkeeping
function templateData(t) {
  const { id, mine, builtin, ...data } = t;
  return data;
}

function templateJson(t) {
  return `${JSON.stringify(templateData(t), null, 2)}\n`;
}

async function persistMyTemplates() {
  try {
    await fetch('/api/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(myTemplates.map((t) => ({ id: t.id, ...templateData(t) }))),
    });
  } catch {
    toast('SAVE FAILED', true);
  }
}

// ---------- browsing ----------

function visibleTemplates() {
  const q = cat.search.value.trim().toLowerCase();
  return allTemplates().filter((t) => {
    if (catFilter === 'Mine' && !t.mine) return false;
    if (catFilter !== 'All' && catFilter !== 'Mine' && (t.category || 'Other') !== catFilter) return false;
    if (!q) return true;
    return [t.name, t.description, t.category, ...t.requests.map((r) => r.name)].join(' ').toLowerCase().includes(q);
  });
}

function renderChips() {
  const categories = [...new Set(allTemplates().map((t) => t.category || 'Other'))].sort();
  const chips = ['All', ...categories, ...(myTemplates.length ? ['Mine'] : [])];
  if (!chips.includes(catFilter)) catFilter = 'All';
  cat.chips.innerHTML = chips
    .map((c) => `<button class="chip${c === catFilter ? ' active' : ''}" data-chip="${esc(c)}">${esc(c.toUpperCase())}</button>`)
    .join('');
  cat.categories.innerHTML = categories.map((c) => `<option value="${esc(c)}"></option>`).join('');
}

function renderList() {
  const list = visibleTemplates();
  cat.list.innerHTML = '';
  if (!list.length) {
    cat.list.appendChild(el('li', 'cat-empty', 'No APIs match.'));
    return;
  }
  list.forEach((t) => {
    const n = t.requests.length;
    const li = el('li', t.id === selectedTplId && !editingTpl ? 'selected' : '');
    li.innerHTML = `
      <div class="name">${esc(t.name)}${t.mine ? '<span class="mine-tag">MINE</span>' : ''}</div>
      <div class="meta">${esc(t.category || 'Other')} · ${n} request${n === 1 ? '' : 's'}</div>`;
    li.addEventListener('click', () => {
      if (editingTpl && !confirm('Discard the template you are editing?')) return;
      editingTpl = null;
      selectedTplId = t.id;
      renderCatalogue();
    });
    cat.list.appendChild(li);
  });
}

function renderCatalogue() {
  renderChips();
  if (!editingTpl && !selectedTemplate()) selectedTplId = visibleTemplates()[0]?.id ?? null;
  renderList();
  if (editingTpl) renderEditor();
  else renderDocs();
}

// Rows marked "required": true or false get a badge, required ones first. Rows that
// don't say either way (older or imported templates) are shown as they are.
function needBadge(r) {
  if (r.required === true) return '<span class="need need-req">REQUIRED</span>';
  if (r.required === false || r.on === false) return '<span class="need need-opt">OPTIONAL</span>';
  return '';
}

function rowsTable(rows) {
  const sorted = [...rows.filter((r) => r.required === true), ...rows.filter((r) => r.required !== true)];
  return `<table class="htable tpl-table">${sorted
    .map(
      (r) => `<tr>
        <td>${esc(r.key)}${needBadge(r)}</td>
        <td class="tpl-val">${esc(r.value ?? '')}${r.on === false ? ' <span class="opt">(off until you switch it on)</span>' : ''}</td>
        <td>${esc(r.description || '')}</td>
      </tr>`
    )
    .join('')}</table>`;
}

function requestDocs(r, i) {
  const hasBody = r.bodyType && r.bodyType !== 'none';
  return `<div class="tpl-req">
    <div class="tpl-req-head">
      <span class="tag m-${esc(r.method)}">${esc(r.method)}</span>
      <b>${esc(r.name)}</b>
      <button class="btn btn-sm btn-go" data-use="${i}">USE</button>
    </div>
    <code class="tpl-url">${esc(r.url)}</code>
    ${r.description ? `<p>${esc(r.description)}</p>` : ''}
    ${r.params?.length ? `<div class="tpl-sub">PARAMS</div>${rowsTable(r.params)}` : ''}
    ${r.headers?.length ? `<div class="tpl-sub">HEADERS</div>${rowsTable(r.headers)}` : ''}
    ${hasBody && r.bodyType === 'form' && r.form?.length ? `<div class="tpl-sub">FORM BODY</div>${rowsTable(r.form)}` : ''}
    ${hasBody && r.bodyType !== 'form' && r.body ? `<div class="tpl-sub">${esc(r.bodyType.toUpperCase())} BODY</div><pre>${esc(r.body)}</pre>` : ''}
  </div>`;
}

function renderDocs() {
  const t = selectedTemplate();
  if (!t) {
    cat.detail.innerHTML = '<div class="empty">NO API SELECTED</div>';
    return;
  }
  const vars = envVars();
  const env = activeEnv();
  const docsLink = /^https?:\/\//.test(t.docs || '')
    ? `<a class="btn btn-sm" href="${esc(t.docs)}" target="_blank" rel="noopener noreferrer">OPEN DOCS</a>`
    : '';

  cat.detail.innerHTML = `
    <h2 class="tpl-title">${esc(t.name)}</h2>
    <div class="tpl-meta">
      <span class="tag-cat">${esc((t.category || 'Other').toUpperCase())}</span>
      <span>Auth: ${esc(t.auth || 'None')}</span>
      ${docsLink}
    </div>
    ${t.mine ? `<div class="tpl-actions">
      <button class="btn btn-sm" data-action="edit">EDIT</button>
      <button class="btn btn-sm" data-action="export">EXPORT</button>
      <button class="btn btn-sm btn-go" data-action="submit">SUBMIT TO LIBRARY</button>
      <button class="btn btn-sm btn-danger" data-action="delete">DELETE</button>
    </div>` : ''}
    <p class="tpl-desc">${esc(t.description)}</p>
    ${t.variables?.length ? `<div class="tpl-section">
      <div class="label">VARIABLES</div>
      <p class="hint">These requests use variables. Add them to your environment, then change the values to suit you.</p>
      <table class="htable tpl-table">${t.variables
        .map(
          (v) => `<tr>
            <td>{{${esc(v.key)}}}</td>
            <td class="tpl-val">${esc(v.value ?? '')}</td>
            <td>${esc(v.description || '')}</td>
            <td>${vars.has(v.key) ? '<span class="var-set">SET</span>' : '<span class="var-missing">MISSING</span>'}</td>
          </tr>`
        )
        .join('')}</table>
      <button class="btn btn-sm" data-action="add-vars">ADD TO ${esc(env ? env.name.toUpperCase() : 'A NEW ENVIRONMENT')}</button>
    </div>` : ''}
    <div class="tpl-section">
      <div class="label">REQUESTS (${t.requests.length})</div>
      ${t.requests.map(requestDocs).join('')}
    </div>`;
  cat.detail.scrollTop = 0;
}

// ---------- using a template ----------

const toRows = (list) => (list || []).map((r) => ({ key: r.key, value: r.value ?? '', on: r.on !== false }));

function useRequest(t, i) {
  const r = t.requests[i];
  load({
    name: `${t.name}: ${r.name}`,
    method: r.method,
    url: r.url,
    params: toRows(r.params),
    headers: toRows(r.headers),
    bodyType: r.bodyType || 'none',
    body: r.body || '',
    form: toRows(r.form),
  });
  cat.dialog.close();
  toast('READY TO SEND!');
}

function addVariablesToEnv(t) {
  let env = activeEnv();
  if (!env) {
    env = { id: crypto.randomUUID(), name: t.name, vars: [] };
    envs.list.push(env);
    envs.active = env.id;
  }
  const existing = new Set(env.vars.map((v) => v.key.trim()));
  const added = t.variables.filter((v) => !existing.has(v.key));
  added.forEach((v) => env.vars.push({ key: v.key, value: v.value ?? '', on: true }));
  persistEnvs();
  renderEnvSelect();
  updateUrlPreview();
  renderDocs();
  toast(added.length ? `ADDED ${added.length} TO ${env.name.toUpperCase()}` : 'ALREADY IN YOUR ENVIRONMENT');
}

// ---------- sharing ----------

function exportTemplate(t) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([templateJson(t)], { type: 'application/json' }));
  a.download = `${slugify(t.name)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('EXPORTED!');
}

// Opens GitHub's "new file" page with the template filled in; for non-maintainers GitHub forks and opens a pull request
function submitTemplate(t) {
  const ok = confirm(
    'This opens GitHub with your template ready to add to the Pixapie library.\n\n' +
      'You need a free GitHub account. GitHub makes your own copy of the project and opens a pull request, ' +
      'which is reviewed before it goes live.\n\n' +
      'Check it contains no real API keys, tokens or passwords before you submit.'
  );
  if (!ok) return;
  const url = `${LIBRARY_REPO}/new/main/catalogue?filename=${encodeURIComponent(`${slugify(t.name)}.json`)}&value=${encodeURIComponent(templateJson(t))}`;
  // Very long links get cut off, so big templates go as a file instead
  if (url.length > 8000) {
    exportTemplate(t);
    window.open(`${LIBRARY_REPO}/blob/main/CONTRIBUTING.md`, '_blank', 'noopener');
    toast('TOO BIG FOR A LINK: FILE DOWNLOADED');
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function deleteTemplate(t) {
  if (!confirm(`Delete template "${t.name}"?`)) return;
  myTemplates = myTemplates.filter((x) => x.id !== t.id);
  selectedTplId = null;
  await persistMyTemplates();
  renderCatalogue();
  toast('DELETED');
}

$('#catImport').addEventListener('click', () => cat.importFile.click());

cat.importFile.addEventListener('change', async () => {
  const file = cat.importFile.files[0];
  cat.importFile.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('NOT A JSON FILE', true);
    return;
  }
  const problems = validateTemplate(data);
  if (problems.length) {
    alert(`This template can't be imported:\n\n- ${problems.join('\n- ')}`);
    return;
  }
  const tpl = { ...templateData(data), id: crypto.randomUUID(), mine: true };
  myTemplates.unshift(tpl);
  await persistMyTemplates();
  editingTpl = null;
  selectedTplId = tpl.id;
  catFilter = 'All';
  cat.search.value = '';
  renderCatalogue();
  toast('IMPORTED!');
});

// ---------- making templates ----------

function hasSecret(row) {
  return SECRET_NAMES.test(row.key) && !String(row.value).includes('{{');
}

// Saved rows become template rows. Switched-on rows start as required, since the request was
// built with them; the author can untick any that the API doesn't actually need.
function scrubRows(rows) {
  return (rows || [])
    .filter((r) => r.key.trim())
    .map((r) => ({
      key: r.key,
      value: hasSecret(r) ? '' : r.value,
      on: r.on,
      required: r.on !== false,
      ...(hasSecret(r) ? { description: 'Add your own value' } : {}),
    }));
}

const ROW_LISTS = [['params', 'PARAMS'], ['headers', 'HEADERS'], ['form', 'FORM BODY']];

// The param, header and form rows of one request in the template editor
function editorRows(r, i) {
  return ROW_LISTS.filter(([list]) => r[list]?.length)
    .map(([list, title]) => `<div class="tpl-sub">${title}</div>
      ${r[list]
        .map(
          (row, j) => `<div class="tpl-edit-row">
            <code class="tpl-row-key" title="${esc(row.value ?? '')}">${esc(row.key)}</code>
            <label class="tpl-req-check" title="${row.on === false ? 'Off by default, so it can only be optional' : 'Tick if the API needs this to work'}">
              <input type="checkbox" data-req="${i}" data-list="${list}" data-row="${j}" data-row-field="required"
                ${row.required ? 'checked' : ''} ${row.on === false ? 'disabled' : ''}> REQUIRED
            </label>
            <input class="input input-sm" data-req="${i}" data-list="${list}" data-row="${j}" data-row-field="description"
              value="${esc(row.description || '')}" placeholder="what it's for">
          </div>`
        )
        .join('')}`)
    .join('');
}

function scrubUrl(url) {
  const { base, query, hash } = splitUrl(url);
  const rows = parseQuery(query);
  return rows.some(hasSecret) ? buildUrl(base, scrubRows(rows), hash) : url;
}

// A saved request as a template request, leaving out anything that looks like a secret
function templateRequest(r) {
  const req = { name: r.name, method: r.method, url: scrubUrl(r.url), description: '' };
  const params = scrubRows(r.params);
  const headers = scrubRows(r.headers);
  if (params.length) req.params = params;
  if (headers.length) req.headers = headers;
  if (r.bodyType && r.bodyType !== 'none') {
    req.bodyType = r.bodyType;
    if (r.bodyType === 'form') req.form = scrubRows(r.form);
    else req.body = r.body;
  }
  return req;
}

function editable(t) {
  return {
    id: t.id,
    name: t.name || '',
    category: t.category || '',
    auth: t.auth || '',
    docs: t.docs || '',
    description: t.description || '',
    variables: structuredClone(t.variables || []),
    requests: structuredClone(t.requests || []),
  };
}

function editorVariables() {
  return usedVariables(editingTpl.requests).map(
    (key) => editingTpl.variables.find((v) => v.key === key) || { key, value: '', description: '' }
  );
}

function renderEditor() {
  const t = editingTpl;
  const vars = editorVariables();
  cat.detail.innerHTML = `
    <div class="tpl-editor">
      <h2 class="tpl-title">${t.id ? 'EDIT TEMPLATE' : 'NEW TEMPLATE'}</h2>
      <p class="hint">Turn your saved requests into a documented template. Keep it for yourself, export it to share, or submit it to the Pixapie library.</p>
      <label class="field"><span class="label">NAME</span>
        <input class="input" data-field="name" value="${esc(t.name)}" placeholder="e.g. My Weather API" spellcheck="false"></label>
      <div class="field-row">
        <label class="field"><span class="label">CATEGORY</span>
          <input class="input" data-field="category" value="${esc(t.category)}" list="catCategories" placeholder="e.g. Data"></label>
        <label class="field"><span class="label">AUTH</span>
          <input class="input" data-field="auth" value="${esc(t.auth)}" placeholder="None"></label>
      </div>
      <label class="field"><span class="label">DOCS LINK</span>
        <input class="input" data-field="docs" value="${esc(t.docs)}" placeholder="https://..." spellcheck="false"></label>
      <label class="field"><span class="label">DESCRIPTION</span>
        <textarea class="input" rows="4" data-field="description" placeholder="What does this API do? Anything people should know, like limits or how to get a key?">${esc(t.description)}</textarea></label>

      <div class="label">REQUESTS (${t.requests.length})</div>
      ${t.requests
        .map(
          (r, i) => `<div class="tpl-edit-req">
            <span class="tag m-${esc(r.method)}">${esc(r.method)}</span>
            <input class="input" data-req="${i}" data-req-field="name" value="${esc(r.name)}" aria-label="Request name">
            <button class="icon-btn" data-action="remove-request" data-index="${i}" title="Remove">X</button>
            <code class="tpl-url">${esc(r.url)}</code>
            <textarea class="input" rows="2" data-req="${i}" data-req-field="description" placeholder="What does this request do?">${esc(r.description || '')}</textarea>
            ${editorRows(r, i)}
          </div>`
        )
        .join('')}
      <select class="input input-sm tpl-add" data-add-saved ${saved.length ? '' : 'disabled'} aria-label="Add a saved request">
        <option value="">${saved.length ? '+ ADD ONE OF YOUR SAVED REQUESTS...' : 'SAVE SOME REQUESTS FIRST, THEN ADD THEM HERE'}</option>
        ${saved.map((s) => `<option value="${esc(s.id)}">${esc(s.method)}  ${esc(folderPath(reqFolder(s)) ? `${folderPath(reqFolder(s))} / ` : '')}${esc(s.name)}</option>`).join('')}
      </select>

      ${vars.length ? `<div class="tpl-section">
        <div class="label">VARIABLES</div>
        <p class="hint">Your requests use these variables. Give an example value and say what each one is for.</p>
        ${vars
          .map(
            (v) => `<div class="tpl-edit-var">
              <span class="tpl-var-name">{{${esc(v.key)}}}</span>
              <input class="input" data-var="${esc(v.key)}" data-var-field="value" value="${esc(v.value || '')}" placeholder="example value">
              <input class="input" data-var="${esc(v.key)}" data-var-field="description" value="${esc(v.description || '')}" placeholder="what it's for">
            </div>`
          )
          .join('')}
      </div>` : ''}

      <p class="hint warn">Header and param values that look like keys, tokens or passwords are left out automatically. Check request bodies yourself: never put real secrets in a template.</p>
      <div class="tpl-actions">
        <button class="btn btn-sm" data-action="cancel-edit">CANCEL</button>
        <button class="btn btn-sm btn-go" data-action="save-template">SAVE TEMPLATE</button>
      </div>
    </div>`;
}

async function saveEditingTemplate() {
  const t = editingTpl;
  const variables = editorVariables().map((v) => ({ key: v.key, value: v.value || '', description: (v.description || '').trim() }));
  const data = {
    name: t.name.trim(),
    category: t.category.trim() || 'Other',
    description: t.description.trim(),
    ...(t.docs.trim() ? { docs: t.docs.trim() } : {}),
    auth: t.auth.trim() || 'None',
    ...(variables.length ? { variables } : {}),
    requests: t.requests.map((r) => {
      const out = { ...r, name: r.name.trim(), description: (r.description || '').trim() };
      for (const [list] of ROW_LISTS) {
        if (!out[list]) continue;
        out[list] = out[list].map(({ description, ...row }) => ({
          ...row,
          required: row.on !== false && !!row.required,
          ...(description?.trim() ? { description: description.trim() } : {}),
        }));
      }
      return out;
    }),
  };
  const problems = validateTemplate(data);
  if (problems.length) {
    alert(`Almost there. Please fix:\n\n- ${problems.join('\n- ')}`);
    return;
  }
  const tpl = { ...data, id: t.id || crypto.randomUUID(), mine: true };
  const idx = myTemplates.findIndex((x) => x.id === tpl.id);
  if (idx >= 0) myTemplates[idx] = tpl;
  else myTemplates.unshift(tpl);
  await persistMyTemplates();
  editingTpl = null;
  selectedTplId = tpl.id;
  renderCatalogue();
  toast('TEMPLATE SAVED!');
}

$('#catNew').addEventListener('click', () => {
  if (editingTpl && !confirm('Discard the template you are editing?')) return;
  editingTpl = editable({});
  // Start from the open request, if it's been saved
  const current = saved.find((s) => s.id === currentId);
  if (current) editingTpl.requests.push(templateRequest(current));
  renderCatalogue();
});

cat.detail.addEventListener('input', (e) => {
  if (!editingTpl) return;
  const d = e.target.dataset;
  if (d.field) {
    editingTpl[d.field] = e.target.value;
  } else if (d.rowField) {
    const row = editingTpl.requests[d.req][d.list][d.row];
    row[d.rowField] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  } else if (d.reqField) {
    editingTpl.requests[d.req][d.reqField] = e.target.value;
  } else if (d.varField) {
    let v = editingTpl.variables.find((x) => x.key === d.var);
    if (!v) editingTpl.variables.push((v = { key: d.var, value: '', description: '' }));
    v[d.varField] = e.target.value;
  }
});

cat.detail.addEventListener('change', (e) => {
  if (!editingTpl || !('addSaved' in e.target.dataset) || !e.target.value) return;
  const r = saved.find((s) => s.id === e.target.value);
  if (r) editingTpl.requests.push(templateRequest(r));
  renderEditor();
});

cat.detail.addEventListener('click', (e) => {
  const use = e.target.closest('[data-use]');
  if (use) return useRequest(selectedTemplate(), Number(use.dataset.use));
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const t = selectedTemplate();
  switch (button.dataset.action) {
    case 'add-vars':
      return addVariablesToEnv(t);
    case 'edit':
      editingTpl = editable(t);
      return renderCatalogue();
    case 'export':
      return exportTemplate(t);
    case 'submit':
      return submitTemplate(t);
    case 'delete':
      return deleteTemplate(t);
    case 'remove-request':
      editingTpl.requests.splice(Number(button.dataset.index), 1);
      return renderEditor();
    case 'cancel-edit':
      editingTpl = null;
      return renderCatalogue();
    case 'save-template':
      return saveEditingTemplate();
  }
});

// ---------- open and close ----------

cat.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]');
  if (!chip) return;
  catFilter = chip.dataset.chip;
  renderCatalogue();
});

cat.search.addEventListener('input', renderList);

// A template that was being edited when the dialog closed is still there when it reopens
$('#catalogueBtn').addEventListener('click', async () => {
  await loadCatalogue();
  renderCatalogue();
  cat.dialog.showModal();
});

function closeCatalogue() {
  if (editingTpl && !confirm('Close without saving this template?')) return false;
  editingTpl = null;
  cat.dialog.close();
  return true;
}

$('#catClose').addEventListener('click', closeCatalogue);

// Esc: ask before throwing away a half-made template. Browsers sometimes won't let Esc be
// stopped (e.g. no click or typing since the last Esc); then it just closes and the draft is kept.
cat.dialog.addEventListener('cancel', (e) => {
  if (!editingTpl || !e.cancelable) return;
  e.preventDefault();
  closeCatalogue();
});
