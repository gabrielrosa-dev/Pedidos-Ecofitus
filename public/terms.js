'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EcofitusTerms = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const terms = [
    '7 dias',
    '7/14 dias',
    '7/14/21 dias',
    '7/14/21/28 dias',
    '7/14/21/28/35 dias',
    '7/14/21/28/35/42 dias',
    '10/20/30/40/50 dias',
    '10/20/30/40/50/60 dias',
    '14 dias',
    '14/21/28 dias',
    '15/30/45 dias',
    '15/30/45/60 dias',
    '15/30/45/60/75 dias',
    '20/30 dias',
    '21 dias',
    '21/28/35 dias',
    '28 dias',
    '28/35/42 dias',
    '28/35/42/48/55/62 dias',
    '30 dias',
    '30/35 dias',
    '30/35/42/49/56 dias',
    '30/45 dias',
    '30/45/60 dias',
    '30/45/60/75 dias',
    '30/45/60/75/90/105 dias',
    '35 dias',
    '35/42/49 dias',
    '35/42/49/56 dias',
    '45 dias',
    '45/60 dias',
    '45/60/75 dias',
    '50 dias',
    '60 dias',
    '75 dias',
    '90 dias',
  ];

  function normalizeTerm(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isValidTerm(value) {
    return terms.includes(normalizeTerm(value));
  }

  return { terms, normalizeTerm, isValidTerm };
});
