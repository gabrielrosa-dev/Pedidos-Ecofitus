'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('consulta o catálogo sem credenciais do navegador', async () => {
  let script;
  const window = { ECOFITUS_SCRIPT_URL: 'https://script.google.com/macros/s/teste/exec' };
  const document = {
    createElement() { return { remove() { this.removed = true; } }; },
    head: { append(element) { script = element; } },
  };
  const context = vm.createContext({
    window, document, URL, crypto: { randomUUID: () => 'abcdef01-2345-6789-abcd-ef0123456789' },
    setTimeout() { return 1; }, clearTimeout() {},
  });

  test('encaminha autenticação administrativa para o Apps Script', async () => {
    let messageHandler;
    const submitted = {};
    const iframe = { remove() {} };
    const inputElements = [];
    const form = {
      remove() {}, append(input) { inputElements.push(input); },
      submit() {
        submitted.payload = JSON.parse(inputElements.find((input) => input.name === 'payload').value);
        messageHandler({
          origin: 'https://script.googleusercontent.com',
          data: { nonce: 'abcdef01-2345-6789-abcd-ef0123456789', ok: true, data: { orders: [] } },
        });
      },
    };
    const window = { ECOFITUS_SCRIPT_URL: 'https://script.google.com/macros/s/teste/exec' };
    const document = {
      createElement(type) { return type === 'iframe' ? iframe : type === 'form' ? form : {}; },
      body: { append() {} },
      head: { append() {} },
    };
    const context = vm.createContext({
      window, document, URL, crypto: { randomUUID: () => 'abcdef01-2345-6789-abcd-ef0123456789' },
      setTimeout() { return 1; }, clearTimeout() {},
    });
    context.window.addEventListener = (name, callback) => { messageHandler = callback; };
    context.window.removeEventListener = () => {};
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'transport.js'), 'utf8'), context);
    const result = await window.ecofitusRequest('/api/admin/orders', {
      auth: { email: 'teste@example.com', password: 'senha' }, start: '', end: '',
    });
    assert.equal(submitted.payload.action, 'adminList');
    assert.equal(submitted.payload.auth.email, 'teste@example.com');
    assert.deepEqual(result, { orders: [] });
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'transport.js'), 'utf8'), context);
  const request = window.ecofitusRequest('/api/catalog');
  assert.equal(script.crossOrigin, 'anonymous');
  const callback = new URL(script.src).searchParams.get('callback');
  window[callback]({ ok: true, data: { products: [] } });
  assert.deepEqual(await request, { products: [] });
  assert.equal(script.removed, true);
  assert.equal(window[callback], undefined);
});

test('encaminha operações de campanhas ao Apps Script autenticado', async () => {
  let messageHandler;
  const requests = [];
  const nonce = 'abcdef01-2345-6789-abcd-ef0123456789';
  const iframe = { remove() {} };
  const inputs = [];
  const form = {
    remove() {},
    append(input) { inputs.push(input); },
    submit() {
      const payload = JSON.parse(inputs.find((input) => input.name === 'payload').value);
      requests.push(payload);
      inputs.length = 0;
      messageHandler({
        origin: 'https://script.googleusercontent.com',
        data: { nonce, ok: true, data: {} },
      });
    },
  };
  const window = { ECOFITUS_SCRIPT_URL: 'https://script.google.com/macros/s/teste/exec' };
  const document = {
    createElement(type) { return type === 'iframe' ? iframe : type === 'form' ? form : {}; },
    body: { append() {} },
  };
  const context = vm.createContext({
    window, document, URL, crypto: { randomUUID: () => nonce },
    setTimeout() { return 1; }, clearTimeout() {},
  });
  window.addEventListener = (_, callback) => { messageHandler = callback; };
  window.removeEventListener = () => {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'transport.js'), 'utf8'), context);
  const auth = { email: 'rep@example.com', password: 'secret' };
  const campaign = { id: 'one', title: 'Campanha', items: [] };
  await window.ecofitusRequest('/api/admin/campaigns', { auth });
  await window.ecofitusRequest('/api/admin/campaigns/save', { auth, campaign });
  await window.ecofitusRequest('/api/admin/campaigns/delete', { auth, campaignId: 'one' });
  await window.ecofitusRequest('/api/admin/campaigns/image', { auth, mimeType: 'image/png', base64: 'AA==' });
  assert.deepEqual(requests.map((request) => request.action), [
    'adminCampaignsList', 'adminCampaignSave', 'adminCampaignDelete', 'adminCampaignImageUpload',
  ]);
  assert.deepEqual(requests[1].campaign, campaign);
  assert.equal(requests[2].campaignId, 'one');
  assert.equal(requests[3].mimeType, 'image/png');
});
