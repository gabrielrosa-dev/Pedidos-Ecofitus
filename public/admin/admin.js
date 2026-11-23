'use strict';

const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);
let credentials = null;
let selectedOrder = null;
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

$('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-status').hidden = true;
  credentials = { email: $('admin-email').value, password: $('admin-password').value };
  try {
    await load(true);
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

$('refresh').addEventListener('click', load);
$('apply-filter').addEventListener('click', load);
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
