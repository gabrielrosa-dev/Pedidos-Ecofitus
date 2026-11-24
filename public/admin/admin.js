'use strict';

const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);
let credentials = null;
let selectedOrder = null;
let catalog = [];
let campaigns = [];
let editingCampaign = null;
let editingCampaignItems = [];
let selectedImageFile = null;
let previewObjectUrl = '';
let imageSelectionInvalid = false;
for (const term of window.EcofitusTerms.terms) {
  const option = document.createElement('option');
  option.value = term;
  option.textContent = term;
  $('edit-terms').append(option);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadCatalog() {
  const snapshot = await window.ecofitusRequest('/api/catalog');
  catalog = snapshot.products || [];
  populateCampaignProductSelect();
  return snapshot;
}

function request(operation, values = {}) {
  return window.ecofitusRequest(`/api/admin/orders${operation}`, {
    auth: credentials,
    ...values,
  });
}

function campaignRequest(operation, values = {}) {
  return window.ecofitusRequest(`/api/admin/campaigns${operation}`, {
    auth: credentials,
    ...values,
  });
}

function orderCard(order) {
  const card = element('article', 'admin-order');
  const heading = element('div', 'admin-order-heading');
  const identity = element('div');
  identity.append(
    element('strong', '', order.companyName),
    element('span', 'admin-order-date', new Date(order.createdAt).toLocaleString('pt-BR')),
    element('span', 'admin-order-id', `Pedido ${order.id}`)
  );
  heading.append(identity, element('strong', 'admin-order-total', money(order.totalCents)));
  const mirror = element('pre', 'admin-order-mirror', order.message);
  const actions = element('div', 'admin-order-actions');
  const edit = element('button', 'lookup-button', 'Alterar pedido');
  edit.type = 'button';
  edit.addEventListener('click', () => openEditor(order));
  const whatsapp = element('a', 'admin-secondary-button', 'Abrir no WhatsApp ↗');
  const representative = window.EcofitusRepresentatives.getRepresentative(order.representativeId || 'gabriel');
  whatsapp.href = `https://wa.me/${representative.whatsapp}?text=${encodeURIComponent(order.message)}`;
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener noreferrer';
  actions.append(edit, whatsapp);
  card.append(heading, mirror, actions);
  return card;
}

async function load(throwError = false) {
  $('status').textContent = 'Carregando pedidos...';
  try {
    const data = await request('', { start: $('start-date').value, end: $('end-date').value });
    $('representative-name').textContent = data.representative.name;
    $('period-total').textContent = money(data.totalCents);
    $('period-commission').textContent = money(data.commissionCents ?? Math.round(data.totalCents * 10 / 100));
    $('orders').replaceChildren(...data.orders.map(orderCard));
    $('status').textContent = data.orders.length
      ? `${data.orders.length} pedido(s) encontrado(s) no período.`
      : 'Nenhum pedido encontrado no período.';
  } catch (error) {
    $('status').textContent = error.message;
    if (throwError) throw error;
  }
}

function editedTotal() {
  let total = 0;
  for (const row of document.querySelectorAll('.admin-item-row')) {
    total += Number(row.querySelector('[data-field="quantity"]').value) *
      Math.round(Number(row.querySelector('[data-field="price"]').value.replace(',', '.')) * 100);
  }
  for (const campaign of selectedOrder.campaigns || []) total += campaign.totalCents;
  $('edit-total').textContent = money(total);
}

function itemInput(label, value, type, field) {
  const wrapper = element('label', `admin-item-${field}`, label);
  const input = element('input');
  input.type = type;
  input.value = value;
  input.dataset.field = field;
  input.required = true;
  if (type === 'number') {
    input.min = field === 'price' ? '0.01' : '1';
    input.step = field === 'price' ? '0.01' : '1';
  }
  input.addEventListener('input', editedTotal);
  wrapper.append(input);
  return wrapper;
}

function openEditor(order) {
  selectedOrder = structuredClone(order);
  $('edit-title').textContent = `Pedido ${order.id.slice(0, 8)}`;
  $('edit-company').value = order.companyName;
  if (!window.EcofitusTerms.isValidTerm(order.terms)) {
    const option = element('option', '', order.terms);
    option.value = order.terms;
    $('edit-terms').append(option);
  }
  $('edit-terms').value = order.terms;
  $('edit-items').replaceChildren();
  for (const item of order.items) {
    const row = element('div', 'admin-item-row');
    row.dataset.id = item.id;
    row.dataset.ean = item.ean || '';
    row.append(
      itemInput('Produto', item.name, 'text', 'name'),
      itemInput('Quantidade', item.quantity, 'number', 'quantity'),
      itemInput('Valor unitário (R$)', (item.priceCents / 100).toFixed(2), 'number', 'price')
    );
    $('edit-items').append(row);
  }
  $('edit-status').hidden = true;
  editedTotal();
  $('edit-dialog').showModal();
}

function populateCampaignProductSelect() {
 const select = $('campaign-product-select');
 select.replaceChildren();
 for (const product of catalog) {
   if (!product.ean) continue;
   const option = element('option', '', `${product.name} · ${product.ean}`);
   option.value = product.ean;
   select.append(option);
 }
}

async function loadCampaigns() {
 $('campaign-manager-status').textContent = 'Carregando campanhas...';
 const data = await campaignRequest('');
 campaigns = data.campaigns;
 window.EcofitusCampaigns.setCampaigns(campaigns);
 renderCampaignList();
 $('campaign-manager-status').textContent = `${campaigns.length} campanha(s) cadastrada(s).`;
}

function renderCampaignList() {
 const list = $('campaign-list');
 list.replaceChildren();
 for (const campaign of campaigns) {
   const card = element('article', 'admin-campaign-list-card');
   const image = element('img', 'admin-campaign-list-image');
   image.src = campaign.imageUrl;
   image.alt = `Banner: ${campaign.title}`;
   image.loading = 'lazy';
   const details = element('div', 'admin-campaign-list-details');
   details.append(element('h3', '', campaign.title), element('p', '', campaign.benefit));
   for (const item of campaign.items) {
     const product = catalog.find((entry) => entry.ean === item.ean);
     const price = item.priceCents === undefined
       ? 'preço atual do catálogo'
       : money(item.priceCents);
     details.append(element('span', 'admin-campaign-product-summary',
       `${product ? product.name : item.ean}: ${item.quantity} paga(s), ${item.bonus || 0} bonificada(s) · ${price} por unidade`));
   }
   const actions = element('div', 'admin-campaign-list-actions');
   const edit = element('button', 'lookup-button', 'Editar');
   edit.type = 'button';
   edit.addEventListener('click', () => openCampaignEditor(campaign));
   const remove = element('button', 'admin-secondary-button', 'Excluir');
   remove.type = 'button';
   remove.addEventListener('click', async () => {
     if (!window.confirm(`Excluir a campanha “${campaign.title}” da loja? Os pedidos já salvos não serão alterados.`)) return;
     remove.disabled = true;
     try {
       await campaignRequest('/delete', { campaignId: campaign.id });
       await loadCampaigns();
     } catch (error) {
       $('campaign-manager-status').textContent = error.message;
     } finally {
       remove.disabled = false;
     }
   });
   actions.append(edit, remove);
   card.append(image, details, actions);
   list.append(card);
 }
}

function renderCampaignProductItems() {
 const container = $('campaign-product-items');
 container.replaceChildren();
 editingCampaignItems.forEach((item, index) => {
   const product = catalog.find((entry) => entry.ean === item.ean);
   const row = element('div', 'admin-campaign-product-row');
   row.dataset.ean = item.ean;
   const name = element('strong', 'admin-campaign-product-name', product ? product.name : item.ean);
   const quantity = element('label', '', 'Quantidade paga');
   const quantityInput = element('input');
   quantityInput.type = 'number';
   quantityInput.min = '0';
   quantityInput.step = '1';
   quantityInput.value = item.quantity;
   quantityInput.dataset.field = 'quantity';
   quantity.append(quantityInput);
   const bonus = element('label', '', 'Bonificadas');
   const bonusInput = element('input');
   bonusInput.type = 'number';
   bonusInput.min = '0';
   bonusInput.step = '1';
   bonusInput.value = item.bonus || 0;
   bonusInput.dataset.field = 'bonus';
   bonus.append(bonusInput);
   const price = element('label', '', 'Preço unitário da campanha (R$)');
   const priceInput = element('input');
   priceInput.type = 'number';
   priceInput.min = '0';
   priceInput.step = '0.01';
   priceInput.placeholder = 'Preço do catálogo';
   priceInput.value = item.priceCents === null || item.priceCents === undefined
     ? ''
     : (item.priceCents / 100).toFixed(2);
   priceInput.dataset.field = 'price';
   price.append(priceInput);
   const remove = element('button', 'campaign-remove', 'Remover produto');
   remove.type = 'button';
   remove.addEventListener('click', () => {
     editingCampaignItems.splice(index, 1);
     renderCampaignProductItems();
   });
   row.append(name, quantity, bonus, price, remove);
   container.append(row);
 });
}

function openCampaignEditor(campaign = null) {
 if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
 previewObjectUrl = '';
 editingCampaign = campaign;
 editingCampaignItems = campaign ? structuredClone(campaign.items) : [];
 selectedImageFile = null;
 imageSelectionInvalid = false;
 $('campaign-editor-form').reset();
 $('campaign-editor-title').textContent = campaign ? 'Editar campanha' : 'Adicionar campanha';
 $('campaign-title-input').value = campaign ? campaign.title : '';
 $('campaign-benefit-input').value = campaign ? campaign.benefit : '';
 $('campaign-image-file').value = '';
 $('campaign-image-preview').hidden = !campaign;
 $('campaign-image-preview').src = campaign ? campaign.imageUrl : '';
 $('campaign-image-status').textContent = campaign
   ? 'Imagem atual. Selecione outro arquivo para substituí-la.'
   : 'Selecione uma imagem para o banner.';
 $('campaign-editor-status').hidden = true;
 populateCampaignProductSelect();
 renderCampaignProductItems();
 $('campaign-editor').showModal();
}

function readImageBase64(file) {
 return new Promise((resolve, reject) => {
   const reader = new FileReader();
   reader.onload = () => resolve(String(reader.result).split(',')[1]);
   reader.onerror = () => reject(new Error('Não foi possível ler o arquivo da imagem.'));
   reader.readAsDataURL(file);
 });
}

$('admin-login-form').addEventListener('submit', async (event) => {
 event.preventDefault();
 $('login-status').hidden = true;
 credentials = { email: $('admin-email').value, password: $('admin-password').value };
 try {
   await load(true);
   $('admin-login-panel').hidden = true;
   $('admin-content').hidden = false;
   $('admin-password').value = '';
   const [catalogResult, campaignsResult] = await Promise.allSettled([loadCatalog(), loadCampaigns()]);
   if (catalogResult.status === 'rejected') {
     $('campaign-manager-status').textContent = `Catálogo indisponível para editar produtos: ${catalogResult.reason.message}`;
   }
   if (campaignsResult.status === 'rejected') {
     $('campaign-manager-status').textContent = campaignsResult.reason.message;
   }
 } catch (error) {
   credentials = null;
   $('login-status').textContent = error.message;
   $('login-status').hidden = false;
 }
});

$('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('edit-status').hidden = true;
  const items = Array.from(document.querySelectorAll('.admin-item-row'), (row) => ({
    id: row.dataset.id,
    ean: row.dataset.ean,
    name: row.querySelector('[data-field="name"]').value,
    quantity: Number(row.querySelector('[data-field="quantity"]').value),
    priceCents: Math.round(Number(row.querySelector('[data-field="price"]').value.replace(',', '.')) * 100),
  }));
  try {
    await request(`/${selectedOrder.id}`, {
      orderId: selectedOrder.id,
      changes: { companyName: $('edit-company').value, terms: $('edit-terms').value, items },
    });
    $('edit-dialog').close();
    await load();
  } catch (error) {
    $('edit-status').textContent = error.message;
    $('edit-status').hidden = false;
  }
});

