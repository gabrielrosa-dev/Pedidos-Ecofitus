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
