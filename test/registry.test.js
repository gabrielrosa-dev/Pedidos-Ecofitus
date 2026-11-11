'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupCompany } = require('../registry');

test('consulta CNPJ e valida razão social retornada', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async (url) => {
    assert.match(url, /23624691000108$/);
    return { ok: true, json: async () => ({ cnpj: '23624691000108', razao_social: 'Empresa Teste' }) };
  };
  assert.deepEqual(await lookupCompany('23.624.691/0001-08'), { cnpj: '23624691000108', name: 'Empresa Teste' });
  global.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(lookupCompany('23624691000108'), /não encontrado/);
  global.fetch = async () => ({ ok: true, json: async () => ({ cnpj: '00000000000000', razao_social: 'Outra' }) });
  await assert.rejects(lookupCompany('23624691000108'), /razão social válida/);
  await assert.rejects(lookupCompany('11111111111111'), /CNPJ válido/);
});
