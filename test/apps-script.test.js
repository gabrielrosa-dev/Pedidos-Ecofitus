'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function fakeAppsScript() {
  const cache = new Map();
  const sheets = new Map();
  let catalogRequests = 0;
  let companyResponseCode = 200;
  const product = { id: 'b12', ean: '7896920307922', name: 'B12', hasImage: true, imageURL: 'https://example.com/product.png', promotions: { sales: [] }, prices: [{ finalPrice: 24.54, quantityAvailable: 500, multiple: 1 }] };
  const context = vm.createContext({
    console, Date, JSON, Number, String, Array, Math, Error, encodeURIComponent,
    CacheService: { getScriptCache: () => ({
      get: (key) => cache.get(key), put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url) => {
      if (url.includes('brasilapi')) return { getResponseCode: () => companyResponseCode, getContentText: () => JSON.stringify({ cnpj: '23624691000108', razao_social: 'Empresa teste' }) };
      catalogRequests++;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ pagina: 0, totalPaginas: 1, products: [product] }) };
    } },
    SpreadsheetApp: { openById: () => ({
      getSheetByName: (name) => sheets.get(name),
      insertSheet: (name) => {
        const sheet = { rows: [], appendRow(row) { this.rows.push(row); }, getLastRow() { return this.rows.length; },
          getRange(row, col, count = 1, columns = 1) { return {
            getValue: () => this.rows[row - 1][col - 1],
            getValues: () => this.rows.slice(row - 1, row - 1 + count).map((r) => r.slice(col - 1, col - 1 + columns)),
            setValues: (values) => values.forEach((next, offset) => {
              this.rows[row - 1 + offset].splice(col - 1, columns, ...next);
            }),
          }; } };
        sheets.set(name, sheet); return sheet;
      },
    }), flush() {} },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, newBlob: (value) => ({ getBytes: () => Buffer.from(value, 'utf8') }), computeDigest: (_, value) => Array.from(crypto.createHash('sha256').update(value).digest()), formatDate: () => '01/01/2026, 12:00:00' },
    HtmlService: { XFrameOptionsMode: { ALLOWALL: 'allow' }, createHtmlOutput: (html) => ({ html, setXFrameOptionsMode() { return this; } }) },
    ContentService: { MimeType: { JAVASCRIPT: 'js' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
  });
  for (const file of ['Campaigns.gs', 'Catalog.gs', 'Code.gs']) {
    let source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', file), 'utf8');
    if (file === 'Code.gs') source = source.replace("'COLE_O_ID_DA_PLANILHA_AQUI';", "'planilha-teste';").replace("SPREADSHEET_ID === 'COLE_O_ID_DA_PLANILHA_AQUI'", "SPREADSHEET_ID === 'não-configurada'");
    vm.runInContext(source, context);
  }
  return { context, cache, sheets, product, getCatalogRequests: () => catalogRequests,
    setCompanyResponseCode: (code) => { companyResponseCode = code; } };
}

test('Apps Script usa fallback quando a BrasilAPI não encontra ou não disponibiliza a razão social', () => {
  const app = fakeAppsScript();
  const request = () => app.context.doPost({ parameter: {
    nonce: '68b36a0a-27a7-4eaf-870b-231e6cfef229',
    payload: JSON.stringify({ action: 'company', cnpj: '23624691000108' }),
  } }).html;
  app.setCompanyResponseCode(503);
  assert.match(request(), /Razão social não localizada/);
  app.setCompanyResponseCode(404);
  assert.match(request(), /Razão social não localizada/);
});

test('Apps Script atualiza catálogo e salva pedido idempotente na planilha', () => {
  const app = fakeAppsScript();
  app.context.setup();
  assert.equal(app.getCatalogRequests(), 0);
  const callback = 'ecofitusCallback_abcdef0123';
  const output = app.context.doGet({ parameter: { callback } }).text;
  assert.ok(output.startsWith(callback + '('));
  assert.match(output, /https:\/\/example\.com\/product\.png/);
  assert.match(output, /"ok":true/);
  assert.equal(app.getCatalogRequests(), 1);
  const expired = JSON.parse(app.cache.get('catalog-v2'));
  expired.updatedAt = Date.now() - 30001;
  app.cache.set('catalog-v2', JSON.stringify(expired));
  app.context.doGet({ parameter: { callback } });
  assert.equal(app.getCatalogRequests(), 2);
  assert.equal(app.context.doGet({ parameter: { callback: 'alert(1)' } }).text, 'Requisição inválida.');
  const id = '68b36a0a-27a7-4eaf-870b-231e6cfef229';
  const order = { id, representativeId: 'gabriel', cnpj: '23624691000108', terms: '28 dias', items: [], campaigns: ['b12-pix'],
    priceQuote: { items: [], campaigns: [{ id: 'b12-pix', items: [{ id: 'b12', priceCents: 2454 }] }] } };
  const request = { parameter: { nonce: '68b36a0a-27a7-4eaf-870b-231e6cfef229', payload: JSON.stringify({ action: 'order', order }) } };
  app.setCompanyResponseCode(503);
  const result = app.context.doPost(request).html;
  assert.match(result, /wa\.me/);
  assert.equal(app.sheets.get('Pedidos').rows.length, 2);
  const row = app.sheets.get('Pedidos').rows[1];
  assert.equal(row[4], '28 dias');
  assert.equal(row[7], 4908);
  assert.equal(JSON.parse(row[9]).campaigns[0].id, 'b12-pix');
  assert.equal(JSON.parse(row[9]).representativeId, 'gabriel');
  assert.equal(row[10], 'Gabriel');
  app.context.doPost(request);
  assert.equal(app.sheets.get('Pedidos').rows.length, 2);
});

