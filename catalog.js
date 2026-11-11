'use strict';

const MAX_AGE_MS = 10 * 60 * 1000;
const MINIMUM_CENTS = 5000;

function normalizeCatalog(raw) {
  if (!raw || !Array.isArray(raw.products)) throw new Error('Resposta do catálogo inválida.');
  const ids = new Set();
  return raw.products.map((product) => {
    if (!product || typeof product.id !== 'string' || ids.has(product.id) ||
        typeof product.name !== 'string' || !Array.isArray(product.prices) ||
        product.prices.length !== 1) {
      throw new Error('Produto inválido ou com múltiplas tabelas de preço.');
    }
    ids.add(product.id);
    const price = product.prices[0];
    if (!Number.isFinite(price.finalPrice) || price.finalPrice <= 0 ||
        !Number.isInteger(price.quantityAvailable) || price.quantityAvailable < 0 ||
        !Number.isInteger(price.multiple) || price.multiple < 1) {
      throw new Error(`Preço ou estoque inválido para ${product.id}.`);
    }
    let image = '';
    if (product.hasImage && typeof product.imageURL === 'string') {
      try {
        const url = new URL(product.imageURL);
        if (url.protocol === 'https:') image = url.href;
      } catch {
        throw new Error(`Imagem inválida para ${product.id}.`);
      }
    }
    return {
      id: product.id,
      name: product.name,
      ean: typeof product.ean === 'string' ? product.ean : '',
      maker: typeof product.maker === 'string' ? product.maker : '',
      image,
      priceCents: Math.round(price.finalPrice * 100),
      taxesConfirmed: price.taxesSuccess === true,
      stock: price.quantityAvailable,
      multiple: price.multiple,
    };
  });
}

function validCnpj(value) {
  const cnpj = String(value).replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  for (let length = 12; length <= 13; length++) {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(cnpj[i]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const remainder = sum % 11;
    if (Number(cnpj[length]) !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}

function buildOrder(input, catalog, updatedAt, now = Date.now()) {
  if (!updatedAt || now - updatedAt > MAX_AGE_MS || now < updatedAt) {
    throw new Error('Catálogo desatualizado. Aguarde a atualização para enviar o pedido.');
  }
  if (!input || typeof input.cnpj !== 'string' || !validCnpj(input.cnpj)) {
    throw new Error('Informe um CNPJ válido.');
  }
  if (typeof input.terms !== 'string' || input.terms.trim().length < 2 ||
      input.terms.trim().length > 100 || /[\r\n]/.test(input.terms)) {
    throw new Error('Informe o prazo liberado em até 100 caracteres.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > catalog.length) {
    throw new Error('Adicione produtos ao pedido.');
  }
  const products = new Map(catalog.map((p) => [p.id, p]));
  const seen = new Set();
  let total = 0;
  const lines = input.items.map((item) => {
    const product = item && products.get(item.id);
    if (!product || seen.has(item.id) || !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > product.stock ||
        item.quantity % product.multiple !== 0) {
      throw new Error('Há produtos indisponíveis ou quantidades inválidas. Revise seu carrinho.');
    }
    seen.add(item.id);
    const subtotal = product.priceCents * item.quantity;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) {
      throw new Error('Valor do pedido inválido.');
    }
    total += subtotal;
    return `${product.name.replace(/[\r\n]/g, ' ')} (${product.ean || product.id}) — ${item.quantity} x ${money(product.priceCents)} = ${money(subtotal)}`;
  });
  if (total < MINIMUM_CENTS) throw new Error('O pedido mínimo é de R$ 50,00.');
  return [
    '*Pedido Ecofitus*',
    `CNPJ: ${input.cnpj.replace(/\D/g, '')}`,
    `Prazo informado: ${input.terms.trim()}`,
    '',
    ...lines,
    '',
    `*Total: ${money(total)}*`,
    'Prazo, preços e disponibilidade sujeitos à confirmação comercial.',
  ].join('\n');
}

function money(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = { normalizeCatalog, validCnpj, buildOrder, MAX_AGE_MS, MINIMUM_CENTS };