$('campaign-image-file').addEventListener('change', () => {
  const file = $('campaign-image-file').files[0] || null;
  selectedImageFile = file;
  imageSelectionInvalid = false;
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    selectedImageFile = null;
    imageSelectionInvalid = true;
    $('campaign-image-file').value = '';
    $('campaign-editor-status').textContent = 'Selecione uma imagem JPG, PNG ou WebP de até 2 MB.';
    $('campaign-editor-status').hidden = false;
    return;
  }
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = URL.createObjectURL(file);
  $('campaign-image-preview').src = previewObjectUrl;
  $('campaign-image-preview').hidden = false;
  $('campaign-image-status').textContent = 'Prévia da nova imagem selecionada.';
  $('campaign-editor-status').hidden = true;
});

$('add-campaign-product').addEventListener('click', () => {
  const product = catalog.find((entry) => entry.ean === $('campaign-product-select').value);
  if (!product) {
    $('campaign-editor-status').textContent = 'Não há produto válido selecionado no catálogo.';
    $('campaign-editor-status').hidden = false;
    return;
  }
  if (editingCampaignItems.some((item) => item.ean === product.ean)) {
    $('campaign-editor-status').textContent = 'Esse produto já está na campanha.';
    $('campaign-editor-status').hidden = false;
    return;
  }
  editingCampaignItems.push({ ean: product.ean, quantity: product.multiple, bonus: 0, priceCents: null });
  $('campaign-editor-status').hidden = true;
  renderCampaignProductItems();
});

