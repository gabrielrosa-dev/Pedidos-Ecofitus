'use strict';

const $ = (id) => document.getElementById(id);
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let catalog = [];
let updatedAt = 0;
let stale = true;
let loading = true;
let catalogRequestInFlight = null;
let catalogViewKey = '';
let submitting = false;
let promotionFilterActive = false;
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
for (const term of window.EcofitusTerms.terms) {
  const option = document.createElement('option');
  option.value = term;
  option.textContent = term;
  $('terms').append(option);
}
let assignedRepresentative = null;
try {
  assignedRepresentative = window.EcofitusRepresentatives.representativeFromSearch(location.search);
} catch (error) {
  if (typeof localStorage !== 'undefined') {
    const remembered = localStorage.getItem('ecofitus-representative');
    try {
      assignedRepresentative = window.EcofitusRepresentatives.getRepresentative(remembered);
    } catch {
      console.warn(error.message);
    }
  } else {
    console.warn(error.message);
  }
}
if (assignedRepresentative && typeof localStorage !== 'undefined') {
  localStorage.setItem('ecofitus-representative', assignedRepresentative.id);
}
if (assignedRepresentative && document.querySelector) document.querySelector('.brand').href = `./${location.search}`;

function reservedQuantity(id) {
  let total = cart.get(id) || 0;
  for (const campaignId of selectedCampaigns) {
    try {
      const campaign = window.EcofitusCampaigns.getCampaign(campaignId, catalog, updatedAt);
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
    const campaign = window.EcofitusCampaigns.getCampaign(activeCampaign, catalog, updatedAt);
    for (const line of campaign.lines) {
      const quantityDetail = line.quantity
        ? `${line.quantity} × ${money(line.priceCents)} = ${money(line.quantity * line.priceCents)}`
        : `${line.bonus} unidades bonificadas`;
      details.append(element('p', 'campaign-detail', `${line.product.name}: ${quantityDetail}${line.quantity && line.bonus ? ` + ${line.bonus} unidades bonificadas` : ''}`));
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
  const error = changeProductQuantity(product, current + product.multiple);
  if (error) {
    $('catalog-error').textContent = error;
    $('catalog-error').hidden = false;
  }
}

function changeProductQuantity(product, next) {
  const current = cart.get(product.id) || 0;
  if (!Number.isSafeInteger(next) || next < 0 || next % product.multiple !== 0) {
    return `Informe zero ou um múltiplo de ${product.multiple}.`;
  }
  if (next > current && stale) return 'Aguarde a atualização do catálogo para aumentar a quantidade.';
  if (next > current && reservedQuantity(product.id) - current + next > product.stock) {
    return 'A quantidade selecionada ultrapassa o estoque disponível.';
  }
  if (next === current) return '';
  if (next === 0) cart.delete(product.id); else cart.set(product.id, next);
  invalidateOrder();
  renderCart();
  return '';
}

function promotionOrder(a, b) {
  return a.minQuantity - b.minQuantity || b.begin - a.begin ||
    (Number.isSafeInteger(b.promotionId) ? b.promotionId : 0) -
    (Number.isSafeInteger(a.promotionId) ? a.promotionId : 0);
}

function promotionRange(sale) {
  return sale.maxQuantity >= 9999
    ? `a partir de ${sale.minQuantity} un.`
    : `${sale.minQuantity} a ${sale.maxQuantity} un.`;
}

function activeOffers(product) {
  return product.promotions.slice().sort(promotionOrder).filter((sale) => {
    const minimum = Math.max(product.multiple, Math.ceil(sale.minQuantity / product.multiple) * product.multiple);
    const available = updatedAt >= sale.begin && updatedAt < sale.end &&
      minimum <= sale.maxQuantity && minimum <= product.stock;
    const hasDiscount = sale.priceCents < product.priceCents;
    const hasCampaign = typeof sale.promotionTitle === 'string' && sale.promotionTitle.trim().length > 0;
    return available && (hasDiscount || hasCampaign);
  });
}

function activeDiscounts(product) {
  return activeOffers(product).filter((sale) => sale.priceCents < product.priceCents);
}

function offerReason(product, sale) {
  const minimum = Math.max(product.multiple, Math.ceil(sale.minQuantity / product.multiple) * product.multiple);
  const quantity = sale.maxQuantity >= 9999
    ? `a partir de ${minimum} unidades`
    : `de ${minimum} a ${sale.maxQuantity} unidades`;
  return `${sale.promotionTitle ? `${sale.promotionTitle}: ` : 'Condição especial: '}${quantity}`;
}

function appendProductOffers(details, product) {
  if (!product.promotions.length) {
    details.append(element('p', 'product-detail-meta', 'Nenhuma oferta cadastrada para este produto.'));
    return;
  }
  for (const sale of product.promotions.slice().sort(promotionOrder)) {
    const state = updatedAt < sale.begin ? 'Programada' : updatedAt >= sale.end ? 'Encerrada' : 'Ativa';
    const title = sale.promotionTitle ? `${sale.promotionTitle} · ` : '';
    const range = element('strong', '', `${promotionRange(sale)} · ${money(sale.priceCents)}/un.`);
    const dates = element('span', 'product-detail-meta',
      `${new Date(sale.begin).toLocaleDateString('pt-BR')} a ${new Date(sale.end).toLocaleDateString('pt-BR')} · ${state}`);
    const row = element('article', 'product-offer-detail');
    row.append(element('span', 'product-offer-name', `${title}${state}`), range, dates);
    details.append(row);
  }
  details.append(element('p', 'form-note',
    'Se ofertas ativas se sobrepõem para a mesma quantidade, é aplicada a que começou mais recentemente; em empate, vale o maior ID de promoção da Nexfar.'));
}

function renderProductDetails(product) {
  const details = $('product-details');
  details.replaceChildren();
  $('product-dialog-eyebrow').textContent = 'PRODUTO E OFERTAS';
  $('product-dialog-note').textContent = 'Ofertas e estoque sujeitos à confirmação comercial.';
  $('product-dialog-title').textContent = product.name;
  if (product.image) {
    const imageBox = element('div', 'product-dialog-image');
    const image = element('img');
    image.src = product.image;
    image.alt = product.name;
    imageBox.append(image);
    details.append(imageBox);
  }
  details.append(element('p', 'product-detail-meta', product.maker || 'ECOFITUS'));
  details.append(element('p', 'product-detail-meta', `EAN/código: ${product.ean || product.id}`));
  if (product.principle) details.append(element('p', 'product-detail-meta', `Princípio ativo: ${product.principle}`));
  if (product.boxQuantity) details.append(element('p', 'product-detail-meta', `Unidades por embalagem: ${product.boxQuantity}`));
  details.append(element('p', 'product-detail-meta', `Estoque informado: ${product.stock} · Venda em múltiplos de ${product.multiple}`));
  details.append(element('p', 'product-detail-price', `Preço de tabela: ${money(product.priceCents)} por unidade`));
  details.append(element('h3', 'product-offers-title', 'Ofertas recebidas da Nexfar'));
  appendProductOffers(details, product);
}

function renderProductOffers(product) {
  const details = $('product-details');
  details.replaceChildren();
  $('product-dialog-eyebrow').textContent = 'OFERTAS DO PRODUTO';
  $('product-dialog-note').textContent = 'Preços e quantidades sujeitos à confirmação comercial.';
  $('product-dialog-title').textContent = product.name;
  details.append(element('div', 'offers-banner'));
  const banner = details.children[details.children.length - 1];
  for (const sale of activeOffers(product)) {
    const row = element('div', 'offers-banner-row');
    row.append(
      element('span', 'offers-banner-quantity', `${sale.promotionTitle ? `${sale.promotionTitle} · ` : ''}${promotionRange(sale)}`),
      element('strong', 'offers-banner-price', `${money(sale.priceCents)}/un.`),
      element('small', 'offers-banner-state', 'Ativa')
    );
    banner.append(row);
  }
}

function updateProductSummary(product, controls) {
  const quantity = cart.get(product.id) || 0;
  const calculatedPrice = window.EcofitusPricing.unitPrice(product, quantity || product.multiple, updatedAt);
  const featuredPromotion = window.EcofitusPricing.lowestActiveOffer(product, updatedAt);
  const price = quantity || !featuredPromotion ? calculatedPrice : {
    priceCents: featuredPromotion.priceCents,
    taxesConfirmed: featuredPromotion.taxesConfirmed,
    promotional: true,
  };
  controls.summary.hidden = quantity === 0;
  controls.add.hidden = quantity > 0;
  controls.add.disabled = stale || reservedQuantity(product.id) + product.multiple > product.stock;
  controls.plus.disabled = controls.add.disabled;
  controls.input.value = String(quantity);
  controls.price.textContent = money(price.priceCents);
  controls.oldPrice.hidden = !price.promotional || price.priceCents >= product.priceCents;
  controls.oldPrice.textContent = money(product.priceCents);
  controls.priceLabel.textContent = quantity
    ? (price.taxesConfirmed ? 'Preço unitário c/ impostos' : 'Impostos não confirmados')
    : featuredPromotion
      ? `Menor preço ${money(featuredPromotion.priceCents)}`
      : (price.taxesConfirmed ? 'Preço unitário c/ impostos' : 'Impostos não confirmados');
  controls.offerReason.textContent = !quantity && featuredPromotion ? offerReason(product, featuredPromotion) : '';
  controls.offerReason.hidden = !controls.offerReason.textContent;
  controls.text.textContent = quantity ? `Avulsos: ${quantity} un. · Subtotal: ${money(quantity * price.priceCents)}` : '';
}

function renderProducts() {
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const query = normalize($('search').value.trim());
  const visible = catalog.filter((p) =>
    normalize(`${p.name} ${p.id} ${p.ean} ${p.maker}`).includes(query) &&
    (!$('available-only').checked || p.stock >= p.multiple) &&
    (!promotionFilterActive || activeDiscounts(p).length > 0));
  if ($('sort').value === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const initialPrice = (product) => {
    const offer = window.EcofitusPricing.lowestActiveOffer(product, updatedAt);
    return offer ? offer.priceCents : product.priceCents;
  };
  if ($('sort').value === 'price-low') visible.sort((a, b) => initialPrice(a) - initialPrice(b));
  if ($('sort').value === 'price-high') visible.sort((a, b) => initialPrice(b) - initialPrice(a));
  $('products').replaceChildren();
  productSummaries.clear();
  $('result-count').textContent = loading ? 'Carregando produtos...' : `${visible.length} ${visible.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
  $('empty').hidden = loading || stale || visible.length > 0;
  for (const product of visible) {
    const card = element('article', `product-card${activeDiscounts(product).length ? ' promotional' : ''}`);
    const openDetails = () => {
      renderProductDetails(product);
      $('product-dialog').showModal();
    };
    const imageBox = element('div', 'product-image');
    imageBox.setAttribute('role', 'button');
    imageBox.tabIndex = 0;
    imageBox.setAttribute('aria-label', `Ampliar imagem e ver detalhes de ${product.name}`);
    imageBox.addEventListener('click', openDetails);
    imageBox.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openDetails();
    });
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
    const productName = element('h3', 'product-name', product.name);
    productName.addEventListener('click', openDetails);
    productName.setAttribute('role', 'button');
    productName.tabIndex = 0;
    info.append(productName);
    info.append(element('p', 'product-code', `Código: ${product.ean || product.id}`));
    if (product.multiple > 1) info.append(element('p', 'product-multiple', `Venda em múltiplos de ${product.multiple}`));
    if (activeOffers(product).length) {
      const offerBanner = element('button', 'product-offer-banner', 'Ofertas');
      offerBanner.type = 'button';
      offerBanner.addEventListener('click', () => {
        renderProductOffers(product);
        $('product-dialog').showModal();
      });
      info.append(offerBanner);
    }
    const bottom = element('div', 'product-bottom');
    const price = element('div');
    const priceLabel = element('span', 'price-label');
    const offerReasonLabel = element('small', 'product-offer-reason');
    const priceValues = element('span', 'price-values');
    const oldPrice = element('span', 'old-price');
    const priceValue = element('span', 'price');
    oldPrice.setAttribute('aria-label', 'Preço anterior');
    priceValues.append(oldPrice, priceValue);
    price.append(priceLabel, priceValues, offerReasonLabel);
    const button = element('button', 'add-button', '+');
    button.type = 'button';
    button.disabled = !available || stale;
    button.setAttribute('aria-label', `Adicionar ${product.name} ao pedido`);
    bottom.append(price, button);
    const summary = element('div', 'product-summary');
    const text = element('span', 'product-summary-text');
    text.setAttribute('aria-live', 'polite');
    const quantityControls = element('div', 'quantity product-quantity');
    const minus = element('button', '', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', `Diminuir quantidade avulsa de ${product.name}`);
    const input = element('input', 'quantity-input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '0';
    input.step = String(product.multiple);
    input.setAttribute('aria-label', `Quantidade avulsa de ${product.name}`);
    const plus = element('button', '', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', `Aumentar quantidade avulsa de ${product.name}`);
    const quantityError = element('span', 'form-error quantity-error');
    quantityError.setAttribute('role', 'alert');
    const applyQuantity = (next) => {
      quantityError.textContent = changeProductQuantity(product, next);
      if (quantityError.textContent) input.value = String(cart.get(product.id) || 0);
    };
    button.addEventListener('click', () => {
      addProduct(product);
      if (cart.has(product.id)) minus.focus();
    });
    minus.addEventListener('click', () => {
      applyQuantity(Math.max(0, (cart.get(product.id) || 0) - product.multiple));
      if (!cart.has(product.id)) button.focus();
    });
    plus.addEventListener('click', () => applyQuantity((cart.get(product.id) || 0) + product.multiple));
    input.addEventListener('change', () => applyQuantity(input.valueAsNumber));
    quantityControls.append(minus, input, plus);
    summary.append(text, quantityControls, quantityError);
    const controls = { product, summary, text, input, add: button, plus, price: priceValue, oldPrice, priceLabel, offerReason: offerReasonLabel };
    updateProductSummary(product, controls);
    productSummaries.set(product.id, controls);
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
      const price = window.EcofitusPricing.unitPrice(product, quantity, updatedAt);
      total += price.priceCents * quantity;
      details.append(element('span', 'cart-item-price', `${price.promotional ? 'Promoção · ' : ''}${money(price.priceCents)} / un.${product.multiple > 1 ? ` · múltiplo de ${product.multiple}` : ''}`));
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
    quantityInput.min = '0';
    quantityInput.step = product ? String(product.multiple) : '1';
    quantityInput.value = String(quantity);
    quantityInput.setAttribute('aria-label', `Quantidade de ${product ? product.name : 'produto'}`);
    const quantityError = element('span', 'form-error quantity-error');
    quantityError.setAttribute('role', 'alert');
    quantityInput.addEventListener('change', () => {
      const error = product ? changeProductQuantity(product, quantityInput.valueAsNumber) : 'Remova este produto indisponível do pedido.';
      if (error) {
        quantityInput.value = String(quantity);
        quantityError.textContent = error;
      }
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
      const campaign = window.EcofitusCampaigns.getCampaign(id, catalog, updatedAt);
      details.append(element('div', 'cart-item-name', `Campanha: ${campaign.title}`));
      for (const line of campaign.lines) {
        count += line.quantity + line.bonus;
        const quantityDetail = line.quantity
          ? `${line.quantity} × ${money(line.priceCents)}`
          : `${line.bonus} bonificadas`;
        details.append(element('span', 'cart-item-price', `${line.product.name}: ${quantityDetail}${line.quantity && line.bonus ? ` + ${line.bonus} bonificadas` : ''}`));
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
  $('submit-order').disabled = submitting || stale || !assignedRepresentative || productInvalid || campaignInvalid || (!cart.size && !selectedCampaigns.size) || total < 5000;
  $('representative-link-warning').hidden = Boolean(assignedRepresentative);
  for (const controls of productSummaries.values()) updateProductSummary(controls.product, controls);
}

async function loadCatalog() {
  if (catalogRequestInFlight) return catalogRequestInFlight;
  catalogRequestInFlight = fetchCatalog();
  try {
    await catalogRequestInFlight;
  } finally {
    catalogRequestInFlight = null;
  }
}

async function fetchCatalog() {
  try {
    const data = await window.ecofitusRequest('/api/catalog');
    const validProducts = Array.isArray(data.products) && data.products.every((product) => product &&
      typeof product.id === 'string' &&
      typeof product.name === 'string' && typeof product.ean === 'string' && typeof product.maker === 'string' &&
      Number.isSafeInteger(product.priceCents) && product.priceCents > 0 &&
      Number.isSafeInteger(product.stock) && product.stock >= 0 &&
      Number.isSafeInteger(product.multiple) && product.multiple > 0 &&
      Array.isArray(product.promotions) && product.promotions.every((sale) => sale &&
        Number.isSafeInteger(sale.priceCents) && sale.priceCents > 0 &&
        typeof sale.taxesConfirmed === 'boolean' && Number.isSafeInteger(sale.begin) &&
        Number.isSafeInteger(sale.end) && sale.end > sale.begin &&
        Number.isSafeInteger(sale.minQuantity) && sale.minQuantity > 0 &&
        Number.isSafeInteger(sale.maxQuantity) && sale.maxQuantity >= sale.minQuantity &&
        (sale.promotionId === undefined || Number.isSafeInteger(sale.promotionId)) &&
        (sale.promotionTitle === undefined || typeof sale.promotionTitle === 'string')));
    if (!validProducts || !Number.isFinite(data.updatedAt) || typeof data.stale !== 'boolean') {
      throw new Error('Serviço de preços desatualizado. Entre em contato com a equipe comercial.');
    }
    const nextViewKey = JSON.stringify(data.products.map((product) => [
      product, product.promotions.map((sale) => data.updatedAt >= sale.begin && data.updatedAt < sale.end),
    ]));
    const refreshCart = loading || catalogViewKey !== nextViewKey || stale !== data.stale;
    if (updatedAt && catalogViewKey !== nextViewKey) invalidateOrder();
    catalog = data.products;
    catalogViewKey = nextViewKey;
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
    if (refreshCart) {
      renderProducts();
      renderCart();
    }
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
function setPromotionFilter(active) {
  promotionFilterActive = active;
  $('promotion-filter').setAttribute('aria-pressed', String(promotionFilterActive));
  renderProducts();
}
$('promotion-filter').addEventListener('click', () => {
  setPromotionFilter(!promotionFilterActive);
});
$('black-friday-banner').addEventListener('click', () => {
  setPromotionFilter(true);
  $('produtos').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('retry-catalog').addEventListener('click', loadCatalog);
$('product-close').addEventListener('click', () => $('product-dialog').close());
$('product-dialog').addEventListener('click', (event) => {
  if (event.target === $('product-dialog')) $('product-dialog').close();
});
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
    const campaign = window.EcofitusCampaigns.getCampaign(activeCampaign, catalog, updatedAt);
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
  if (submitting) return;
  submitting = true;
  $('whatsapp-link').hidden = true;
  $('order-error').hidden = true;
  const submittedVersion = orderVersion;
  let orderRequested = false;
  $('submit-order').disabled = true;
  try {
    if (!assignedRepresentative) throw new Error('Acesse o catálogo pelo link enviado pelo seu representante.');
    const cnpj = $('cnpj').value.replace(/\D/g, '');
    if (verifiedCnpj !== cnpj) {
      if (cnpj.length !== 14) throw new Error('Informe um CNPJ completo.');
      clearTimeout(lookupTimer);
      if (!await lookupCompany(cnpj, lookupVersion)) throw new Error('Não foi possível confirmar a razão social. Verifique a mensagem abaixo do CNPJ.');
      if (submittedVersion !== orderVersion) throw new Error('Os dados foram alterados. Prepare o pedido novamente.');
    }
    const products = new Map(catalog.map((product) => [product.id, product]));
    const priceQuote = {
      items: Array.from(cart, ([id, quantity]) => ({
        id, priceCents: window.EcofitusPricing.unitPrice(products.get(id), quantity, updatedAt).priceCents,
      })),
      campaigns: Array.from(selectedCampaigns, (id) => ({
        id,
        items: window.EcofitusCampaigns.getCampaign(id, catalog, updatedAt).lines.map((line) => ({
          id: line.product.id, priceCents: line.priceCents,
        })),
      })),
    };
    orderRequested = true;
    const result = await window.ecofitusRequest('/api/order', {
        id: orderId,
        representativeId: assignedRepresentative.id,
        cnpj: $('cnpj').value,
        terms: $('terms').value,
        items: Array.from(cart, ([id, quantity]) => ({ id, quantity })),
        campaigns: Array.from(selectedCampaigns),
        priceQuote,
    });
    if (submittedVersion !== orderVersion) {
      throw new Error('O pedido anterior foi salvo no histórico, mas os dados foram alterados. Prepare o pedido atualizado novamente.');
    }
    $('whatsapp-link').href = result.url;
    $('whatsapp-link').hidden = false;
    $('whatsapp-link').focus();
  } catch (error) {
    if (orderRequested) {
      if (catalogRequestInFlight) await catalogRequestInFlight;
      await loadCatalog();
    }
    $('order-error').textContent = error.message;
    $('order-error').hidden = false;
  } finally {
    submitting = false;
    renderCart();
  }
});

loadCatalog();
setInterval(loadCatalog, 30000);
