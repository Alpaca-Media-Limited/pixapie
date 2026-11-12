#!/usr/bin/env node
// Pixapie - tiny local API client. Zero dependencies, needs Node 18+.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { validateTemplate } = require('./public/template-format.js');

const PORT = Number(process.env.PORT) || 3030;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CATALOGUE_DIR = path.join(__dirname, 'catalogue');
// Lives in the home folder so saved requests survive reinstalls and npx runs
const DATA_DIR = process.env.PIXAPIE_DATA || path.join(os.homedir(), '.pixapie');
const SAVED_FILE = path.join(DATA_DIR, 'saved.json');

// JSON files the page reads and writes whole, with the value used when the file doesn't exist yet
const STORES = {
  '/api/saved': { file: SAVED_FILE, empty: [] },
  '/api/folders': { file: path.join(DATA_DIR, 'folders.json'), empty: [] },
  '/api/environments': { file: path.join(DATA_DIR, 'environments.json'), empty: { active: null, list: [] } },
  '/api/templates': { file: path.join(DATA_DIR, 'templates.json'), empty: [] },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Headers fetch() refuses to set or manages itself
const BLOCKED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect']);

const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

fs.mkdirSync(DATA_DIR, { recursive: true });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleSend(req, res) {
  const { method = 'GET', url, headers = {}, body } = JSON.parse(await readBody(req));

  const cleanHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key && !BLOCKED_HEADERS.has(key.toLowerCase())) cleanHeaders[key] = value;
  }

  const options = { method, headers: cleanHeaders, redirect: 'follow' };
  if (body != null && body !== '' && method !== 'GET' && method !== 'HEAD') options.body = body;

  const start = performance.now();
  try {
    const upstream = await fetch(url, options);
    const buf = Buffer.from(await upstream.arrayBuffer());
    // Images can't survive being turned into text, so they travel as a data: URL instead
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const isImage = type.startsWith('image/');
    sendJson(res, 200, {
      ok: true,
      status: upstream.status,
      statusText: upstream.statusText,
      headers: [...upstream.headers],
      body: isImage ? '' : buf.toString('utf8'),
      image: isImage ? `data:${type};base64,${buf.toString('base64')}` : undefined,
      size: buf.length,
      time: Math.round(performance.now() - start),
    });
  } catch (err) {
    sendJson(res, 200, {
      ok: false,
      error: err.cause?.message || err.message,
      time: Math.round(performance.now() - start),
    });
  }
}

function handleStore({ file, empty }, req, res) {
  if (req.method === 'GET') {
    let data = empty;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    return sendJson(res, 200, data);
  }
  if (req.method === 'PUT') {
    return readBody(req).then((raw) => {
      const data = JSON.parse(raw);
      if (Array.isArray(data) !== Array.isArray(empty) || typeof data !== 'object' || data === null) {
        return sendJson(res, 400, { error: `Expected ${Array.isArray(empty) ? 'an array' : 'an object'}` });
      }
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      sendJson(res, 200, { ok: true });
    });
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

// Built-in templates: one JSON file per API in catalogue/, named by its id
function handleCatalogue(res) {
  let files = [];
  try { files = fs.readdirSync(CATALOGUE_DIR).filter((f) => f.endsWith('.json')); } catch {}
  const templates = [];
  for (const file of files) {
    try {
      const template = JSON.parse(fs.readFileSync(path.join(CATALOGUE_DIR, file), 'utf8'));
      const problems = validateTemplate(template);
      if (problems.length) {
        console.warn(`  Skipping catalogue/${file}: ${problems[0]}`);
        continue;
      }
      templates.push({ ...template, id: file.replace(/\.json$/, ''), builtin: true });
    } catch (err) {
      console.warn(`  Skipping catalogue/${file}: ${err.message}`);
    }
  }
  templates.sort((a, b) => a.name.localeCompare(b.name));
  sendJson(res, 200, templates);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      // Only our own page may use the proxy, not other sites open in the browser
      if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) return sendJson(res, 403, { error: 'Forbidden origin' });
      if (req.url === '/api/send' && req.method === 'POST') return await handleSend(req, res);
      if (STORES[req.url]) return await handleStore(STORES[req.url], req, res);
      if (req.url === '/api/catalogue' && req.method === 'GET') return handleCatalogue(res);
      return sendJson(res, 404, { error: 'Not found' });
    }
    serveStatic(req, res);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\n  Port ${PORT} is already in use. Pixapie may already be running at http://localhost:${PORT}`);
  console.error(`  To use another port: PORT=4000 npx pixapie\n`);
  process.exit(1);
});

// Bound to localhost only, so the proxy isn't reachable from the network
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Pixapie running at ${url}`);
  console.log(`  Saved data: ${DATA_DIR}`);
  console.log(`  Press Ctrl+C to stop\n`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
});
