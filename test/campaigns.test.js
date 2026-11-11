'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getCampaign } = require('../public/campaigns');
const { calculateOrder, buildOrder } = require('../catalog');
const { fingerprint } = require('../orders');

const products = [
  { id: 'b12', ean: '7896920307922', name: 'B12', stock: 300, multiple: 1, priceCents: 2454 },
  { id: 'q10', ean: '7896920308523', name: 'Q10', stock: 100, multiple: 1, priceCents: 4571 },
  { id: 'milmune', ean: '7896920305140', name: 'Milmune', stock: 100, multiple: 1, priceCents: 1035 },
  { id: 'regulax', ean: '7896920303979', name: 'Regulax', stock: 24, multiple: 1, priceCents: 1912 },
];
const input = { cnpj: '23624691000108', terms: '28 dias', items: [], campaigns: [] };
test('exemplos calculam valores, incluindo preços anunciados e bonificações', () => {
  assert.equal(getCampaign('b12-pix', products).totalCents, 490800);
  assert.equal(getCampaign('barril-chopp', products).totalCents, 89964);
  assert.equal(getCampaign('q10-b12', products).totalCents, 133170);
  assert.equal(getCampaign('regulax', products).totalCents, 22944);
  assert.equal(getCampaign('show-brindes', products).totalCents, 39264);
  const result = calculateOrder({ ...input, campaigns: ['regulax'] }, products);
  assert.equal(result.campaigns[0].items[0].bonus, 12);
});
test('verifica estoque agregado entre campanhas, itens e bonificações', () => {
  const low = products.map((p) => p.id === 'regulax' ? { ...p, stock: 23 } : p);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['regulax'] }, low), /indisponíveis/);
  assert.throws(() => calculateOrder({ ...input, items: [{ id: 'b12', quantity: 265 }], campaigns: ['barril-chopp'] }, products), /indisponíveis/);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['b12-pix', 'b12-pix'] }, products), /duplicada/);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['inexistente'] }, products), /inválida/);
});
test('pedido e histórico recebem campanha e valores calculados no servidor', () => {
  const order = { ...input, campaigns: ['barril-chopp'] };
  const message = buildOrder(order, products, Date.now(), 'Empresa');
  assert.match(message, /barril de chopp/i);
  assert.match(message, /899,64/);
  assert.match(message, /sujeito à confirmação comercial/i);
  assert.notEqual(fingerprint(order), fingerprint({ ...input, campaigns: ['b12-pix'] }));
});
