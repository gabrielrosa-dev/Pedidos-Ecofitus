'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupCompany } = require('../registry');

test('consulta CNPJ e usa fallback quando a razão social não está disponível', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async (url) => {
    assert.match(url, /23624691000108$/);
    return { ok: true, json: async () => ({ cnpj: '23624691000108', razao_social: 'Empresa Teste' }) };
  };
  assert.deepEqual(await lookupCompany('23.624.691/0001-08'), { cnpj: '23624691000108', name: 'Empresa Teste' });
  global.fetch = async () => ({ ok: false, status: 404 });
  assert.deepEqual(await lookupCompany('23624691000108'), { cnpj: '23624691000108', name: 'Razão social não localizada' });
  global.fetch = async () => ({ ok: false, status: 503 });
  assert.deepEqual(await lookupCompany('23624691000108'), { cnpj: '23624691000108', name: 'Razão social não localizada' });
  global.fetch = async () => ({ ok: true, json: async () => ({ cnpj: '00000000000000', razao_social: 'Outra' }) });
  assert.deepEqual(await lookupCompany('23624691000108'), { cnpj: '23624691000108', name: 'Razão social não localizada' });
  await assert.rejects(lookupCompany('11111111111111'), /CNPJ válido/);
});
