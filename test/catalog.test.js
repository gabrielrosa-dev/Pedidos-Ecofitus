'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCatalog, validCnpj, buildOrder, calculateOrder, verifyPriceQuote, MAX_AGE_MS } = require('../catalog');
const { unitPrice } = require('../public/pricing');

const raw = { products: [{ id: 'a', name: 'Produto', ean: '123', maker: 'Ecofitus', promotions: { sales: [] }, prices: [{ finalPrice: 12.50, quantityAvailable: 10, multiple: 2 }] }] };
const products = normalizeCatalog(raw);
const order = { cnpj: '23.624.691/0001-08', terms: '28 dias', items: [{ id: 'a', quantity: 4 }] };
const now = Date.now();

test('normaliza preço final, estoque e múltiplo', () => {
  assert.equal(products[0].priceCents, 1250);
  assert.equal(products[0].multiple, 2);
  assert.throws(() => normalizeCatalog({ products: [{ ...raw.products[0], prices: [] }] }), /múltiplas tabelas/);
});
test('aceita imagens HTTPS e rejeita endereços inválidos', () => {
  const product = { ...raw.products[0], hasImage: true, imageURL: 'https://example.com/produto.png' };
  assert.equal(normalizeCatalog({ products: [product] })[0].image, product.imageURL);
  assert.equal(normalizeCatalog({ products: [{ ...product, imageURL: 'http://example.com/produto.png' }] })[0].image, '');
  for (const imageURL of ['https://', 'https://example.com\\@evil.com/image', 'https://example.com:99999/image']) {
    assert.throws(() => normalizeCatalog({ products: [{ ...product, imageURL }] }), /Imagem inválida/);
  }
});
test('valida CNPJ, incluindo dígitos verificadores', () => {
  assert.equal(validCnpj(order.cnpj), true);
  assert.equal(validCnpj('23.624.691/0001-09'), false);
  assert.equal(validCnpj('11.111.111/1111-11'), false);
});
test('aceita exatamente R$ 50 e calcula o total pelo catálogo', () => {
  const message = buildOrder({ ...order, total: 1 }, products, now, 'Empresa Teste', now);
  assert.match(message, /Total: R\$ 50,00/);
  assert.match(message, /Prazo informado: 28 dias/);
  assert.match(message, /Razão social: Empresa Teste/);
});
test('recusa mínimo não atingido e estoque ou múltiplo inválidos', () => {
  assert.throws(() => buildOrder({ ...order, items: [{ id: 'a', quantity: 2 }] }, products, now, 'Empresa Teste', now), /mínimo/);
  for (const quantity of [3, 12, 0, -2, 1.5]) {
    assert.throws(() => buildOrder({ ...order, items: [{ id: 'a', quantity }] }, products, now, 'Empresa Teste', now), /quantidades inválidas/);
  }
  assert.throws(() => buildOrder({ ...order, items: [{ id: 'a', quantity: 4 }, { id: 'a', quantity: 4 }] }, [...products, products[0]], now, 'Empresa Teste', now), /quantidades inválidas/);
});
test('recusa catálogo antigo e dados inválidos', () => {
  assert.throws(() => buildOrder(order, products, now - MAX_AGE_MS - 1, 'Empresa Teste', now), /desatualizado/);
  assert.throws(() => buildOrder({ ...order, cnpj: '123' }, products, now, 'Empresa Teste', now), /CNPJ/);
  assert.throws(() => buildOrder({ ...order, terms: '28 dias\noutro' }, products, now, 'Empresa Teste', now), /prazo/);
  assert.throws(() => buildOrder(order, products, now, '', now), /razão social/);
});

test('aplica preço final promocional conforme a faixa e a validade', () => {
  const sale = { price: 8, taxes: 2, finalPrice: 10, taxesSuccess: true, begin: now - 1000, end: now + 1000,
    minQuantity: 4, maxQuantity: 6, promotionCartLimit: 0, promotionClientLimit: 0, promotionSellerLimit: 0 };
  const catalog = normalizeCatalog({ products: [{ ...raw.products[0], promotions: { sales: [sale] } }] });
  assert.equal(calculateOrder({ ...order, items: [{ id: 'a', quantity: 6 }], campaigns: [] }, catalog, now).totalCents, 6000);
  assert.equal(calculateOrder({ ...order, items: [{ id: 'a', quantity: 4 }], campaigns: [] }, catalog, now + 1000).totalCents, 5000);
  assert.equal(calculateOrder({ ...order, items: [{ id: 'a', quantity: 8 }], campaigns: [] }, catalog, now).totalCents, 10000);
  assert.equal(unitPrice(catalog[0], 4, sale.begin - 1).priceCents, 1250);
  assert.equal(unitPrice(catalog[0], 4, sale.begin).priceCents, 1000);
  assert.equal(unitPrice(catalog[0], 6, sale.end - 1).priceCents, 1000);
  assert.equal(unitPrice(catalog[0], 6, sale.end).priceCents, 1250);
});

test('mantém promoções sobrepostas e aplica a mais recente da Nexfar', () => {
  const sale = { finalPrice: 10, taxesSuccess: true, begin: now - 1000, end: now + 1000,
    minQuantity: 1, maxQuantity: 10, promotionCartLimit: 0, promotionClientLimit: 0, promotionSellerLimit: 0,
    promotionId: 10 };
  const product = raw.products[0];
  const catalog = normalizeCatalog({ products: [{ ...product, promotions: { sales: [
    sale, { ...sale, begin: now - 500, finalPrice: 9, promotionId: 11 },
  ] } }] });
  assert.equal(catalog[0].promotions.length, 2);
  assert.equal(unitPrice(catalog[0], 1, now).priceCents, 900);
  assert.throws(() => unitPrice({ ...catalog[0], promotions: [
    catalog[0].promotions[0], { ...catalog[0].promotions[0], priceCents: 900 },
  ] }, 1, now), /conflitantes/);
});

test('recusa limites promocionais não suportados', () => {
  const sale = { finalPrice: 10, taxesSuccess: true, begin: now - 1000, end: now + 1000,
    minQuantity: 1, maxQuantity: 10, promotionCartLimit: 0, promotionClientLimit: 0, promotionSellerLimit: 0 };
  const product = raw.products[0];
  assert.throws(() => normalizeCatalog({ products: [{ ...product, promotions: { sales: [{ ...sale, promotionClientLimit: 1 }] } }] }), /não suportadas/);
  assert.throws(() => normalizeCatalog({ products: [{ ...product, promotions: {} }] }), /Promoções inválidas/);
});

test('impede salvar pedido com preços diferentes dos apresentados', () => {
  const calculated = calculateOrder({ ...order, campaigns: [] }, products, now);
  const input = { priceQuote: { items: [{ id: 'a', priceCents: 1250 }], campaigns: [] } };
  assert.doesNotThrow(() => verifyPriceQuote(input, calculated));
  assert.throws(() => verifyPriceQuote({ priceQuote: { items: [{ id: 'a', priceCents: 1000 }], campaigns: [] } }, calculated), /preços mudaram/);
  assert.throws(() => verifyPriceQuote({}, calculated), /preços mudaram/);
});

test('aceita somente prazos cadastrados', () => {
  assert.doesNotThrow(() => buildOrder(order, products, now, 'Empresa Teste', now));
  assert.throws(() => buildOrder({ ...order, terms: '28 dias (pedido mínimo R$ 300,00)' }, products, now, 'Empresa Teste', now), /prazo válido/);
});
