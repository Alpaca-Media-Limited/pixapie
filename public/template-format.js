// The catalogue template format. Shared by the page, the server and scripts/validate-catalogue.js.
(function (root) {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const BODY_TYPES = ['none', 'json', 'text', 'xml', 'form'];
  const VAR_NAMES = /\{\{\s*([^{}\s]+)\s*\}\}/g;

  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const isRows = (v) => Array.isArray(v) && v.every((row) => row && typeof row.key === 'string');

  // Every {{name}} used anywhere in the template's requests
  function usedVariables(requests) {
    const names = new Set();
    JSON.stringify(requests || []).replace(VAR_NAMES, (match, name) => names.add(name));
    return [...names];
  }

  // Returns a list of problems. An empty list means the template is valid.
  function validateTemplate(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return ['A template must be a JSON object'];
    const problems = [];
    if (!isText(t.name)) problems.push('"name" is required');
    if (!isText(t.description)) problems.push('"description" is required');
    if (t.category !== undefined && !isText(t.category)) problems.push('"category" must be text');
    if (t.auth !== undefined && !isText(t.auth)) problems.push('"auth" must be text');
    if (t.docs !== undefined && !/^https?:\/\/\S+$/.test(t.docs)) problems.push('"docs" must be an http(s) link');

    if (t.variables !== undefined) {
      if (!Array.isArray(t.variables)) problems.push('"variables" must be a list');
      else t.variables.forEach((v, i) => {
        if (!v || !isText(v.key)) problems.push(`variables[${i}] needs a "key"`);
      });
    }

    if (!Array.isArray(t.requests) || !t.requests.length) {
      problems.push('"requests" must be a list with at least one request');
    } else {
      t.requests.forEach((r, i) => {
        const where = `requests[${i}]${r && isText(r.name) ? ` "${r.name}"` : ''}`;
        if (!r || typeof r !== 'object') return problems.push(`${where} must be an object`);
        if (!isText(r.name)) problems.push(`${where} needs a "name"`);
        if (!METHODS.includes(r.method)) problems.push(`${where} "method" must be one of ${METHODS.join(', ')}`);
        if (!isText(r.url)) problems.push(`${where} needs a "url"`);
        if (r.bodyType !== undefined && !BODY_TYPES.includes(r.bodyType)) problems.push(`${where} "bodyType" must be one of ${BODY_TYPES.join(', ')}`);
        for (const list of ['params', 'headers', 'form']) {
          if (r[list] === undefined) continue;
          if (!isRows(r[list])) {
            problems.push(`${where} "${list}" must be a list of { "key", "value" } rows`);
            continue;
          }
          r[list].forEach((row) => {
            if (row.required !== undefined && typeof row.required !== 'boolean') {
              problems.push(`${where} ${list} "${row.key}": "required" must be true or false`);
            } else if (row.required && row.on === false) {
              problems.push(`${where} ${list} "${row.key}" is required, so it can't be switched off ("on": false)`);
            }
          });
        }
      });
    }

    // Variables have to be declared so the docs can explain them
    if (!problems.length) {
      const declared = new Set((t.variables || []).map((v) => v.key));
      usedVariables(t.requests).forEach((name) => {
        if (!declared.has(name)) problems.push(`{{${name}}} is used but not listed in "variables"`);
      });
    }
    return problems;
  }

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'template';
  }

  const api = { METHODS, BODY_TYPES, validateTemplate, usedVariables, slugify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PixapieTemplates = api;
})(this);
