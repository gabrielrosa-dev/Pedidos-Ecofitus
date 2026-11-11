'use strict';
const status = document.getElementById('status');
const list = document.getElementById('orders');
async function load() {
  status.textContent = 'Carregando pedidos...';
  try {
    const response = await fetch('/api/admin/orders', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar o histórico.');
    const data = await response.json();
    list.replaceChildren();
    status.textContent = data.orders.length ? `${data.orders.length} pedido(s) preparado(s).` : 'Nenhum pedido preparado.';
    for (const order of data.orders) {
      const card = document.createElement('article');
      card.className = 'admin-order';
      const text = document.createElement('pre');
      text.textContent = order.message;
      const link = document.createElement('a');
      link.textContent = 'Abrir pedido no WhatsApp ↗';
      link.href = `https://wa.me/5541995922369?text=${encodeURIComponent(order.message)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(text, link);
      list.append(card);
    }
  } catch (error) {
    status.textContent = error.message;
  }
}
document.getElementById('refresh').addEventListener('click', load);
load();
