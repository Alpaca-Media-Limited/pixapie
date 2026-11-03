#!/usr/bin/env node
// Pixapie - tiny local API client. Zero dependencies, needs Node 18+.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3030;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Lives in the home folder so saved requests survive reinstalls and npx runs
const DATA_DIR = process.env.PIXAPIE_DATA || path.join(os.homedir(), '.pixapie');
const SAVED_FILE = path.join(DATA_DIR, 'saved.json');

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
    sendJson(res, 200, {
      ok: true,
      status: upstream.status,
      statusText: upstream.statusText,
      headers: [...upstream.headers],
      body: buf.toString('utf8'),
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

function handleSaved(req, res) {
  if (req.method === 'GET') {
    let saved = [];
    try { saved = JSON.parse(fs.readFileSync(SAVED_FILE, 'utf8')); } catch {}
    return sendJson(res, 200, saved);
  }
  if (req.method === 'PUT') {
    return readBody(req).then((raw) => {
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return sendJson(res, 400, { error: 'Expected an array' });
      fs.writeFileSync(SAVED_FILE, JSON.stringify(saved, null, 2));
      sendJson(res, 200, { ok: true });
    });
  }
  sendJson(res, 405, { error: 'Method not allowed' });
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
      if (req.url === '/api/saved') return await handleSaved(req, res);
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
  console.log(`  Saved requests: ${SAVED_FILE}`);
  console.log(`  Press Ctrl+C to stop\n`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
});
