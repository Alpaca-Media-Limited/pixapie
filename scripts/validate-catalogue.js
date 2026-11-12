#!/usr/bin/env node
// Checks every template in catalogue/. Runs on pull requests, or locally:
//   npm run check-catalogue            check the files are valid
//   npm run check-catalogue -- --live  also send every request and report the status
const fs = require('fs');
const path = require('path');
const { validateTemplate, slugify } = require('../public/template-format.js');

const dir = path.join(__dirname, '..', 'catalogue');
const live = process.argv.includes('--live');

function fillVariables(text, variables) {
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) => variables.find((v) => v.key === name)?.value ?? match);
}

async function sendRequest(r, variables) {
  const fill = (s) => fillVariables(s || '', variables);
  const headers = {};
  (r.headers || []).filter((h) => h.on !== false).forEach((h) => (headers[fill(h.key)] = fill(h.value)));
  let body;
  if (r.bodyType === 'form') {
    body = new URLSearchParams((r.form || []).filter((f) => f.on !== false).map((f) => [fill(f.key), fill(f.value)])).toString();
    headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
  } else if (r.bodyType && r.bodyType !== 'none') {
    body = fill(r.body);
    headers['Content-Type'] ??= { json: 'application/json', text: 'text/plain', xml: 'application/xml' }[r.bodyType];
  }
  try {
    const res = await fetch(fill(r.url), { method: r.method, headers, body, signal: AbortSignal.timeout(20000) });
    await res.arrayBuffer();
    return `${res.status}`;
  } catch (err) {
    return `ERROR ${err.cause?.message || err.message}`;
  }
}

(async () => {
  let failed = 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

  for (const file of files) {
    let template;
    let problems;
    try {
      template = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      problems = validateTemplate(template);
    } catch (err) {
      problems = [`Not valid JSON: ${err.message}`];
    }
    if (file !== `${slugify(file.replace(/\.json$/, ''))}.json`) problems.push('File name should be lowercase-with-dashes.json');

    if (problems.length) {
      failed++;
      console.log(`✗ ${file}`);
      problems.forEach((p) => console.log(`    ${p}`));
      continue;
    }
    console.log(`✓ ${file}  (${template.requests.length} requests)`);

    if (live) {
      for (const r of template.requests) {
        const status = await sendRequest(r, template.variables || []);
        // Some requests deliberately return errors (e.g. a 404 demo), so only network failures count as broken
        if (status.startsWith('ERROR')) failed++;
        console.log(`    ${status.padEnd(5)} ${r.method.padEnd(6)} ${r.name}`);
      }
    }
  }

  console.log(failed ? `\n${failed} problem(s) found.` : `\nAll ${files.length} templates look good.`);
  process.exit(failed ? 1 : 0);
})();
