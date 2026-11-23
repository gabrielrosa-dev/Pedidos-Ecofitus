'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EcofitusRepresentatives = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const representatives = [
    { id: 'gabriel', name: 'Gabriel', whatsapp: '5541995922369' },
    { id: 'vanderson', name: 'Vanderson', whatsapp: '5541988604367' },
  ];

  function getRepresentative(id) {
    const representative = representatives.find((entry) => entry.id === id);
    if (!representative) throw new Error('Acesse o catálogo pelo link enviado pelo seu representante.');
    return representative;
  }

  function representativeFromSearch(search) {
    const params = new URLSearchParams(search || '');
    return getRepresentative(params.get('representante'));
  }

  return { representatives, getRepresentative, representativeFromSearch };
});
