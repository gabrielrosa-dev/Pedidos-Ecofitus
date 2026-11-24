'use strict';

const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);
let credentials = null;
let selectedOrder = null;
let catalog = [];
let catalogUpdatedAt = Date.now();
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
  try {
    const snapshot = await window.ecofitusRequest('/api/catalog');
    catalog = snapshot.products || [];
    catalogUpdatedAt = snapshot.updatedAt || Date.now();
  } catch (error) {
    catalog = [];
  }
}

function request(operation, values = {}) {
  return window.ecofitusRequest(`/api/admin/orders${operation}`, {
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
  for (const campaign of document.querySelectorAll('.admin-campaign-card')) {
    for (const row of campaign.querySelectorAll('.admin-campaign-item-row')) {
      total += Number(row.querySelector('[data-field="campaign-quantity"]').value) *
        Math.round(Number(row.querySelector('[data-field="campaign-price"]').value.replace(',', '.')) * 100);
    }
  }
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
    input.min = field === 'campaign-bonus' || field === 'campaign-quantity' || field === 'campaign-price' ? '0' : (field === 'price' ? '0.01' : '1');
    input.step = field === 'price' || field === 'campaign-price' ? '0.01' : '1';
  }
  input.addEventListener('input', editedTotal);
  wrapper.append(input);
  return wrapper;
}

function campaignItemRow(item) {
  const row = element('div', 'admin-campaign-item-row');
  row.dataset.id = item.id;
  row.dataset.ean = item.ean || '';
  row.append(
    itemInput('Produto', item.name, 'text', 'campaign-name'),
    itemInput('Quantidade', item.quantity || 0, 'number', 'campaign-quantity'),
    itemInput('Bonificadas', item.bonus || 0, 'number', 'campaign-bonus'),
    itemInput('Valor unitário (R$)', (item.priceCents / 100).toFixed(2), 'number', 'campaign-price')
  );
  return row;
}

function renderCampaignEditor() {
  const container = $('edit-campaigns');
  container.replaceChildren();
  for (const campaign of selectedOrder.campaigns || []) {
    const card = element('article', 'admin-campaign-card');
    card.dataset.campaignId = campaign.id;
    const heading = element('div', 'admin-campaign-card-heading');
    const title = element('input', 'admin-campaign-title');
    title.value = campaign.title;
    title.required = true;
    title.maxLength = 300;
    const remove = element('button', 'campaign-remove', 'Remover campanha');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      selectedOrder.campaigns = selectedOrder.campaigns.filter((entry) => entry.id !== campaign.id);
      for (const option of $('campaign-to-add').options) {
        option.disabled = selectedOrder.campaigns.some((entry) => entry.id === option.value);
      }
      renderCampaignEditor();
      editedTotal();
    });
    heading.append(title, remove);
    const benefit = element('label', 'admin-campaign-benefit', 'Benefício solicitado');
    const benefitInput = element('input');
    benefitInput.value = campaign.benefit || '';
    benefitInput.maxLength = 1000;
    benefit.append(benefitInput);
    const items = element('div', 'admin-campaign-items');
    for (const item of campaign.items || []) items.append(campaignItemRow(item));
    card.append(heading, benefit, items);
    container.append(card);
  }
  editedTotal();
}

function addCampaign(id) {
  const config = window.EcofitusCampaigns.campaigns.find((campaign) => campaign.id === id);
  if (!config || (selectedOrder.campaigns || []).some((campaign) => campaign.id === id)) return;
  const items = config.items.map((configItem) => {
    const product = catalog.find((entry) => entry.ean === configItem.ean);
    let priceCents = 0;
    if (product && configItem.quantity) {
      priceCents = window.EcofitusPricing.unitPrice(product, configItem.quantity, catalogUpdatedAt).priceCents;
    }
    return {
      id: product ? product.id : `${config.id}-${configItem.ean}`,
      ean: configItem.ean,
      name: product ? product.name : `Produto ${configItem.ean}`,
      quantity: configItem.quantity,
      bonus: configItem.bonus || 0,
      priceCents,
    };
  });
  selectedOrder.campaigns = [...(selectedOrder.campaigns || []), {
    id: config.id,
    title: config.title,
    benefit: config.benefit,
    items,
  }];
  for (const option of $('campaign-to-add').options) {
    option.disabled = selectedOrder.campaigns.some((entry) => entry.id === option.value);
  }
  renderCampaignEditor();
}

function openEditor(order) {
  selectedOrder = structuredClone(order);
  selectedOrder.campaigns = Array.isArray(order.campaigns) ? structuredClone(order.campaigns) : [];
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
  const campaignSelect = $('campaign-to-add');
  campaignSelect.replaceChildren();
  for (const campaign of window.EcofitusCampaigns.campaigns) {
    const option = element('option', '', campaign.title);
    option.value = campaign.id;
    option.disabled = selectedOrder.campaigns.some((entry) => entry.id === campaign.id);
    campaignSelect.append(option);
  }
  renderCampaignEditor();
  $('edit-status').hidden = true;
  editedTotal();
  $('edit-dialog').showModal();
}

$('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-status').hidden = true;
  credentials = { email: $('admin-email').value, password: $('admin-password').value };
  try {
    await load(true);
    await loadCatalog();
    $('admin-login-panel').hidden = true;
    $('admin-content').hidden = false;
    $('admin-password').value = '';
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
  const campaigns = Array.from(document.querySelectorAll('.admin-campaign-card'), (card) => ({
    id: card.dataset.campaignId,
    title: card.querySelector('.admin-campaign-title').value,
    benefit: card.querySelector('.admin-campaign-benefit input').value,
    items: Array.from(card.querySelectorAll('.admin-campaign-item-row'), (row) => ({
      id: row.dataset.id,
      ean: row.dataset.ean,
      name: row.querySelector('[data-field="campaign-name"]').value,
      quantity: Number(row.querySelector('[data-field="campaign-quantity"]').value),
      bonus: Number(row.querySelector('[data-field="campaign-bonus"]').value),
      priceCents: Math.round(Number(row.querySelector('[data-field="campaign-price"]').value.replace(',', '.')) * 100),
    })),
  }));
  try {
    await request(`/${selectedOrder.id}`, {
      orderId: selectedOrder.id,
      changes: { companyName: $('edit-company').value, terms: $('edit-terms').value, items, campaigns },
    });
    $('edit-dialog').close();
    await load();
  } catch (error) {
    $('edit-status').textContent = error.message;
    $('edit-status').hidden = false;
  }
});

$('refresh').addEventListener('click', load);
$('apply-filter').addEventListener('click', load);
$('add-campaign').addEventListener('click', () => addCampaign($('campaign-to-add').value));
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