$('campaign-editor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('campaign-editor-status').hidden = true;
  const items = Array.from(document.querySelectorAll('.admin-campaign-product-row'), (row) => {
    const priceValue = row.querySelector('[data-field="price"]').value.trim();
    return {
      ean: row.dataset.ean,
      quantity: Number(row.querySelector('[data-field="quantity"]').value),
      bonus: Number(row.querySelector('[data-field="bonus"]').value),
      priceCents: priceValue === '' ? null : Math.round(Number(priceValue.replace(',', '.')) * 100),
    };
  });
  if (imageSelectionInvalid) {
    $('campaign-editor-status').textContent = 'Corrija o arquivo de imagem selecionado antes de salvar.';
    $('campaign-editor-status').hidden = false;
    return;
  }
  const invalidItem = items.some((item) => {
    const product = catalog.find((entry) => entry.ean === item.ean);
    return !product || !Number.isSafeInteger(item.quantity) || item.quantity < 0 ||
      !Number.isSafeInteger(item.bonus) || item.bonus < 0 ||
      item.quantity + item.bonus < 1 ||
      (item.quantity + item.bonus) % product.multiple !== 0 ||
      (item.priceCents !== null && (!Number.isSafeInteger(item.priceCents) || item.priceCents < 0));
  });
  if (!items.length || invalidItem) {
    $('campaign-editor-status').textContent = 'Revise os produtos: quantidades, bonificações e preços devem ser válidos e respeitar o múltiplo de venda.';
    $('campaign-editor-status').hidden = false;
    return;
  }
  const submit = $('campaign-editor-form').querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    let imageUrl = editingCampaign ? editingCampaign.imageUrl : '';
    if (selectedImageFile) {
      const base64 = await readImageBase64(selectedImageFile);
      const uploaded = await campaignRequest('/image', { mimeType: selectedImageFile.type, base64 });
      imageUrl = uploaded.imageUrl;
    }
    if (!imageUrl) throw new Error('Selecione uma imagem para a campanha.');
    const campaign = {
      id: editingCampaign ? editingCampaign.id : crypto.randomUUID().toLowerCase(),
      title: $('campaign-title-input').value,
      benefit: $('campaign-benefit-input').value,
      imageUrl,
      items,
    };
    await campaignRequest('/save', { campaign });
    await loadCampaigns();
    $('campaign-editor').close();
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
  } catch (error) {
    $('campaign-editor-status').textContent = error.message;
    $('campaign-editor-status').hidden = false;
  } finally {
    submit.disabled = false;
  }
});

$('refresh').addEventListener('click', load);
$('apply-filter').addEventListener('click', load);
$('manage-campaigns').addEventListener('click', () => {
  $('admin-orders-view').hidden = true;
  $('campaign-manager').hidden = false;
});
$('back-to-orders').addEventListener('click', () => {
  $('campaign-manager').hidden = true;
  $('admin-orders-view').hidden = false;
});
$('new-campaign').addEventListener('click', () => openCampaignEditor());
$('close-campaign-editor').addEventListener('click', () => $('campaign-editor').close());
$('campaign-editor').addEventListener('click', (event) => {
  if (event.target === $('campaign-editor')) $('campaign-editor').close();
});
$('close-edit').addEventListener('click', () => $('edit-dialog').close());
$('edit-dialog').addEventListener('click', (event) => {
  if (event.target === $('edit-dialog')) $('edit-dialog').close();
});
$('current-month').addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  $('start-date').value = format(start);
  $('end-date').value = format(end);
  load();
});
$('logout').addEventListener('click', () => {
  credentials = null;
  $('admin-content').hidden = true;
  $('admin-login-panel').hidden = false;
  $('admin-password').value = '';
  $('orders').replaceChildren();
});
