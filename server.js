'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { scryptSync, timingSafeEqual } = require('node:crypto');
const { normalizeCatalog, buildOrder, calculateOrder, verifyPriceQuote, MAX_AGE_MS } = require('./catalog');
const { lookupCompany } = require('./registry');
const { saveOrder, listOrders, updateOrder, fingerprint } = require('./orders');
const { getRepresentative } = require('./public/representatives');

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const refreshMs = 30 * 1000;
const cachePath = path.join(__dirname, 'data', 'catalog.json');
const ordersPath = path.resolve(process.env.ORDERS_DIR || path.join(__dirname, 'data', 'orders'));
const adminUsersPath = path.resolve(process.env.ADMIN_USERS_FILE || path.join(__dirname, 'data', 'admin-users.json'));
const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/representatives.js': ['representatives.js', 'text/javascript; charset=utf-8'],
  '/extra.css': ['extra.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/config.js': ['config.js', 'text/javascript; charset=utf-8'],
  '/experience.js': ['experience.js', 'text/javascript; charset=utf-8'],
  '/transport.js': ['transport.js', 'text/javascript; charset=utf-8'],
  '/pricing.js': ['pricing.js', 'text/javascript; charset=utf-8'],
  '/terms.js': ['terms.js', 'text/javascript; charset=utf-8'],
  '/campaigns.js': ['campaigns.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/offline.html': ['offline.html', 'text/html; charset=utf-8'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
  '/images/campaigns/b12-pix.jpeg': ['images/campaigns/b12-pix.jpeg', 'image/jpeg'],
  '/images/campaigns/b12-queimacure.jpeg': ['images/campaigns/b12-queimacure.jpeg', 'image/jpeg'],
  '/images/campaigns/barril-chopp.jpeg': ['images/campaigns/barril-chopp.jpeg', 'image/jpeg'],
  '/images/campaigns/q10-b12.jpeg': ['images/campaigns/q10-b12.jpeg', 'image/jpeg'],
  '/images/campaigns/regulax.jpeg': ['images/campaigns/regulax.jpeg', 'image/jpeg'],
  '/images/campaigns/show-brindes.jpeg': ['images/campaigns/show-brindes.jpeg', 'image/jpeg'],
};
let state = { products: [], updatedAt: 0, error: 'Aguardando a primeira atualização.' };
let refreshInFlight;
const failedAuth = new Map();
let adminUsers = [];

function authenticatedAdmin(req) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Basic ')) return false;
  const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const user = separator < 0 ? '' : decoded.slice(0, separator);
  const password = separator < 0 ? '' : decoded.slice(separator + 1);
  const account = adminUsers.find((entry) => entry.email.toLocaleLowerCase('pt-BR') === user.toLocaleLowerCase('pt-BR'));
  if (!account) return null;
  const actual = scryptSync(password, Buffer.from(account.salt, 'base64'), 64);
  const expected = Buffer.from(account.passwordHash, 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? account : null;
}

function requireAdmin(req, res) {
  if (!adminUsers.length) {
    sendJson(res, 503, { error: 'Acesso administrativo não configurado.' });
    return false;
  }
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  for (const [key, record] of failedAuth) {
    if (now - record.start >= 15 * 60 * 1000) failedAuth.delete(key);
  }
  const record = failedAuth.get(ip) || { start: now, count: 0 };
  if (record.count >= 10) {
    sendJson(res, 429, { error: 'Muitas tentativas. Tente novamente mais tarde.' });
    return false;
  }
  const account = authenticatedAdmin(req);
  if (account) {
    failedAuth.delete(ip);
    return account;
  }
  if (req.headers.authorization) {
    record.count++;
    failedAuth.set(ip, record);
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Ecofitus", charset="UTF-8"', 'Cache-Control': 'no-store' });
  res.end('Acesso administrativo restrito.');
  return null;
}

function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
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
      return true;
    } catch (error) {
      state.error = 'Não foi possível atualizar o catálogo.';
      console.error('Falha ao atualizar catálogo:', error.message);
      return false;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
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
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/admin/')) {
      if (req.headers.origin && req.headers.origin === allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        if (req.headers.origin !== allowedOrigin || !allowedOrigin) return sendJson(res, 403, { error: 'Origem não autorizada.' });
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204);
        return res.end();
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return sendJson(res, 200, {
        products: state.products, updatedAt: state.updatedAt,
        stale: Boolean(state.error) || !state.updatedAt || Date.now() - state.updatedAt > MAX_AGE_MS,
        error: state.error,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/order') {
      if (!adminUsers.length) return sendJson(res, 503, { error: 'Histórico de pedidos não configurado. Entre em contato com a equipe comercial.' });
      let input, representative, company, message, order;
      try {
        input = await readJson(req);
        if (!input || typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) throw new Error('Identificador de pedido inválido.');
        representative = getRepresentative(input.representativeId);
        if (refreshInFlight) await refreshInFlight;
        if (!await refresh()) throw new Error('Não foi possível atualizar os preços. Tente novamente.');
        buildOrder(input, state.products, state.updatedAt, 'Aguardando consulta');
        company = await lookupCompany(input.cnpj);
        const now = Date.now();
        message = buildOrder(input, state.products, state.updatedAt, company.name, now);
        order = calculateOrder({ ...input, campaigns: input.campaigns === undefined ? [] : input.campaigns }, state.products, now);
        verifyPriceQuote(input, order);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
      try {
        const createdAt = new Date().toISOString();
        const fullMessage = `${message}\nNúmero do pedido: ${input.id}\nPreparado em: ${new Date(createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
        const saved = await saveOrder(ordersPath, input.id, {
          representativeId: representative.id, representativeName: representative.name,
          createdAt, cnpj: company.cnpj, companyName: company.name,
          terms: input.terms.trim(), ...order, message: fullMessage,
        }, fingerprint(input));
        const owner = getRepresentative(saved.representativeId);
        return sendJson(res, 200, { id: saved.id, url: `https://wa.me/${owner.whatsapp}?text=${encodeURIComponent(saved.message)}` });
      } catch (error) {
        console.error('Falha ao salvar pedido:', error.message);
        return sendJson(res, 500, { error: 'Não foi possível salvar o pedido. Tente novamente ou entre em contato com a equipe comercial.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/company') {
      try {
        const input = await readJson(req);
        return sendJson(res, 200, await lookupCompany(input && input.cnpj));
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const orders = (await listOrders(ordersPath)).filter((order) =>
        (order.representativeId || 'gabriel') === account.representativeId);
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
        return sendJson(res, 400, { error: 'Período inválido.' });
      }
      const filtered = orders.filter((order) => {
        const date = order.createdAt.slice(0, 10);
        return (!start || date >= start) && (!end || date <= end);
      });
      return sendJson(res, 200, {
        representative: { id: account.representativeId, name: getRepresentative(account.representativeId).name },
        orders: filtered,
        totalCents: filtered.reduce((total, order) => total + order.totalCents, 0),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/me') {
      const account = requireAdmin(req, res);
      if (!account) return;
      return sendJson(res, 200, { representative: { id: account.representativeId, name: getRepresentative(account.representativeId).name } });
    }
    const adminOrderMatch = /^\/api\/admin\/orders\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (req.method === 'PUT' && adminOrderMatch) {
      const account = requireAdmin(req, res);
      if (!account) return;
      try {
        const updated = await updateOrder(ordersPath, adminOrderMatch[1], account.representativeId, await readJson(req));
        return sendJson(res, 200, { order: updated });
      } catch (error) {
        const status = /não pertence/.test(error.message) || error.code === 'ENOENT' ? 404 : 400;
        return sendJson(res, status, { error: status === 404 ? 'Pedido não encontrado.' : error.message });
      }
    }
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin.js')) {
      if (!requireAdmin(req, res)) return;
      const file = url.pathname === '/admin' ? 'index.html' : 'admin.js';
      const content = await fs.readFile(path.join(__dirname, 'admin', file));
      res.writeHead(200, {
        'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      return res.end(content);
    }
    if (req.method === 'GET' && assets[url.pathname]) {
      const [file, type] = assets[url.pathname];
      const content = await fs.readFile(path.join(__dirname, 'public', file));
      res.writeHead(200, {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self' https://script.google.com https://*.googleusercontent.com; frame-src https://script.google.com https://*.googleusercontent.com; base-uri 'none'; form-action 'self' https://script.google.com https://*.googleusercontent.com; frame-ancestors 'none'",
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
    adminUsers = JSON.parse(await fs.readFile(adminUsersPath, 'utf8'));
    if (!Array.isArray(adminUsers) || !adminUsers.every((user) =>
      user && typeof user.email === 'string' && typeof user.representativeId === 'string' &&
      typeof user.salt === 'string' && typeof user.passwordHash === 'string')) {
      throw new Error('Formato inválido.');
    }
    for (const user of adminUsers) getRepresentative(user.representativeId);
  } catch (error) {
    adminUsers = [];
    if (error.code !== 'ENOENT') console.error('Configuração administrativa inválida:', error.message);
  }
  if (!adminUsers.length) console.warn('Arquivo de usuários administrativos ausente ou inválido: pedidos e histórico estarão indisponíveis.');
  if (allowedOrigin) {
    const origin = new URL(allowedOrigin);
    if (origin.origin !== allowedOrigin || (origin.protocol !== 'https:' && origin.hostname !== 'localhost' && origin.hostname !== '127.0.0.1')) {
      throw new Error('ALLOWED_ORIGIN deve ser uma origem HTTPS exata, sem caminho ou barra final.');
    }
  }
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (Array.isArray(cached.products) && cached.products.every((product) => Array.isArray(product.promotions)) && Number.isFinite(cached.updatedAt)) {
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
