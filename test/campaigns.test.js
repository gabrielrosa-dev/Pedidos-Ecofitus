'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getCampaign, campaigns, setCampaigns } = require('../public/campaigns');
const { calculateOrder, buildOrder, verifyPriceQuote } = require('../catalog');
const { fingerprint } = require('../orders');

const products = [
  { id: 'b12', ean: '7896920307922', name: 'B12', stock: 300, multiple: 1, priceCents: 2454, promotions: [] },
  { id: 'q10', ean: '7896920308523', name: 'Q10', stock: 100, multiple: 1, priceCents: 4571, promotions: [] },
  { id: 'milmune', ean: '7896920305140', name: 'Milmune', stock: 100, multiple: 1, priceCents: 1035, promotions: [] },
  { id: 'regulax', ean: '7896920303979', name: 'Regulax', stock: 24, multiple: 1, priceCents: 1912, promotions: [] },
  { id: 'queimacure', ean: '7896920307403', name: 'Queimacure', stock: 40, multiple: 1, priceCents: 1661, promotions: [] },
];
const input = { cnpj: '23624691000108', terms: '28 dias', items: [], campaigns: [] };
test('exemplos calculam valores atuais do catálogo e bonificações', () => {
  assert.equal(getCampaign('b12-pix', products).totalCents, 490800);
  assert.equal(getCampaign('barril-chopp', products).totalCents, 88344);
  assert.equal(getCampaign('q10-b12', products).totalCents, 133170);
  assert.equal(getCampaign('regulax', products).totalCents, 22944);
  assert.equal(getCampaign('show-brindes', products).totalCents, 39264);
  const newCampaign = getCampaign('b12-queimacure', products);
  assert.equal(newCampaign.totalCents, 88344);
  assert.equal(newCampaign.lines[1].priceCents, 0);
  assert.equal(newCampaign.lines[1].bonus, 20);
  const result = calculateOrder({ ...input, campaigns: ['regulax'] }, products);
  assert.equal(result.campaigns[0].items[0].bonus, 12);
  const withBonus = calculateOrder({ ...input, campaigns: ['b12-queimacure'] }, products);
  assert.equal(withBonus.campaigns[0].items[1].quantity, 0);
  assert.equal(withBonus.campaigns[0].items[1].bonus, 20);
});
test('verifica estoque agregado entre campanhas, itens e bonificações', () => {
  const low = products.map((p) => p.id === 'regulax' ? { ...p, stock: 23 } : p);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['regulax'] }, low), /indisponíveis/);
  assert.throws(() => calculateOrder({ ...input, items: [{ id: 'b12', quantity: 265 }], campaigns: ['barril-chopp'] }, products), /indisponíveis/);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['b12-pix', 'b12-pix'] }, products), /duplicada/);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['inexistente'] }, products), /inválida/);
  const noBonusStock = products.map((p) => p.id === 'queimacure' ? { ...p, stock: 19 } : p);
  assert.throws(() => calculateOrder({ ...input, campaigns: ['b12-queimacure'] }, noBonusStock), /indisponíveis/);
});
test('pedido e histórico recebem campanha e valores calculados no servidor', () => {
  const order = { ...input, campaigns: ['barril-chopp'] };
  const message = buildOrder(order, products, Date.now(), 'Empresa');
  assert.match(message, /barril de chopp/i);
  assert.match(message, /883,44/);
  assert.match(message, /sujeito à confirmação comercial/i);
  assert.notEqual(fingerprint(order), fingerprint({ ...input, campaigns: ['b12-pix'] }));
});

test('campanhas usam o preço promocional da quantidade paga', () => {
  const now = Date.now();
  const discounted = products.map((p) => p.id === 'b12' ? { ...p, promotions: [
    { priceCents: 2390, taxesConfirmed: true, begin: now - 1000, end: now + 1000, minQuantity: 16, maxQuantity: 40 },
  ] } : p);
  assert.equal(getCampaign('barril-chopp', discounted, now).totalCents, 86040);
  assert.equal(getCampaign('show-brindes', discounted, now).totalCents, 38240);
  assert.equal(getCampaign('show-brindes', discounted, now).lines[0].priceCents, 2390);
});

test('preço definido na campanha prevalece sobre a promoção ativa do catálogo', () => {
  const now = Date.now();
  const promoted = products.map((p) => p.id === 'b12' ? { ...p, promotions: [
    { priceCents: 1900, taxesConfirmed: true, begin: now - 1000, end: now + 1000, minQuantity: 1, maxQuantity: 10 },
  ] } : p);
  const previous = campaigns.slice();
  setCampaigns([{
    id: 'b12-preco-campanha',
    title: 'B12 por preço especial',
    benefit: '',
    items: [{ ean: '7896920307922', quantity: 3, bonus: 0, priceCents: 2390 }],
  }]);
  try {
    const result = calculateOrder({ items: [], campaigns: ['b12-preco-campanha'] }, promoted, now);
    assert.equal(result.campaigns[0].items[0].priceCents, 2390);
    assert.equal(result.totalCents, 7170);
    const quote = { items: [], campaigns: [{
      id: 'b12-preco-campanha',
      items: [{ id: 'b12', priceCents: 2390 }],
    }] };
    assert.doesNotThrow(() => verifyPriceQuote({ priceQuote: quote }, result));
    const message = buildOrder({ ...input, campaigns: ['b12-preco-campanha'] }, promoted, now, 'Empresa', now);
    assert.match(message, /23,90/);
    assert.doesNotMatch(message, /19,00/);
  } finally {
    setCampaigns(previous);
  }
});

test('confirma os preços individuais das campanhas antes de preparar', () => {
  const result = calculateOrder({ items: [], campaigns: ['barril-chopp'] }, products);
  const quote = { items: [], campaigns: [{ id: 'barril-chopp', items: [{ id: 'b12', priceCents: 2454 }] }] };
  assert.doesNotThrow(() => verifyPriceQuote({ priceQuote: quote }, result));
  quote.campaigns[0].items[0].priceCents = 2499;
  assert.throws(() => verifyPriceQuote({ priceQuote: quote }, result), /preços mudaram/);
});
