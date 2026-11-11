'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCatalog, validCnpj, buildOrder, MAX_AGE_MS } = require('../catalog');

const raw = { products: [{ id: 'a', name: 'Produto', ean: '123', maker: 'Ecofitus', prices: [{ finalPrice: 12.50, quantityAvailable: 10, multiple: 2 }] }] };
const products = normalizeCatalog(raw);
const order = { cnpj: '23.624.691/0001-08', terms: '28 dias', items: [{ id: 'a', quantity: 4 }] };
const now = Date.now();

test('normaliza preço final, estoque e múltiplo', () => {
  assert.equal(products[0].priceCents, 1250);
  assert.equal(products[0].multiple, 2);
  assert.throws(() => normalizeCatalog({ products: [{ ...raw.products[0], prices: [] }] }), /múltiplas tabelas/);
});
test('valida CNPJ, incluindo dígitos verificadores', () => {
  assert.equal(validCnpj(order.cnpj), true);
  assert.equal(validCnpj('23.624.691/0001-09'), false);
  assert.equal(validCnpj('11.111.111/1111-11'), false);
});
test('aceita exatamente R$ 50 e calcula o total pelo catálogo', () => {
  const message = buildOrder({ ...order, total: 1 }, products, now, now);
  assert.match(message, /Total: R\$ 50,00/);
  assert.match(message, /Prazo informado: 28 dias/);
});
test('recusa mínimo não atingido e estoque ou múltiplo inválidos', () => {
  assert.throws(() => buildOrder({ ...order, items: [{ id: 'a', quantity: 2 }] }, products, now, now), /mínimo/);
  for (const quantity of [3, 12, 0, -2, 1.5]) {
    assert.throws(() => buildOrder({ ...order, items: [{ id: 'a', quantity }] }, products, now, now), /quantidades inválidas/);
  }
  assert.throws(() => buildOrder({ ...order, items: [{ id: 'a', quantity: 4 }, { id: 'a', quantity: 4 }] }, [...products, products[0]], now, now), /quantidades inválidas/);
});
test('recusa catálogo antigo e dados inválidos', () => {
  assert.throws(() => buildOrder(order, products, now - MAX_AGE_MS - 1, now), /desatualizado/);
  assert.throws(() => buildOrder({ ...order, cnpj: '123' }, products, now, now), /CNPJ/);
  assert.throws(() => buildOrder({ ...order, terms: '28 dias\noutro' }, products, now, now), /prazo/);
});
