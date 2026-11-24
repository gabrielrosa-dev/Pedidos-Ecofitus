'use strict';
const { validCnpj } = require('./catalog');

async function lookupCompany(value) {
  if (typeof value !== 'string' || !validCnpj(value)) throw new Error('Informe um CNPJ válido.');
  const cnpj = value.replace(/\D/g, '');
  let response;
  try {
    response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'PedidosEcofitus/1.0 (CNPJ lookup)' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    console.error('Falha na consulta BrasilAPI:', error.message);
    return { cnpj, name: 'Razão social não localizada' };
  }
  if (response.status === 404) return { cnpj, name: 'Razão social não localizada' };
  if (!response.ok) {
    console.error('BrasilAPI retornou HTTP', response.status);
    return { cnpj, name: 'Razão social não localizada' };
  }
  let data;
  try { data = await response.json(); } catch {
    return { cnpj, name: 'Razão social não localizada' };
  }
  if (data.cnpj !== cnpj || typeof data.razao_social !== 'string' || !data.razao_social.trim()) {
    return { cnpj, name: 'Razão social não localizada' };
  }
  return { cnpj, name: data.razao_social.trim().replace(/[\r\n]/g, ' ') };
}

module.exports = { lookupCompany };
