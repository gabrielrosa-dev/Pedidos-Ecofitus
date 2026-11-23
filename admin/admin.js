'use strict';

const status = document.getElementById('status');
const list = document.getElementById('orders');
const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let selectedOrder = null;
for (const term of window.EcofitusTerms.terms) {
  const option = document.createElement('option');
  option.value = term;
  option.textContent = term;
  document.getElementById('edit-terms').append(option);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível processar a solicitação.');
  return data;
}

function dateRangeQuery() {
  const params = new URLSearchParams();
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return params.size ? `?${params}` : '';
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

async function load() {
  status.textContent = 'Carregando pedidos...';
  try {
    const data = await request(`/api/admin/orders${dateRangeQuery()}`);
    document.getElementById('representative-name').textContent = data.representative.name;
    document.getElementById('period-total').textContent = money(data.totalCents);
    list.replaceChildren(...data.orders.map(orderCard));
    status.textContent = data.orders.length
      ? `${data.orders.length} pedido(s) encontrado(s) no período.`
      : 'Nenhum pedido encontrado no período.';
  } catch (error) {
    status.textContent = error.message;
  }
}

function editedTotal() {
  let total = 0;
  for (const row of document.querySelectorAll('.admin-item-row')) {
    total += Number(row.querySelector('[data-field="quantity"]').value) *
      Math.round(Number(row.querySelector('[data-field="price"]').value.replace(',', '.')) * 100);
  }
  for (const campaign of selectedOrder.campaigns || []) total += campaign.totalCents;
  document.getElementById('edit-total').textContent = money(total);
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
  document.getElementById('edit-title').textContent = `Pedido ${order.id.slice(0, 8)}`;
  document.getElementById('edit-company').value = order.companyName;
  const termsSelect = document.getElementById('edit-terms');
  if (!window.EcofitusTerms.isValidTerm(order.terms) && !Array.from(termsSelect.options).some((option) => option.value === order.terms)) {
    const option = document.createElement('option');
    option.value = order.terms;
    option.textContent = order.terms;
    termsSelect.append(option);
  }
  termsSelect.value = order.terms;
  const container = document.getElementById('edit-items');
  container.replaceChildren();
  for (const item of order.items) {
    const row = element('div', 'admin-item-row');
    row.dataset.id = item.id;
    row.dataset.ean = item.ean || '';
    row.append(
      itemInput('Produto', item.name, 'text', 'name'),
      itemInput('Quantidade', item.quantity, 'number', 'quantity'),
      itemInput('Valor unitário (R$)', (item.priceCents / 100).toFixed(2), 'number', 'price')
    );
    container.append(row);
  }
  document.getElementById('edit-status').hidden = true;
  editedTotal();
  document.getElementById('edit-dialog').showModal();
}

document.getElementById('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('edit-status');
  error.hidden = true;
  const items = Array.from(document.querySelectorAll('.admin-item-row'), (row) => ({
    id: row.dataset.id,
    ean: row.dataset.ean,
    name: row.querySelector('[data-field="name"]').value,
    quantity: Number(row.querySelector('[data-field="quantity"]').value),
    priceCents: Math.round(Number(row.querySelector('[data-field="price"]').value.replace(',', '.')) * 100),
  }));
  try {
    await request(`/api/admin/orders/${selectedOrder.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: document.getElementById('edit-company').value,
        terms: document.getElementById('edit-terms').value,
        items,
      }),
    });
    document.getElementById('edit-dialog').close();
    await load();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  }
});

document.getElementById('refresh').addEventListener('click', load);
document.getElementById('apply-filter').addEventListener('click', load);
document.getElementById('close-edit').addEventListener('click', () => document.getElementById('edit-dialog').close());
document.getElementById('edit-dialog').addEventListener('click', (event) => {
  if (event.target === document.getElementById('edit-dialog')) document.getElementById('edit-dialog').close();
});
document.getElementById('current-month').addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  document.getElementById('start-date').value = format(start);
  document.getElementById('end-date').value = format(end);
  load();
});
load();
