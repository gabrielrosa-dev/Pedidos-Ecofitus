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
    if (matches.length > 1 && matches.some((sale) =>
      sale.priceCents !== matches[0].priceCents || sale.taxesConfirmed !== matches[0].taxesConfirmed)) {
      throw new Error('Há promoções conflitantes. Confirme o preço com a equipe comercial.');
    }
    const selected = matches[0];
    return selected
      ? { priceCents: selected.priceCents, taxesConfirmed: selected.taxesConfirmed, promotional: true }
      : { priceCents: product.priceCents, taxesConfirmed: product.taxesConfirmed, promotional: false };
  }
  return { unitPrice };
});
