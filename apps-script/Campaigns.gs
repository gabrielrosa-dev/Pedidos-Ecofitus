function pricingCore_() {
const module = { exports: {} };
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EcofitusPricing = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function unitPrice(product, quantity, at) {
    if (!product || !Array.isArray(product.promotions) || !Number.isSafeInteger(quantity) || quantity < 1 ||
        !Number.isFinite(at)) throw new Error('Preço do produto indisponível. Atualize o catálogo.');
    const matches = product.promotions.filter((sale) =>
      at >= sale.begin && at < sale.end && quantity >= sale.minQuantity && quantity <= sale.maxQuantity);
    matches.sort((a, b) => b.begin - a.begin ||
      (Number.isSafeInteger(b.promotionId) ? b.promotionId : 0) -
      (Number.isSafeInteger(a.promotionId) ? a.promotionId : 0));
    const selected = matches[0];
    if (selected && matches.some((sale) =>
      sale.begin === selected.begin && sale.promotionId === selected.promotionId &&
      (sale.priceCents !== selected.priceCents || sale.taxesConfirmed !== selected.taxesConfirmed))) {
      throw new Error('Há promoções conflitantes. Confirme o preço com a equipe comercial.');
    }
    return selected
      ? { priceCents: selected.priceCents, taxesConfirmed: selected.taxesConfirmed, promotional: true }
      : { priceCents: product.priceCents, taxesConfirmed: product.taxesConfirmed, promotional: false };
  }

  function lowestActiveOffer(product, at) {
    if (!product || !Array.isArray(product.promotions) || !Number.isFinite(at)) {
      throw new Error('Preço do produto indisponível. Atualize o catálogo.');
    }
    const active = product.promotions.filter((sale) => {
      const firstQuantity = Math.max(product.multiple, Math.ceil(sale.minQuantity / product.multiple) * product.multiple);
      return at >= sale.begin && at < sale.end && sale.priceCents < product.priceCents &&
        firstQuantity <= sale.maxQuantity && firstQuantity <= product.stock;
    });
    if (!active.length) return null;
    return active.slice().sort((a, b) => a.priceCents - b.priceCents || a.minQuantity - b.minQuantity ||
      b.begin - a.begin)[0];
  }

  return { unitPrice, lowestActiveOffer };
});

return module.exports;
}
function campaignCore_() {
const module = { exports: {} };
function require(name) { if (name === './pricing') return pricingCore_(); throw new Error('Módulo desconhecido: ' + name); }
'use strict';

(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./pricing') : root.EcofitusPricing);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EcofitusCampaigns = api;
})(typeof globalThis === 'object' ? globalThis : this, function (pricing) {
  const campaigns = [
    { id: 'b12-queimacure', title: '36 B12 + 20 Queimacure grátis', benefit: '20 unidades de Queimacure bonificadas, sujeitas à confirmação comercial.', imageUrl: 'https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/images/campaigns/b12-queimacure.jpeg', items: [{ ean: '7896920307922', quantity: 36 }, { ean: '7896920307403', quantity: 0, bonus: 20 }] },
    { id: 'b12-pix', title: 'B12 — R$ 1.000 no Pix', benefit: 'R$ 1.000 no Pix, sujeito à confirmação comercial.', imageUrl: 'https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/images/campaigns/b12-pix.jpeg', items: [{ ean: '7896920307922', quantity: 200 }] },
    { id: 'barril-chopp', title: 'B12 — barril de chopp', benefit: '1 barril de chopp Heineken de 5 litros, sujeito à confirmação comercial.', imageUrl: 'https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/images/campaigns/barril-chopp.jpeg', items: [{ ean: '7896920307922', quantity: 36 }] },
    { id: 'q10-b12', title: 'B12, Q10 e Milmune — R$ 250 no Pix', benefit: 'R$ 250 no Pix, sujeito à confirmação comercial.', imageUrl: 'https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/images/campaigns/q10-b12.jpeg', items: [{ ean: '7896920307922', quantity: 20 }, { ean: '7896920308523', quantity: 15 }, { ean: '7896920305140', quantity: 15 }] },
    { id: 'regulax', title: 'Regulax — 12 unidades bonificadas', benefit: '12 unidades bonificadas, sujeitas à confirmação comercial.', imageUrl: 'https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/images/campaigns/regulax.jpeg', items: [{ ean: '7896920303979', quantity: 12, bonus: 12 }] },
    { id: 'show-brindes', title: 'Show de brindes — chaleira térmica', benefit: '1 chaleira térmica inox 2L 127V, sujeita à confirmação comercial.', imageUrl: 'https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/images/campaigns/show-brindes.jpeg', items: [{ ean: '7896920307922', quantity: 16 }] },
  ];

  function setCampaigns(nextCampaigns) {
    if (!Array.isArray(nextCampaigns)) throw new Error('Lista de campanhas inválida.');
    campaigns.splice(0, campaigns.length, ...nextCampaigns);
  }

  function getCampaign(id, products, at = Date.now()) {
    const campaign = campaigns.find((entry) => entry.id === id);
    if (!campaign) throw new Error('Campanha inválida.');
    const lines = campaign.items.map((item) => {
      const product = products.find((entry) => entry.ean === item.ean);
      if (!product) throw new Error(`Produto da campanha não encontrado: ${item.ean}.`);
      const quantity = item.quantity + (item.bonus || 0);
      if (quantity % product.multiple !== 0) throw new Error('A quantidade da campanha não respeita o múltiplo de venda.');
      const priceCents = item.quantity
        ? (Number.isSafeInteger(item.priceCents)
          ? item.priceCents
          : pricing.unitPrice(product, item.quantity, at).priceCents)
        : 0;
      if (priceCents < 0) throw new Error('Preço da campanha inválido.');
      return { product, quantity: item.quantity, bonus: item.bonus || 0, priceCents };
    });
    return { ...campaign, lines, totalCents: lines.reduce((sum, line) => sum + line.quantity * line.priceCents, 0) };
  }
  return { campaigns, getCampaign, setCampaigns };
});

return module.exports;
}
