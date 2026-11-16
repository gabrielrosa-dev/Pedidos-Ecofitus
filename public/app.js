'use strict';

const $ = (id) => document.getElementById(id);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let catalog = [];
let updatedAt = 0;
let stale = true;
let loading = true;
let catalogRequestInFlight = false;
let orderVersion = 0;
let orderId = crypto.randomUUID();
let verifiedCnpj = '';
let lookupVersion = 0;
let lookupTimer;
let lookupPromise;
const cart = new Map();
const productSummaries = new Map();
const selectedCampaigns = new Set();
let activeCampaign;

function reservedQuantity(id) {
  let total = cart.get(id) || 0;
  for (const campaignId of selectedCampaigns) {
    try {
      const campaign = window.EcofitusCampaigns.getCampaign(campaignId, catalog);
      for (const line of campaign.lines) {
        if (line.product.id === id) total += line.quantity + line.bonus;
      }
    } catch (error) {
      console.error('Campanha indisponível no catálogo:', error.message);
    }
  }
  return total;
}

function campaignAvailability(campaign) {
  if (stale) return 'O catálogo está indisponível ou desatualizado.';
  if (selectedCampaigns.has(campaign.id)) return 'Esta campanha já está no carrinho.';
  for (const line of campaign.lines) {
    if (reservedQuantity(line.product.id) + line.quantity + line.bonus > line.product.stock) {
      return `Estoque insuficiente para ${line.product.name}, considerando os itens do carrinho.`;
    }
  }
  return '';
}

