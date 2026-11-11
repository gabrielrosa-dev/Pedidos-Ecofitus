function catalogCore_() {
const module = { exports: {} };
function require(name) { if (name === './public/campaigns') return campaignCore_(); throw new Error('Módulo desconhecido: ' + name); }
'use strict';

const { getCampaign, campaigns } = require('./public/campaigns');
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

function calculateOrder(input, catalog) {
  if (!Array.isArray(input.items) || input.items.length > catalog.length ||
      !Array.isArray(input.campaigns) || input.campaigns.length > campaigns.length ||
      (!input.items.length && !input.campaigns.length)) {
    throw new Error('Adicione produtos ao pedido.');
  }
  const products = new Map(catalog.map((p) => [p.id, p]));
  const seen = new Set();
  const quantities = new Map();
  let total = 0;
  const reserve = (product, quantity) => {
    const combined = (quantities.get(product.id) || 0) + quantity;
    if (!Number.isSafeInteger(combined) || combined > product.stock || combined % product.multiple !== 0) {
      throw new Error('Há produtos indisponíveis ou quantidades inválidas. Revise seu carrinho.');
    }
    quantities.set(product.id, combined);
  };
  const items = input.items.map((item) => {
    const product = item && products.get(item.id);
    if (!product || seen.has(item.id) || !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 || item.quantity % product.multiple !== 0) {
      throw new Error('Há produtos indisponíveis ou quantidades inválidas. Revise seu carrinho.');
    }
    seen.add(item.id);
    reserve(product, item.quantity);
    total += product.priceCents * item.quantity;
    return { id: product.id, name: product.name, ean: product.ean, quantity: item.quantity, priceCents: product.priceCents };
  });
  const seenCampaigns = new Set();
  const selectedCampaigns = input.campaigns.map((id) => {
    if (typeof id !== 'string' || seenCampaigns.has(id)) throw new Error('Campanha inválida ou duplicada.');
    seenCampaigns.add(id);
    const campaign = getCampaign(id, catalog);
    const lines = campaign.lines.map((line) => {
      reserve(line.product, line.quantity + line.bonus);
      return { id: line.product.id, name: line.product.name, ean: line.product.ean, quantity: line.quantity, bonus: line.bonus, priceCents: line.priceCents };
    });
    total += campaign.totalCents;
    return { id, title: campaign.title, benefit: campaign.benefit, items: lines, totalCents: campaign.totalCents };
  });
  if (!Number.isSafeInteger(total)) throw new Error('Valor do pedido inválido.');
  if (total < MINIMUM_CENTS) throw new Error('O pedido mínimo é de R$ 50,00.');
  return { items, campaigns: selectedCampaigns, totalCents: total };
}

function buildOrder(input, catalog, updatedAt, companyName, now = Date.now()) {
  if (!updatedAt || now - updatedAt > MAX_AGE_MS || now < updatedAt) {
    throw new Error('Catálogo desatualizado. Aguarde a atualização para enviar o pedido.');
  }
  if (!input || typeof input.cnpj !== 'string' || !validCnpj(input.cnpj)) {
    throw new Error('Informe um CNPJ válido.');
  }
  if (typeof companyName !== 'string' || !companyName.trim()) {
    throw new Error('Não foi possível confirmar a razão social.');
  }
  if (typeof input.terms !== 'string' || input.terms.trim().length < 2 ||
      input.terms.trim().length > 100 || /[\r\n]/.test(input.terms)) {
    throw new Error('Informe o prazo liberado em até 100 caracteres.');
  }
  const result = calculateOrder({ ...input, campaigns: input.campaigns === undefined ? [] : input.campaigns }, catalog);
  const formatLine = (item) => `${item.name.replace(/[\r\n]/g, ' ')} (${item.ean || item.id}) — ${item.quantity} x ${money(item.priceCents)} = ${money(item.quantity * item.priceCents)}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`;
  const lines = result.items.map(formatLine);
  for (const campaign of result.campaigns) {
    lines.push('', `*Campanha: ${campaign.title}*`, ...campaign.items.map(formatLine), `Benefício solicitado: ${campaign.benefit}`, `Subtotal campanha: ${money(campaign.totalCents)}`);
  }
  return [
    '*Pedido Ecofitus*',
    `CNPJ: ${input.cnpj.replace(/\D/g, '')}`,
    `Razão social: ${companyName.replace(/[\r\n]/g, ' ').trim()}`,
    `Prazo informado: ${input.terms.trim()}`,
    '',
    ...lines,
    '',
    `*Total: ${money(result.totalCents)}*`,
    'Prazo, preços e disponibilidade sujeitos à confirmação comercial.',
  ].join('\n');
}

function money(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

module.exports = { normalizeCatalog, validCnpj, buildOrder, calculateOrder, MAX_AGE_MS, MINIMUM_CENTS };

return module.exports;
}
