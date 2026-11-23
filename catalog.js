'use strict';

const { getCampaign, campaigns } = require('./public/campaigns');
const { unitPrice } = require('./public/pricing');
const { isValidTerm } = require('./public/terms');
const MAX_AGE_MS = 90 * 1000;
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
    if (!product.promotions || !Array.isArray(product.promotions.sales) ||
        Object.keys(product.promotions).some((key) => key !== 'sales' &&
          product.promotions[key] != null && (!Array.isArray(product.promotions[key]) || product.promotions[key].length))) {
      throw new Error(`Promoções inválidas ou não suportadas para ${product.id}.`);
    }
    const promotions = product.promotions.sales.map((sale) => {
      if (!sale || !Number.isFinite(sale.finalPrice) || sale.finalPrice <= 0 ||
          !Number.isSafeInteger(sale.begin) || !Number.isSafeInteger(sale.end) || sale.end <= sale.begin ||
          !Number.isSafeInteger(sale.minQuantity) || sale.minQuantity < 1 ||
          !Number.isSafeInteger(sale.maxQuantity) || sale.maxQuantity < sale.minQuantity ||
          typeof sale.taxesSuccess !== 'boolean' ||
          sale.promotionCartLimit !== 0 || sale.promotionClientLimit !== 0 || sale.promotionSellerLimit !== 0) {
        throw new Error(`Condições promocionais inválidas ou não suportadas para ${product.id}.`);
      }
      return {
        priceCents: Math.round(sale.finalPrice * 100), taxesConfirmed: sale.taxesSuccess,
        begin: sale.begin, end: sale.end, minQuantity: sale.minQuantity, maxQuantity: sale.maxQuantity,
        promotionId: Number.isSafeInteger(sale.promotionId) ? sale.promotionId : 0,
        promotionTitle: typeof sale.promotionTitle === 'string' ? sale.promotionTitle : '',
      };
    });
    let image = '';
    if (product.hasImage && typeof product.imageURL === 'string') {
      const match = /^(https?):\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(?:[/?#][^\s\\]*)?$/i.exec(product.imageURL);
      if (!match || (match[3] && Number(match[3]) > 65535)) throw new Error(`Imagem inválida para ${product.id}.`);
      if (match[1].toLowerCase() === 'https') image = product.imageURL;
    }
    return {
      id: product.id,
      name: product.name,
      ean: typeof product.ean === 'string' ? product.ean : '',
      maker: typeof product.maker === 'string' ? product.maker : '',
      image,
      principle: typeof product.principle === 'string' ? product.principle : '',
      priceCents: Math.round(price.finalPrice * 100),
      taxesConfirmed: price.taxesSuccess === true,
      promotions,
      stock: price.quantityAvailable,
      multiple: price.multiple,
      boxQuantity: Number.isSafeInteger(product.boxQuantity) && product.boxQuantity > 0 ? product.boxQuantity : 0,
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

function calculateOrder(input, catalog, at = Date.now()) {
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
    const price = unitPrice(product, item.quantity, at);
    total += price.priceCents * item.quantity;
    return { id: product.id, name: product.name, ean: product.ean, quantity: item.quantity, priceCents: price.priceCents };
  });
  const seenCampaigns = new Set();
  const selectedCampaigns = input.campaigns.map((id) => {
    if (typeof id !== 'string' || seenCampaigns.has(id)) throw new Error('Campanha inválida ou duplicada.');
    seenCampaigns.add(id);
    const campaign = getCampaign(id, catalog, at);
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

function verifyPriceQuote(input, order) {
  const quote = input && input.priceQuote;
  const matches = (expected, actual) => Array.isArray(expected) && expected.length === actual.length &&
    new Set(expected.map((entry) => entry && entry.id)).size === expected.length &&
    actual.every((entry) => {
      const quoted = expected.find((item) => item && item.id === entry.id);
      return quoted && quoted.priceCents === entry.priceCents;
    });
  if (!quote || !matches(quote.items, order.items) || !Array.isArray(quote.campaigns) ||
      quote.campaigns.length !== order.campaigns.length ||
      new Set(quote.campaigns.map((entry) => entry && entry.id)).size !== quote.campaigns.length ||
      !order.campaigns.every((campaign) => {
        const quoted = quote.campaigns.find((entry) => entry && entry.id === campaign.id);
        return quoted && matches(quoted.items, campaign.items);
      })) {
    throw new Error('Os preços mudaram ou não puderam ser confirmados. Atualize e revise o pedido.');
  }
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
  if (!isValidTerm(input.terms)) {
    throw new Error('Selecione um prazo válido.');
  }
  const result = calculateOrder({ ...input, campaigns: input.campaigns === undefined ? [] : input.campaigns }, catalog, now);
  const formatLine = (item) => {
    const name = `${item.name.replace(/[\r\n]/g, ' ')} (${item.ean || item.id})`;
    if (!item.quantity) return `${name} — ${item.bonus} bonificadas`;
    return `${name} — ${item.quantity} x ${money(item.priceCents)} = ${money(item.quantity * item.priceCents)}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`;
  };
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

module.exports = { normalizeCatalog, validCnpj, buildOrder, calculateOrder, verifyPriceQuote, MAX_AGE_MS, MINIMUM_CENTS, isValidTerm };