test('Apps Script consulta preços novamente e bloqueia pedido com valor alterado', () => {
  const app = fakeAppsScript();
  app.context.setup();
  app.context.catalog_();
  app.product.prices[0].finalPrice = 30;
  const order = { id: '68b36a0a-27a7-4eaf-870b-231e6cfef229', representativeId: 'vanderson', cnpj: '23624691000108',
    terms: '28 dias', items: [{ id: 'b12', quantity: 3 }], campaigns: [],
    priceQuote: { items: [{ id: 'b12', priceCents: 2454 }], campaigns: [] } };
  const response = app.context.doPost({ parameter: { nonce: order.id, payload: JSON.stringify({ action: 'order', order }) } }).html;
  assert.match(response, /preços mudaram/);
  assert.equal(app.getCatalogRequests(), 2);
  assert.equal(app.sheets.get('Pedidos').rows.length, 1);
});

test('verificação de configuração exige a aba de pedidos e consulta o catálogo', () => {
  const app = fakeAppsScript();
  assert.throws(() => app.context.checkSetup(), /Execute setup/);
  app.context.setup();
  app.context.checkSetup();
  assert.equal(app.getCatalogRequests(), 1);
});

test('Apps Script autentica representante e isola, filtra e edita histórico', () => {
  const app = fakeAppsScript();
  app.context.setup();
  const representatives = app.sheets.get('Representantes');
  const hash = (salt, password) => crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  representatives.appendRow(['gabriel030203.gb@gmail.com', 'gabriel', 'salt-g', hash('salt-g', 'Gabriel.rosa')]);
  representatives.appendRow(['vanderson79rosa@gmail.com', 'vanderson', 'salt-v', hash('salt-v', 'Vanderson.rosa')]);
  const orders = app.sheets.get('Pedidos');
  const order = {
    id: '68b36a0a-27a7-4eaf-870b-231e6cfef229',
    createdAt: '2026-11-10T12:00:00.000Z',
    representativeId: 'gabriel', cnpj: '23624691000108',
    companyName: 'Empresa antiga', terms: '28 dias',
    items: [{ id: 'b12', ean: '789', name: 'Produto antigo', quantity: 2, priceCents: 3000 }],
    campaigns: [], totalCents: 6000, message: 'Espelho antigo',
  };
  orders.appendRow([order.id, order.createdAt, order.cnpj, order.companyName, order.terms, '2x Produto antigo', '', 60, order.message, JSON.stringify(order), 'Gabriel']);
  const payload = (action, extra) => JSON.stringify({ action, auth: { email: 'gabriel030203.gb@gmail.com', password: 'Gabriel.rosa' }, ...extra });
  const responseJson = (html) => JSON.parse(html.slice(
    html.indexOf('postMessage(') + 'postMessage('.length,
    html.indexOf(',"https://gabrielrosa-dev.github.io"')
  ));
  const request = (action, extra) => responseJson(app.context.doPost({
    parameter: { nonce: '68b36a0a-27a7-4eaf-870b-231e6cfef229', payload: payload(action, extra) },
  }).html);
  const listed = request('adminList', { start: '2026-11-01', end: '2026-11-30' });
  assert.equal(listed.data.orders.length, 1);
  assert.equal(listed.data.totalCents, 6000);
  assert.equal(listed.data.commissionCents, 600);
  const changed = request('adminUpdate', {
    orderId: order.id,
    changes: {
      companyName: 'Empresa nova', terms: '30 dias',
      items: [{ id: 'b12', ean: '789', name: 'Produto novo', quantity: 3, priceCents: 2500 }],
      campaigns: [{
        id: 'campanha-teste', title: 'Campanha teste', benefit: 'Brinde sujeito à confirmação',
        items: [{ id: 'b12', ean: '789', name: 'B12', quantity: 2, bonus: 1, priceCents: 2500 }],
      }],
    },
  });
  assert.equal(changed.data.order.totalCents, 12500);
  assert.match(changed.data.order.message, /Produto novo/);
  assert.equal(changed.data.order.campaigns[0].totalCents, 5000);
  const denied = responseJson(app.context.doPost({
    parameter: {
      nonce: '68b36a0a-27a7-4eaf-870b-231e6cfef229',
      payload: JSON.stringify({
        action: 'adminList',
        auth: { email: 'vanderson79rosa@gmail.com', password: 'Vanderson.rosa' },
      }),
    },
  }).html);
  assert.equal(denied.data.orders.length, 0);
});
