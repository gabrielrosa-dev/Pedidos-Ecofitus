'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { saveOrder, listOrders, fingerprint } = require('../orders');

test('salva histórico e reutiliza pedido ao repetir identificador', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ecofitus-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = randomUUID();
  const input = { cnpj: '23.624.691/0001-08', terms: '28 dias', items: [{ id: 'a', quantity: 4 }] };
  const hash = fingerprint(input);
  const saved = await saveOrder(directory, id, { message: 'Pedido completo', createdAt: '2026-01-01T00:00:00.000Z' }, hash);
  const repeated = await saveOrder(directory, id, { message: 'Não deve substituir', createdAt: '2026-01-02T00:00:00.000Z' }, hash);
  assert.deepEqual(repeated, saved);
  await assert.rejects(saveOrder(directory, id, saved, fingerprint({ ...input, terms: '30 dias' })), /outro pedido/);
  const list = await listOrders(directory);
  assert.equal(list.length, 1);
  assert.equal(list[0].message, 'Pedido completo');
  assert.equal(list[0].fingerprint, undefined);
  await assert.rejects(saveOrder(directory, '../invalid', saved, hash), /inválido/);
});
