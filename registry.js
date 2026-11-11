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
    throw new Error('Não foi possível consultar o CNPJ. Tente novamente.');
  }
  if (response.status === 404) throw new Error('CNPJ não encontrado na BrasilAPI.');
  if (!response.ok) {
    console.error('BrasilAPI retornou HTTP', response.status);
    throw new Error('Consulta de CNPJ indisponível. Tente novamente.');
  }
  let data;
  try { data = await response.json(); } catch {
    throw new Error('Resposta inválida da consulta de CNPJ.');
  }
  if (data.cnpj !== cnpj || typeof data.razao_social !== 'string' || !data.razao_social.trim()) {
    throw new Error('A consulta não retornou uma razão social válida.');
  }
  return { cnpj, name: data.razao_social.trim().replace(/[\r\n]/g, ' ') };
}

module.exports = { lookupCompany };