function renderCampaignDialog() {
  const details = $('campaign-details');
  details.replaceChildren();
  $('campaign-message').hidden = true;
  $('campaign-add').disabled = true;
  const config = window.EcofitusCampaigns.campaigns.find((entry) => entry.id === activeCampaign);
  $('campaign-dialog-title').textContent = config.title;
  try {
    const campaign = window.EcofitusCampaigns.getCampaign(activeCampaign, catalog);
    for (const line of campaign.lines) {
      details.append(element('p', 'campaign-detail', `${line.product.name}: ${line.quantity} × ${money(line.priceCents)} = ${money(line.quantity * line.priceCents)}${line.bonus ? ` + ${line.bonus} unidades bonificadas` : ''}`));
    }
    details.append(element('p', 'campaign-total', `Total do exemplo: ${money(campaign.totalCents)}`));
    details.append(element('p', 'form-note', `Benefício solicitado: ${campaign.benefit}${campaign.id === 'b12-pix' || campaign.id === 'q10-b12' ? ' O valor do Pix não é descontado do total do pedido.' : ''}`));
    const unavailable = campaignAvailability(campaign);
    if (unavailable) {
      $('campaign-message').textContent = unavailable;
      $('campaign-message').hidden = false;
    } else $('campaign-add').disabled = false;
  } catch (error) {
    $('campaign-message').textContent = error.message;
    $('campaign-message').hidden = false;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function invalidateOrder() {
  orderVersion++;
  orderId = crypto.randomUUID();
  $('whatsapp-link').hidden = true;
  $('whatsapp-link').removeAttribute('href');
}

function setCartOpen(open) {
  $('cart').classList.toggle('open', open);
  $('cart').setAttribute('aria-hidden', String(!open));
  $('cart').inert = !open;
  $('overlay').hidden = !open;
  document.body.classList.toggle('cart-open', open);
  if (open) $('close-cart').focus();
  else $('open-cart').focus();
}

function addProduct(product) {
  const current = cart.get(product.id) || 0;
  if (stale || reservedQuantity(product.id) + product.multiple > product.stock) {
    $('catalog-error').textContent = stale
      ? 'Aguarde a atualização do catálogo para adicionar produtos.'
      : 'A quantidade selecionada ultrapassa o estoque disponível.';
    $('catalog-error').hidden = false;
    return;
  }
  cart.set(product.id, current + product.multiple);
  invalidateOrder();
  renderCart();
}

function updateProductSummary(product, summary) {
  const quantity = cart.get(product.id) || 0;
  summary.hidden = quantity === 0;
  summary.textContent = quantity ? `Avulsos: ${quantity} un. · Subtotal: ${money(quantity * product.priceCents)}` : '';
}

function renderProducts() {
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const query = normalize($('search').value.trim());
  const visible = catalog.filter((p) =>
    normalize(`${p.name} ${p.id} ${p.ean} ${p.maker}`).includes(query) &&
    (!$('available-only').checked || p.stock >= p.multiple));
  if ($('sort').value === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if ($('sort').value === 'price-low') visible.sort((a, b) => a.priceCents - b.priceCents);
  if ($('sort').value === 'price-high') visible.sort((a, b) => b.priceCents - a.priceCents);
  $('products').replaceChildren();
  productSummaries.clear();
  $('result-count').textContent = loading ? 'Carregando produtos...' : `${visible.length} ${visible.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
  $('empty').hidden = loading || stale || visible.length > 0;
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
    if (product.multiple > 1) info.append(element('p', 'product-multiple', `Venda em múltiplos de ${product.multiple}`));
    const bottom = element('div', 'product-bottom');
    const price = element('div');
    price.append(element('span', 'price-label', product.taxesConfirmed ? 'Preço unitário c/ impostos' : 'Impostos não confirmados'), element('span', 'price', money(product.priceCents)));
    const button = element('button', 'add-button', '+');
    button.type = 'button';
    button.disabled = !available || stale;
    button.setAttribute('aria-label', `Adicionar ${product.name} ao pedido`);
    button.addEventListener('click', () => addProduct(product));
    bottom.append(price, button);
    const summary = element('p', 'product-summary');
    summary.setAttribute('aria-live', 'polite');
    updateProductSummary(product, summary);
    productSummaries.set(product.id, { product, summary });
    info.append(bottom, summary);
    card.append(imageBox, info);
    $('products').append(card);
  }
}

function renderCart() {
  const products = new Map(catalog.map((p) => [p.id, p]));
  let total = 0;
  let count = 0;
  let productInvalid = false;
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
      if (reservedQuantity(id) > product.stock || quantity % product.multiple !== 0) {
        productInvalid = true;
        details.append(element('span', 'form-error', 'Quantidade indisponível. Ajuste ou remova.'));
      }
    } else productInvalid = true;
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
    plus.disabled = !product || reservedQuantity(id) + product.multiple > product.stock || stale;
    plus.setAttribute('aria-label', `Aumentar quantidade de ${product ? product.name : 'produto'}`);
    plus.addEventListener('click', () => addProduct(product));
    const quantityInput = element('input', 'quantity-input');
    quantityInput.type = 'number';
    quantityInput.inputMode = 'numeric';
    quantityInput.min = product ? String(product.multiple) : '1';
    quantityInput.step = product ? String(product.multiple) : '1';
    quantityInput.value = String(quantity);
    quantityInput.setAttribute('aria-label', `Quantidade de ${product ? product.name : 'produto'}`);
    const quantityError = element('span', 'form-error quantity-error');
    quantityError.setAttribute('role', 'alert');
    quantityInput.addEventListener('change', () => {
      const next = quantityInput.valueAsNumber;
      const max = product ? product.stock - (reservedQuantity(id) - quantity) : 0;
      if (!product || !Number.isSafeInteger(next) || next < 1 || next % product.multiple !== 0 ||
          (next > quantity && (stale || next > max))) {
        quantityInput.value = String(quantity);
        quantityError.textContent = product
          ? (stale && next > quantity ? 'Aguarde a atualização do catálogo para aumentar a quantidade.' : `Informe um múltiplo de ${product.multiple} dentro do estoque disponível.`)
          : 'Remova este produto indisponível do pedido.';
        return;
      }
      cart.set(id, next);
      invalidateOrder();
      renderCart();
    });
    const remove = element('button', 'item-remove', 'Remover');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remover ${product ? product.name : 'produto'} do pedido`);
    remove.addEventListener('click', () => { cart.delete(id); invalidateOrder(); renderCart(); });
    details.append(quantityError, remove);
    controls.append(minus, quantityInput, plus);
    item.append(details, controls);
    $('cart-items').append(item);
  }
  let campaignInvalid = false;
  for (const id of selectedCampaigns) {
    const item = element('div', 'cart-item');
    const details = element('div');
    try {
      const campaign = window.EcofitusCampaigns.getCampaign(id, catalog);
      details.append(element('div', 'cart-item-name', `Campanha: ${campaign.title}`));
      for (const line of campaign.lines) {
        count += line.quantity + line.bonus;
        details.append(element('span', 'cart-item-price', `${line.product.name}: ${line.quantity} × ${money(line.priceCents)}${line.bonus ? ` + ${line.bonus} bonificadas` : ''}`));
        if (reservedQuantity(line.product.id) > line.product.stock) campaignInvalid = true;
      }
      total += campaign.totalCents;
      details.append(element('span', 'cart-item-price', `${campaign.benefit} Subtotal: ${money(campaign.totalCents)}`));
    } catch (error) {
      campaignInvalid = true;
      details.append(element('div', 'form-error', `Campanha indisponível: ${error.message}`));
    }
    const remove = element('button', 'campaign-remove', 'Remover');
    remove.type = 'button';
    remove.addEventListener('click', () => { selectedCampaigns.delete(id); invalidateOrder(); renderCart(); });
    item.append(details, remove);
    $('cart-items').append(item);
  }
  if (campaignInvalid) $('cart-items').append(element('p', 'form-error', 'Uma campanha está indisponível ou excede o estoque. Remova-a para continuar.'));
  $('cart-count').textContent = String(count);
  $('cart-empty').hidden = cart.size > 0 || selectedCampaigns.size > 0;
  $('cart-total').textContent = money(total);
  $('progress-bar').style.width = `${Math.min(100, total / 5000 * 100)}%`;
  $('minimum-text').textContent = total >= 5000 ? 'Pedido mínimo atingido ✓' : `Faltam ${money(5000 - total)} para o pedido mínimo.`;
  $('submit-order').disabled = stale || productInvalid || campaignInvalid || (!cart.size && !selectedCampaigns.size) || total < 5000;
  for (const { product, summary } of productSummaries.values()) updateProductSummary(product, summary);
}

async function loadCatalog() {
  if (catalogRequestInFlight) return;
  catalogRequestInFlight = true;
  try {
    const data = await window.ecofitusRequest('/api/catalog');
    if (!Array.isArray(data.products)) throw new Error('Resposta do catálogo inválida.');
    const refreshCart = loading || updatedAt !== data.updatedAt || stale !== data.stale;
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
    $('retry-catalog').hidden = !data.error && !stale;
    if (stale) invalidateOrder();
    renderProducts();
    if (refreshCart) renderCart();
    if ($('campaign-dialog').open) renderCampaignDialog();
  } catch (error) {
    loading = false;
    stale = true;
    invalidateOrder();
    $('sync-status').textContent = 'Conexão indisponível';
    $('catalog-error').textContent = `${error.message} Tente novamente em instantes.`;
    $('catalog-error').hidden = false;
    $('retry-catalog').hidden = false;
    renderProducts();
    renderCart();
    if ($('campaign-dialog').open) renderCampaignDialog();
  } finally {
    catalogRequestInFlight = false;
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
$('available-only').addEventListener('change', renderProducts);
$('retry-catalog').addEventListener('click', loadCatalog);
document.querySelectorAll('.campaign-open').forEach((button) => {
  button.addEventListener('click', () => {
    activeCampaign = button.dataset.campaign;
    renderCampaignDialog();
    $('campaign-dialog').showModal();
  });
});
$('campaign-close').addEventListener('click', () => $('campaign-dialog').close());
$('campaign-dialog').addEventListener('click', (event) => {
  if (event.target === $('campaign-dialog')) $('campaign-dialog').close();
});
$('campaign-add').addEventListener('click', () => {
  try {
    const campaign = window.EcofitusCampaigns.getCampaign(activeCampaign, catalog);
    const unavailable = campaignAvailability(campaign);
    if (unavailable) throw new Error(unavailable);
    selectedCampaigns.add(activeCampaign);
    invalidateOrder();
    renderCart();
    $('campaign-dialog').close();
    setCartOpen(true);
  } catch (error) {
    $('campaign-message').textContent = error.message;
    $('campaign-message').hidden = false;
  }
});
$('order-form').addEventListener('input', invalidateOrder);
$('cnpj').addEventListener('input', (event) => {
  lookupVersion++;
  clearTimeout(lookupTimer);
  lookupPromise = null;
  verifiedCnpj = '';
  const digits = event.target.value.replace(/\D/g, '').slice(0, 14);
  event.target.value = digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  $('company-status').textContent = digits.length === 14
    ? 'Aguardando consulta da razão social...'
    : 'A razão social será consultada automaticamente ao preencher o CNPJ.';
  if (digits.length === 14) {
    const version = lookupVersion;
    lookupTimer = setTimeout(() => lookupCompany(digits, version), 400);
  }
});
function lookupCompany(cnpj, version) {
  if (lookupPromise) return lookupPromise;
  $('company-status').textContent = 'Consultando razão social...';
  const request = (async () => {
    try {
      const result = await window.ecofitusRequest('/api/company', { cnpj });
      if (version !== lookupVersion) return false;
      verifiedCnpj = result.cnpj;
      $('company-status').textContent = `Razão social: ${result.name} (BrasilAPI)`;
      return true;
    } catch (error) {
      if (version === lookupVersion) $('company-status').textContent = `${error.message} Tente preparar o pedido para consultar novamente.`;
      return false;
    }
  })();
  lookupPromise = request;
  request.finally(() => {
    if (lookupPromise === request) lookupPromise = null;
  });
  return request;
}
$('order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('whatsapp-link').hidden = true;
  $('order-error').hidden = true;
  const submittedVersion = orderVersion;
  $('submit-order').disabled = true;
  try {
    const cnpj = $('cnpj').value.replace(/\D/g, '');
    if (verifiedCnpj !== cnpj) {
      if (cnpj.length !== 14) throw new Error('Informe um CNPJ completo.');
      clearTimeout(lookupTimer);
      if (!await lookupCompany(cnpj, lookupVersion)) throw new Error('Não foi possível confirmar a razão social. Verifique a mensagem abaixo do CNPJ.');
      if (submittedVersion !== orderVersion) throw new Error('Os dados foram alterados. Prepare o pedido novamente.');
    }
    const result = await window.ecofitusRequest('/api/order', {
        id: orderId,
        cnpj: $('cnpj').value,
        terms: $('terms').value,
        items: Array.from(cart, ([id, quantity]) => ({ id, quantity })),
        campaigns: Array.from(selectedCampaigns),
    });
    if (submittedVersion !== orderVersion) {
      throw new Error('O pedido anterior foi salvo no histórico, mas os dados foram alterados. Prepare o pedido atualizado novamente.');
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
