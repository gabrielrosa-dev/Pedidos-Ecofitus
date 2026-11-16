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
  focus() {}
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
  dispatch(type) { this.listeners[type]({ target: this }); }
}

async function storefront() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  get('sort').value = 'name';
  const products = [
    { id: 'abc123', name: 'Óleo de teste', ean: '789000', maker: 'Ecofitus', priceCents: 3000, taxesConfirmed: true, stock: 12, multiple: 3 },
    { id: 'out', name: 'Indisponível', ean: '789001', maker: 'Ecofitus', priceCents: 1000, taxesConfirmed: true, stock: 0, multiple: 1 },
  ];
  const snapshot = { products, updatedAt: 123, stale: false, error: null };
  const document = {
    getElementById: get, createElement: () => new Element(), querySelectorAll: () => [],
    addEventListener() {}, body: new Element(),
  };
  const context = vm.createContext({
    document, console, crypto: { randomUUID: () => 'test-id' },
    window: { ecofitusRequest: async () => snapshot, EcofitusCampaigns: { campaigns: [] } },
    setInterval() {}, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { context, get, products, snapshot };
}

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
