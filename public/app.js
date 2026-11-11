'use strict';

const $ = (id) => document.getElementById(id);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let catalog = [];
let updatedAt = 0;
let stale = true;
let loading = true;
let orderVersion = 0;
const cart = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function invalidateOrder() {
  orderVersion++;
  $('whatsapp-link').hidden = true;
  $('whatsapp-link').removeAttribute('href');
}

function setCartOpen(open) {
  $('cart').classList.toggle('open', open);
  $('cart').setAttribute('aria-hidden', String(!open));
  $('overlay').hidden = !open;
  document.body.classList.toggle('cart-open', open);
  if (open) $('close-cart').focus();
  else $('open-cart').focus();
}

function addProduct(product) {
  const current = cart.get(product.id) || 0;
  if (current + product.multiple > product.stock) {
    $('catalog-error').textContent = 'A quantidade selecionada ultrapassa o estoque disponível.';
    $('catalog-error').hidden = false;
    return;
  }
  cart.set(product.id, current + product.multiple);
  invalidateOrder();
  renderCart();
}

function renderProducts() {
  const query = $('search').value.trim().toLocaleLowerCase('pt-BR');
  const visible = catalog.filter((p) => `${p.name} ${p.ean} ${p.maker}`.toLocaleLowerCase('pt-BR').includes(query));
  if ($('sort').value === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if ($('sort').value === 'price-low') visible.sort((a, b) => a.priceCents - b.priceCents);
  if ($('sort').value === 'price-high') visible.sort((a, b) => b.priceCents - a.priceCents);
  $('products').replaceChildren();
  $('result-count').textContent = loading ? 'Carregando produtos...' : `${visible.length} ${visible.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
  $('empty').hidden = loading || visible.length > 0;
  for (const product of visible) {
    const card = element('article', 'product-card');
    const imageBox = element('div', 'product-image');
    const available = product.stock >= product.multiple;
    imageBox.append(element('span', `stock-tag${available ? '' : ' out'}`, available ? 'DISPONÍVEL' : 'INDISPONÍVEL'));
    if (product.image) {
      const img = element('img');
      img.src = product.image;
      img.alt = product.name;
      img.loading = 'lazy';
      img.addEventListener('error', () => img.replaceWith(element('span', 'image-placeholder', 'ecofitus')));
      imageBox.append(img);
    } else imageBox.append(element('span', 'image-placeholder', 'ecofitus'));
    const info = element('div', 'product-info');
    info.append(element('span', 'product-maker', product.maker || 'ECOFITUS'));
    info.append(element('h3', 'product-name', product.name));
    info.append(element('p', 'product-code', `Código: ${product.ean || product.id}`));
    const bottom = element('div', 'product-bottom');
    const price = element('div');
    price.append(element('span', 'price-label', product.taxesConfirmed ? 'Preço unitário c/ impostos' : 'Impostos não confirmados'), element('span', 'price', money(product.priceCents)));
    const button = element('button', 'add-button', '+');
    button.type = 'button';
    button.disabled = !available || stale;
    button.setAttribute('aria-label', `Adicionar ${product.name} ao pedido`);
    button.addEventListener('click', () => addProduct(product));
    bottom.append(price, button);
    info.append(bottom);
    card.append(imageBox, info);
    $('products').append(card);
  }
}

function renderCart() {
  const products = new Map(catalog.map((p) => [p.id, p]));
  let total = 0;
  let count = 0;
  $('cart-items').replaceChildren();
  for (const [id, quantity] of cart) {
    const product = products.get(id);
    count += quantity;
    const item = element('div', 'cart-item');
    const details = element('div');
    details.append(element('div', 'cart-item-name', product ? product.name : 'Produto não disponível'));
    if (product) {
      total += product.priceCents * quantity;
      details.append(element('span', 'cart-item-price', `${money(product.priceCents)} / un.${product.multiple > 1 ? ` · múltiplo de ${product.multiple}` : ''}`));
      if (quantity > product.stock || quantity % product.multiple !== 0) details.append(element('span', 'form-error', 'Quantidade indisponível. Ajuste ou remova.'));
    }
    const controls = element('div', 'quantity');
    const minus = element('button', '', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', `Diminuir quantidade de ${product ? product.name : 'produto'}`);
    minus.addEventListener('click', () => {
      const next = quantity - (product ? product.multiple : quantity);
      if (next <= 0) cart.delete(id); else cart.set(id, next);
      invalidateOrder();
      renderCart();
    });
    const plus = element('button', '', '+');
    plus.type = 'button';
    plus.disabled = !product || quantity + product.multiple > product.stock || stale;
    plus.setAttribute('aria-label', `Aumentar quantidade de ${product ? product.name : 'produto'}`);
    plus.addEventListener('click', () => addProduct(product));
    controls.append(minus, element('span', '', String(quantity)), plus);
    item.append(details, controls);
    $('cart-items').append(item);
  }
  $('cart-count').textContent = String(count);
  $('cart-empty').hidden = cart.size > 0;
  $('cart-total').textContent = money(total);
  $('progress-bar').style.width = `${Math.min(100, total / 5000 * 100)}%`;
  $('minimum-text').textContent = total >= 5000 ? 'Pedido mínimo atingido ✓' : `Faltam ${money(5000 - total)} para o pedido mínimo.`;
  $('submit-order').disabled = stale || !cart.size || total < 5000;
}

async function loadCatalog() {
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar o catálogo.');
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('Resposta do catálogo inválida.');
    if (updatedAt && data.updatedAt !== updatedAt) invalidateOrder();
    catalog = data.products;
    updatedAt = data.updatedAt;
    stale = data.stale;
    loading = false;
    $('sync-status').textContent = updatedAt ? `Atualizado em ${new Date(updatedAt).toLocaleString('pt-BR')}` : 'Aguardando atualização';
    $('catalog-error').hidden = !data.error && !stale;
    $('catalog-error').textContent = stale
      ? 'Catálogo indisponível ou desatualizado. Aguarde a atualização para fazer pedidos.'
      : (data.error || '');
    if (stale) invalidateOrder();
    renderProducts();
    renderCart();
  } catch (error) {
    loading = false;
    stale = true;
    invalidateOrder();
    $('sync-status').textContent = 'Conexão indisponível';
    $('catalog-error').textContent = `${error.message} Tente novamente em instantes.`;
    $('catalog-error').hidden = false;
    renderProducts();
    renderCart();
  }
}

$('open-cart').addEventListener('click', () => setCartOpen(true));
$('close-cart').addEventListener('click', () => setCartOpen(false));
$('overlay').addEventListener('click', () => setCartOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('cart').classList.contains('open')) setCartOpen(false);
});
$('search').addEventListener('input', renderProducts);
$('sort').addEventListener('change', renderProducts);
$('order-form').addEventListener('input', invalidateOrder);
$('cnpj').addEventListener('input', (event) => {
  const digits = event.target.value.replace(/\D/g, '').slice(0, 14);
  event.target.value = digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
});
$('order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  invalidateOrder();
  const submittedVersion = orderVersion;
  $('order-error').hidden = true;
  $('submit-order').disabled = true;
  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cnpj: $('cnpj').value,
        terms: $('terms').value,
        items: Array.from(cart, ([id, quantity]) => ({ id, quantity })),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível preparar o pedido.');
    if (submittedVersion !== orderVersion) {
      throw new Error('O pedido foi alterado. Prepare-o novamente.');
    }
    $('whatsapp-link').href = result.url;
    $('whatsapp-link').hidden = false;
    $('whatsapp-link').focus();
  } catch (error) {
    $('order-error').textContent = error.message;
    $('order-error').hidden = false;
  } finally {
    renderCart();
  }
});

loadCatalog();
setInterval(loadCatalog, 30000);
