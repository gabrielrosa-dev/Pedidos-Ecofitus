'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.classList = { toggle() {}, contains() { return false; } };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrollOptions = options; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
  dispatch(type) { this.listeners[type]({ target: this }); }
}

async function storefront(storage = new Map()) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };
  get('sort').value = 'name';
  const products = [
    { id: 'abc123', name: 'Óleo de teste', ean: '789000', maker: 'Ecofitus', image: 'https://example.com/oil.png', priceCents: 3000, taxesConfirmed: true, stock: 12, multiple: 3, promotions: [] },
    { id: 'out', name: 'Indisponível', ean: '789001', maker: 'Ecofitus', priceCents: 1000, taxesConfirmed: true, stock: 0, multiple: 1, promotions: [] },
  ];
  const snapshot = { products, updatedAt: 123, stale: false, error: null };
  const document = {
    getElementById: get, createElement: () => new Element(), querySelectorAll: () => [],
    addEventListener() {}, body: new Element(),
  };
  const context = vm.createContext({
    location: { search: '?representante=gabriel' },
    document, console, crypto: { randomUUID: () => 'test-id' }, localStorage,
    window: {
      ecofitusRequest: async () => snapshot,
      EcofitusCampaigns: { campaigns: [] },
      EcofitusPricing: require('../public/pricing'),
      EcofitusRepresentatives: require('../public/representatives'),
      EcofitusTerms: require('../public/terms'),
    },
    setInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { context, get, products, snapshot };
}

test('carrinho permanece após recarregar e atualizar o catálogo', async () => {
  const storage = new Map();
  const first = await storefront(storage);
  first.context.addProduct(first.products[0]);
  assert.equal(first.get('cart-count').textContent, '3');

  const reloaded = await storefront(storage);
  assert.equal(reloaded.get('cart-count').textContent, '3');
  assert.equal(reloaded.get('cart-items').children[0].children[1].children[1].value, '3');
  await reloaded.context.loadCatalog();
  assert.equal(reloaded.get('cart-count').textContent, '3');
});

test('busca ignora acentos e encontra ID; filtro mantém apenas disponíveis', async () => {
  const { get } = await storefront();
  get('search').value = 'oleo';
  get('search').dispatch('input');
  assert.equal(get('products').children.length, 1);
  get('search').value = 'abc123';
  get('search').dispatch('input');
  assert.equal(get('products').children.length, 1);
  get('search').value = '';
  get('available-only').checked = true;
  get('available-only').dispatch('change');
  assert.equal(get('products').children.length, 1);
});

test('botão de promoções filtra apenas ofertas ativas', async () => {
  const { context, get, products, snapshot } = await storefront();
  products[0].promotions = [{
    priceCents: 2000, taxesConfirmed: true, begin: 100, end: 500,
    minQuantity: 1, maxQuantity: 10,
  }];
  snapshot.updatedAt++;
  await context.loadCatalog();
  get('promotion-filter').dispatch('click');
  assert.equal(get('promotion-filter')['aria-pressed'], 'true');
  assert.equal(get('products').children.length, 1);
  get('promotion-filter').dispatch('click');
  assert.equal(get('promotion-filter')['aria-pressed'], 'false');
  assert.equal(get('products').children.length, 2);
});

test('quantidade digitada respeita múltiplo e estoque e pode ser removida', async () => {
  const { context, get, products } = await storefront();
  context.addProduct(products[0]);
  const controls = () => get('cart-items').children[0].children[1];
  let input = controls().children[1];
  input.value = '6';
  input.dispatch('change');
  assert.equal(get('cart-count').textContent, '6');
  input = controls().children[1];
  input.value = '7';
  input.dispatch('change');
  assert.equal(input.value, '6');
  assert.match(get('cart-items').children[0].children[0].children[2].textContent, /múltiplo/);
  input.value = '15';
  input.dispatch('change');
  assert.equal(get('cart-count').textContent, '6');
  get('cart-items').children[0].children[0].children[3].dispatch('click');
  assert.equal(get('cart-count').textContent, '0');
});

test('atualização sem mudanças não interrompe edição da quantidade', async () => {
  const { context, get, products } = await storefront();
  context.addProduct(products[0]);
  const input = get('cart-items').children[0].children[1].children[1];
  input.value = '9';
  await context.loadCatalog();
  assert.equal(get('cart-items').children[0].children[1].children[1], input);
  assert.equal(input.value, '9');
});

test('cartão mostra quantidade e subtotal avulso e acompanha alterações no carrinho', async () => {
  const { context, get, products, snapshot } = await storefront();
  get('search').value = 'oleo';
  get('search').dispatch('input');
  const summary = () => get('products').children[0].children[1].children.slice(-1)[0];
  assert.equal(summary().hidden, true);
  context.addProduct(products[0]);
  assert.match(summary().children[0].textContent, /Avulsos: 3 un\..*90,00/);
  context.addProduct(products[0]);
  assert.match(summary().children[0].textContent, /Avulsos: 6 un\..*180,00/);
  const input = get('cart-items').children[0].children[1].children[1];
  input.value = '9';
  input.dispatch('change');
  assert.match(summary().children[0].textContent, /Avulsos: 9 un\..*270,00/);
  products[0].priceCents = 4000;
  snapshot.updatedAt++;
  await context.loadCatalog();
  assert.match(summary().children[0].textContent, /Avulsos: 9 un\..*360,00/);
  get('cart-items').children[0].children[0].children[3].dispatch('click');
  assert.equal(summary().hidden, true);
});

test('controles do cartão alteram e removem quantidade, respeitando múltiplo e estoque', async () => {
  const { context, get, products } = await storefront();
  get('search').value = 'oleo';
  get('search').dispatch('input');
  context.addProduct(products[0]);
  const summary = get('products').children[0].children[1].children.slice(-1)[0];
  const [minus, input, plus] = summary.children[1].children;
  plus.dispatch('click');
  assert.equal(get('cart-count').textContent, '6');
  input.value = '9';
  input.dispatch('change');
  assert.equal(get('cart-count').textContent, '9');
  input.value = '7';
  input.dispatch('change');
  assert.equal(input.value, '9');
  assert.match(summary.children[2].textContent, /múltiplo/);
  input.value = '15';
  input.dispatch('change');
  assert.equal(input.value, '9');
  assert.match(summary.children[2].textContent, /estoque/);
  minus.dispatch('click');
  assert.equal(get('cart-count').textContent, '6');
  input.value = '0';
  input.dispatch('change');
  assert.equal(get('cart-count').textContent, '0');
  assert.equal(summary.hidden, true);
});

test('adicionar produto não coloca foco no campo de quantidade', async () => {
  const { get } = await storefront();
  get('search').value = 'oleo';
  get('search').dispatch('input');
  const info = get('products').children[0].children[1];
  const button = info.children.slice(-2)[0].children[1];
  const [minus, input] = info.children.slice(-1)[0].children[1].children;
  button.dispatch('click');
  assert.equal(get('cart-count').textContent, '3');
  assert.equal(input.focused, undefined);
  assert.equal(minus.focused, true);
});

test('quantidade no cartão considera itens de campanhas e não é interrompida por atualização igual', async () => {
  const { context, get, products } = await storefront();
  get('search').value = 'oleo';
  get('search').dispatch('input');
  context.window.EcofitusCampaigns.getCampaign = () => ({
    title: 'Teste', benefit: '', totalCents: 0,
    lines: [{ product: products[0], quantity: 3, bonus: 3, priceCents: 3000 }],
  });
  vm.runInContext("selectedCampaigns.add('teste')", context);
  context.addProduct(products[0]);
  const summary = get('products').children[0].children[1].children.slice(-1)[0];
  const input = summary.children[1].children[1];
  input.value = '9';
  await context.loadCatalog();
  assert.equal(summary.children[1].children[1], input);
  assert.equal(input.value, '9');
  input.dispatch('change');
  assert.match(summary.children[2].textContent, /estoque/);
  input.value = '6';
  input.dispatch('change');
  assert.match(summary.children[0].textContent, /Avulsos: 6 un\..*180,00/);
  assert.equal(get('cart-count').textContent, '12');
});

test('preços promocionais acompanham a quantidade e são enviados na cotação', async () => {
  const { context, get, products, snapshot } = await storefront();
  products[0].promotions = [{ priceCents: 2000, taxesConfirmed: true, begin: 100, end: 500, minQuantity: 6, maxQuantity: 12 }];
  snapshot.updatedAt++;
  await context.loadCatalog();
  context.addProduct(products[0]);
  context.addProduct(products[0]);
  assert.match(get('cart-total').textContent, /120,00/);
  let submitted;
  context.window.ecofitusRequest = async (path, body) => {
    if (path === '/api/company') return { cnpj: '12345678901234', name: 'Empresa teste' };
    if (path === '/api/order') { submitted = body; return { url: 'https://example.com' }; }
    return snapshot;
  };
  get('cnpj').value = '12345678901234';
  await get('order-form').listeners.submit({ preventDefault() {} });
  assert.equal(submitted.items[0].quantity, 6);
  assert.equal(submitted.priceQuote.items[0].priceCents, 2000);
  assert.equal(submitted.priceQuote.campaigns.length, 0);
  assert.equal(get('whatsapp-link').hidden, false);
  assert.equal(submitted.representativeId, 'gabriel');
});

test('banner fixo ativa o filtro Black Friday e leva ao catálogo', async () => {
  const { get } = await storefront();
  get('black-friday-banner').dispatch('click');
  assert.equal(get('promotion-filter')['aria-pressed'], 'true');
  assert.equal(get('produtos').scrollOptions.block, 'start');
});

test('representante é definido pelo link distribuído', () => {
  const representatives = require('../public/representatives');
  assert.equal(representatives.representativeFromSearch('?representante=gabriel').whatsapp, '5541995922369');
  assert.equal(representatives.representativeFromSearch('?representante=vanderson').whatsapp, '5541988604367');
  assert.throws(() => representatives.representativeFromSearch(''), /link enviado/);
  assert.throws(() => representatives.representativeFromSearch('?representante=outro'), /link enviado/);
});

test('cartão destaca o menor preço ativo e explica a condição', async () => {
  const { context, get, products, snapshot } = await storefront();
  products[0].promotions = [
    { priceCents: 2500, taxesConfirmed: true, begin: 100, end: 500, minQuantity: 3, maxQuantity: 5, promotionTitle: 'Leve mais' },
    { priceCents: 1800, taxesConfirmed: true, begin: 100, end: 500, minQuantity: 9, maxQuantity: 9999, promotionTitle: 'Atacado' },
  ];
  snapshot.updatedAt++;
  await context.loadCatalog();
  const info = get('products').children.find((card) => card.children[1].children[1].textContent === products[0].name).children[1];
  const bottom = info.children.find((child) => child.className === 'product-bottom');
  assert.match(bottom.children[0].children[0].textContent, /18,00/);
  assert.match(bottom.children[0].children[1].children[0].textContent, /30,00/);
  assert.match(bottom.children[0].children[2].textContent, /Atacado.*9 unidades/);
});

test('botão de ofertas abre um banner apenas com quantidades e preços', async () => {
  const { context, get, products, snapshot } = await storefront();
  products[0].promotions = [{
    priceCents: 1999, taxesConfirmed: true, begin: 100, end: 500,
    minQuantity: 6, maxQuantity: 9999, promotionId: 2, promotionTitle: 'Oferta teste',
  }];
  snapshot.updatedAt++;
  await context.loadCatalog();
  const card = get('products').children.find((entry) => entry.children.some((node) => node.className === 'product-info' && node.children.some((child) => child.className === 'product-name' && child.textContent === products[0].name)));
  const info = card.children.find((node) => node.className === 'product-info');
  const banner = info.children.find((child) => child.className === 'product-offer-banner');
  assert.equal(banner.textContent, 'Ofertas');
  assert.match(card.className, /promotional/);
  const bottom = info.children.find((child) => child.className === 'product-bottom');
  assert.match(bottom.children[0].children[1].children[0].textContent, /30,00/);
  banner.dispatch('click');
  assert.equal(get('product-dialog').open, true);
  const enlargedImage = get('product-details').children.find((node) => node.className === 'product-dialog-image');
  assert.equal(enlargedImage, undefined);
  const offerBanner = get('product-details').children.find((node) => node.className === 'offers-banner');
  const offer = offerBanner.children[0];
  const offerText = offer.children.map((node) => node.textContent).join(' ');
  assert.match(offerText, /a partir de 6 un\./);
  assert.match(offerText, /19,99/);
  assert.equal(get('product-dialog-eyebrow').textContent, 'OFERTAS DO PRODUTO');
});

test('oculta promoções sem diferença de preço mesmo quando têm título', async () => {
  const { context, get, products, snapshot } = await storefront();
  products[0].promotions = [{
    priceCents: products[0].priceCents, taxesConfirmed: true, begin: 100, end: 500,
    minQuantity: 1, maxQuantity: 9999,
  }];
  snapshot.updatedAt++;
  await context.loadCatalog();
  const findOfferButton = () => {
    const card = get('products').children.find((entry) => entry.children.some((node) =>
      node.className === 'product-info' && node.children.some((child) =>
        child.className === 'product-name' && child.textContent === products[0].name)));
    return card.children.find((node) => node.className === 'product-info').children
      .find((child) => child.className === 'product-offer-banner');
  };
  assert.equal(findOfferButton(), undefined);

  products[0].promotions[0].promotionTitle = 'Dpr ecofitus/mova';
  snapshot.updatedAt++;
  await context.loadCatalog();
  assert.equal(findOfferButton(), undefined);
});

test('divergência de preço atualiza o catálogo e pede revisão sem liberar WhatsApp', async () => {
  const { context, get, products, snapshot } = await storefront();
  context.addProduct(products[0]);
  context.window.ecofitusRequest = async (path) => {
    if (path === '/api/company') return { cnpj: '12345678901234', name: 'Empresa teste' };
    if (path === '/api/order') {
      products[0].priceCents = 4000;
      snapshot.updatedAt++;
      throw new Error('Os preços mudaram ou não puderam ser confirmados. Atualize e revise o pedido.');
    }
    return snapshot;
  };
  get('cnpj').value = '12345678901234';
  await get('order-form').listeners.submit({ preventDefault() {} });
  assert.match(get('cart-total').textContent, /120,00/);
  assert.match(get('order-error').textContent, /revise o pedido/);
  assert.equal(get('whatsapp-link').hidden, true);
});

test('catálogo com dados promocionais inválidos bloqueia pedidos sem quebrar a tela', async () => {
  const { context, get, products, snapshot } = await storefront();
  context.addProduct(products[0]);
  snapshot.products = [{ ...products[0], promotions: [{ priceCents: 0 }] }];
  await context.loadCatalog();
  assert.match(get('catalog-error').textContent, /Serviço de preços desatualizado/);
  assert.equal(get('submit-order').disabled, true);
  assert.match(get('cart-total').textContent, /90,00/);
});
