import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { LocalFileAdapterTransport } from './modules/adapters/LocalFileAdapterTransport.mjs';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const ROOT = resolve(process.cwd());
const RETRO_PATH = process.env.HELIX_WEEKLY_RETRO_PATH || 'C:\\dev\\.icf-retros\\weekly\\latest-weekly-retro.json';

// Initialize LocalFileAdapterTransport for weekly retro artifact
const retroTransport = new LocalFileAdapterTransport({
  filePath: RETRO_PATH,
  parse: (raw) => JSON.parse(raw)
});

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=UTF-8'
};

const server = createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = reqUrl.pathname;

  // 1. API Route: GET /api/reporting/weekly-retro
  if (pathname === '/api/reporting/weekly-retro' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const data = await retroTransport.fetch();
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'SUCCESS', data }));
    } catch (err) {
      res.writeHead(503);
      res.end(JSON.stringify({
        status: 'UNAVAILABLE',
        error: `Weekly retro artifact missing or unreadable at ${RETRO_PATH}: ${err.message}`
      }));
    }
    return;
  }

  if (pathname.startsWith('/api/reporting/weekly-retro/') && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    const projection = pathname.slice('/api/reporting/weekly-retro/'.length);
    if (!['categories', 'evidence', 'actions'].includes(projection)) {
      res.writeHead(404); res.end(JSON.stringify({ status: 'NOT_FOUND', error: 'Reporting projection not found' })); return;
    }
    try {
      const data = await retroTransport.fetch();
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'SUCCESS', data: Array.isArray(data[projection]) ? data[projection] : [] }));
    } catch (err) {
      res.writeHead(503); res.end(JSON.stringify({ status: 'UNAVAILABLE', error: `Weekly retro projection unavailable: ${err.message}` }));
    }
    return;
  }

  // 2. Static File Serving (with path traversal guard)
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safePath = normalize(join(ROOT, relativePath));

  // Security check: path traversal prevention
  if (!safePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden: Invalid file path');
    return;
  }

  if (existsSync(safePath) && statSync(safePath).isFile()) {
    try {
      const ext = extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const fileContent = readFileSync(safePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(fileContent);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`500 Internal Server Error: ${err.message}`);
    }
    return;
  }

  // 404 Not Found fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`404 Not Found: ${pathname}`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ICF Server] Running at http://127.0.0.1:${PORT}`);
  console.log(`[ICF Server] API Endpoint: http://127.0.0.1:${PORT}/api/reporting/weekly-retro`);
});
