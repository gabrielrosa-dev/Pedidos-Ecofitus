'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizeCatalog, buildOrder, MAX_AGE_MS } = require('./catalog');

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const whatsapp = '5541995922369';
const refreshMs = 5 * 60 * 1000;
const cachePath = path.join(__dirname, 'data', 'catalog.json');
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
let state = { products: [], updatedAt: 0, error: 'Aguardando a primeira atualização.' };
let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'sync-catalog.ps1'),
    ], { timeout: 120000, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
    const products = normalizeCatalog(JSON.parse(stdout.replace(/^\uFEFF/, '')));
    if (!products.length) throw new Error('Catálogo retornou sem produtos.');
    const snapshot = { products, updatedAt: Date.now() };
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath + '.tmp', JSON.stringify(snapshot), 'utf8');
    await fs.rename(cachePath + '.tmp', cachePath);
    state = { ...snapshot, error: null };
    console.log(`Catálogo atualizado: ${products.length} produtos.`);
  } catch (error) {
    state.error = 'Não foi possível atualizar o catálogo.';
    console.error('Falha ao atualizar catálogo:', error.message);
  } finally {
    refreshing = false;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw new Error('Pedido excede o tamanho permitido.');
  }
  try { return JSON.parse(body); } catch { throw new Error('Dados do pedido inválidos.'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return sendJson(res, 200, {
        products: state.products, updatedAt: state.updatedAt,
        stale: !state.updatedAt || Date.now() - state.updatedAt > MAX_AGE_MS,
        error: state.error,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/order') {
      let input;
      try {
        input = await readJson(req);
        const message = buildOrder(input, state.products, state.updatedAt);
        return sendJson(res, 200, { url: `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}` });
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }
    if (req.method === 'GET' && assets[url.pathname]) {
      const [file, type] = assets[url.pathname];
      const content = await fs.readFile(path.join(__dirname, 'public', file));
      res.writeHead(200, {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      return res.end(content);
    }
    return sendJson(res, 404, { error: 'Página não encontrada.' });
  } catch (error) {
    console.error('Erro ao processar requisição:', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno do servidor.' });
    else res.destroy();
  }
});

async function start() {
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (Array.isArray(cached.products) && Number.isFinite(cached.updatedAt)) {
      state = { ...cached, error: 'Aguardando atualização do catálogo.' };
    } else {
      console.error('Cache do catálogo inválido; será atualizado.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Falha ao ler cache:', error.message);
  }
  server.listen(port, host, () => console.log(`Loja disponível em http://localhost:${port}`));
  refresh();
  setInterval(refresh, refreshMs);
}

start().catch((error) => { console.error('Falha ao iniciar:', error); process.exitCode = 1; });
