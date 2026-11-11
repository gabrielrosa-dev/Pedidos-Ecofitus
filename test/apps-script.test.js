'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function fakeAppsScript() {
  const props = {};
  const files = new Map();
  const sheets = new Map();
  let catalogRequests = 0;
  const product = { id: 'b12', ean: '7896920307922', name: 'B12', prices: [{ finalPrice: 24.54, quantityAvailable: 500, multiple: 1 }] };
  const context = vm.createContext({
    console, Date, JSON, Number, String, Array, Math, Error, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => props[key], setProperty: (key, value) => { props[key] = value; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: {
      createFile: () => { const f = { value: '[]', getId: () => 'file', setContent(value) { this.value = value; }, getBlob() { return { getDataAsString: () => this.value }; } }; files.set('file', f); return f; },
      getFileById: (id) => files.get(id),
    },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    UrlFetchApp: { fetch: (url) => {
      if (url.includes('brasilapi')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ cnpj: '23624691000108', razao_social: 'Empresa teste' }) };
      catalogRequests++;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ pagina: 0, totalPaginas: 1, products: [product] }) };
    } },
    SpreadsheetApp: { openById: () => ({
      getSheetByName: (name) => sheets.get(name),
      insertSheet: (name) => {
        const sheet = { rows: [], appendRow(row) { this.rows.push(row); }, getLastRow() { return this.rows.length; },
          getRange(row, col, count = 1) { return { getValue: () => this.rows[row - 1][col - 1], getValues: () => this.rows.slice(row - 1, row - 1 + count).map((r) => [r[col - 1]]) }; } };
        sheets.set(name, sheet); return sheet;
      },
    }), flush() {} },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => Array.from(crypto.createHash('sha256').update(value).digest()), formatDate: () => '01/01/2026, 12:00:00' },
    HtmlService: { XFrameOptionsMode: { ALLOWALL: 'allow' }, createHtmlOutput: (html) => ({ html, setXFrameOptionsMode() { return this; } }) },
    ContentService: { MimeType: { JAVASCRIPT: 'js' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
  });
  for (const file of ['Campaigns.gs', 'Catalog.gs', 'Code.gs']) {
    let source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', file), 'utf8');
    if (file === 'Code.gs') source = source.replace("'COLE_O_ID_DA_PLANILHA_AQUI';", "'planilha-teste';").replace("SPREADSHEET_ID === 'COLE_O_ID_DA_PLANILHA_AQUI'", "SPREADSHEET_ID === 'não-configurada'");
    vm.runInContext(source, context);
  }
  return { context, props, sheets, getCatalogRequests: () => catalogRequests };
}

test('Apps Script atualiza catálogo e salva pedido idempotente na planilha', () => {
  const app = fakeAppsScript();
  app.context.setup();
  assert.equal(app.getCatalogRequests(), 1);
  const callback = 'ecofitusCallback_abcdef0123';
  const output = app.context.doGet({ parameter: { callback } }).text;
  assert.ok(output.startsWith(callback + '('));
  assert.equal(app.getCatalogRequests(), 1);
  app.props.catalogUpdatedAt = String(Date.now() - 300001);
  app.context.doGet({ parameter: { callback } });
  assert.equal(app.getCatalogRequests(), 2);
  assert.equal(app.context.doGet({ parameter: { callback: 'alert(1)' } }).text, 'Requisição inválida.');
  const id = '68b36a0a-27a7-4eaf-870b-231e6cfef229';
  const order = { id, cnpj: '23624691000108', terms: '=28 dias', items: [], campaigns: ['b12-pix'] };
  const request = { parameter: { nonce: '68b36a0a-27a7-4eaf-870b-231e6cfef229', payload: JSON.stringify({ action: 'order', order }) } };
  const result = app.context.doPost(request).html;
  assert.match(result, /wa\.me/);
  assert.equal(app.sheets.get('Pedidos').rows.length, 2);
  const row = app.sheets.get('Pedidos').rows[1];
  assert.equal(row[4], "'=28 dias");
  assert.equal(row[7], 4908);
  assert.equal(JSON.parse(row[9]).campaigns[0].id, 'b12-pix');
  app.context.doPost(request);
  assert.equal(app.sheets.get('Pedidos').rows.length, 2);
});
