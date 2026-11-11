'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EcofitusCampaigns = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const campaigns = [
    { id: 'b12-pix', title: 'B12 — R$ 1.000 no Pix', benefit: 'R$ 1.000 no Pix, sujeito à confirmação comercial.', items: [{ ean: '7896920307922', quantity: 200 }] },
    { id: 'barril-chopp', title: 'B12 — barril de chopp', benefit: '1 barril de chopp Heineken de 5 litros, sujeito à confirmação comercial.', items: [{ ean: '7896920307922', quantity: 36, priceCents: 2499 }] },
    { id: 'q10-b12', title: 'B12, Q10 e Milmune — R$ 250 no Pix', benefit: 'R$ 250 no Pix, sujeito à confirmação comercial.', items: [{ ean: '7896920307922', quantity: 20 }, { ean: '7896920308523', quantity: 15 }, { ean: '7896920305140', quantity: 15 }] },
    { id: 'regulax', title: 'Regulax — 12 unidades bonificadas', benefit: '12 unidades bonificadas, sujeitas à confirmação comercial.', items: [{ ean: '7896920303979', quantity: 12, bonus: 12, priceCents: 1912 }] },
    { id: 'show-brindes', title: 'Show de brindes — chaleira térmica', benefit: '1 chaleira térmica inox 2L 127V, sujeita à confirmação comercial.', items: [{ ean: '7896920307922', quantity: 16 }] },
  ];

  function getCampaign(id, products) {
    const campaign = campaigns.find((entry) => entry.id === id);
    if (!campaign) throw new Error('Campanha inválida.');
    const lines = campaign.items.map((item) => {
      const product = products.find((entry) => entry.ean === item.ean);
      if (!product) throw new Error(`Produto da campanha não encontrado: ${item.ean}.`);
      const quantity = item.quantity + (item.bonus || 0);
      if (quantity % product.multiple !== 0) throw new Error('A quantidade da campanha não respeita o múltiplo de venda.');
      return { product, quantity: item.quantity, bonus: item.bonus || 0, priceCents: item.priceCents ?? product.priceCents };
    });
    return { ...campaign, lines, totalCents: lines.reduce((sum, line) => sum + line.quantity * line.priceCents, 0) };
  }
  return { campaigns, getCampaign };
});
