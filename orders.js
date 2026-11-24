'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let queue = Promise.resolve();

function fingerprint(input) {
  const canonical = {
    representativeId: input.representativeId,
    cnpj: input.cnpj.replace(/\D/g, ''),
    terms: input.terms.trim(),
    items: input.items.map(({ id, quantity }) => ({ id, quantity })).sort((a, b) => a.id.localeCompare(b.id)),
    campaigns: (input.campaigns || []).slice().sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function saveOrder(directory, id, order, hash) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Identificador de pedido inválido.');
  const operation = queue.then(async () => {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${id}.json`);
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      if (saved.fingerprint !== hash) throw new Error('Este identificador já pertence a outro pedido.');
      return saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const saved = { id, ...order, fingerprint: hash };
    const temp = path.join(directory, `.${id}.${process.pid}.tmp`);
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(saved), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temp, file);
    } catch (error) {
      if (handle) await handle.close();
      try { await fs.unlink(temp); } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('Falha ao remover arquivo temporário de pedido:', cleanupError.message);
      }
      throw error;
    }
    return saved;
  });
  queue = operation.catch(() => {});
  return operation;
}

async function listOrders(directory) {
  let files;
  try { files = await fs.readdir(directory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const orders = [];
  for (const file of files) {
    if (!file.endsWith('.json') || !ID.test(file.slice(0, -5))) continue;
    const order = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
    const { fingerprint: ignored, ...visible } = order;
    orders.push(visible);
  }
  return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function validateEditedOrder(order, input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items) || input.items.length > 200) {
    throw new Error('Os produtos do pedido são inválidos.');
  }
  if (typeof input.companyName !== 'string' || !input.companyName.trim() || input.companyName.length > 300 ||
      /[\r\n]/.test(input.companyName)) throw new Error('Informe uma razão social válida.');
  if (typeof input.terms !== 'string' || !input.terms.trim() || input.terms.length > 100 ||
      /[\r\n]/.test(input.terms)) throw new Error('Informe um prazo válido.');
  const ids = new Set();
  const items = input.items.map((item) => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || item.id.length > 100) {
      throw new Error('Há produtos inválidos ou duplicados.');
    }
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 ||
        typeof item.ean !== 'string' || item.ean.length > 100 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        !Number.isSafeInteger(item.priceCents) || item.priceCents < 1) {
      throw new Error(`Revise nome, quantidade e valor de ${item && item.name ? item.name : 'um produto'}.`);
    }
    return {
      id: item.id, name: item.name.trim().replace(/[\r\n]/g, ' '), ean: item.ean,
      quantity: item.quantity, priceCents: item.priceCents,
    };
  });
  let campaigns = Array.isArray(order.campaigns) ? order.campaigns : [];
  if (input.campaigns !== undefined) {
    if (!Array.isArray(input.campaigns) || input.campaigns.length > 20) {
      throw new Error('As campanhas do pedido são inválidas.');
    }
    const campaignIds = new Set();
    campaigns = input.campaigns.map((campaign) => {
      if (!campaign || typeof campaign.id !== 'string' || campaignIds.has(campaign.id) ||
          typeof campaign.title !== 'string' || !campaign.title.trim() || campaign.title.length > 300 ||
          typeof campaign.benefit !== 'string' || campaign.benefit.length > 1000 ||
          !Array.isArray(campaign.items) || campaign.items.length > 50) {
        throw new Error('Revise o título e os produtos das campanhas.');
      }
      campaignIds.add(campaign.id);
      const itemIds = new Set();
      let totalCents = 0;
      const campaignItems = campaign.items.map((item) => {
        if (!item || typeof item.id !== 'string' || itemIds.has(item.id) || item.id.length > 100 ||
            typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 ||
            typeof item.ean !== 'string' || item.ean.length > 100 ||
            !Number.isSafeInteger(item.quantity) || item.quantity < 0 ||
            !Number.isSafeInteger(item.bonus) || item.bonus < 0 ||
            (!item.quantity && !item.bonus) ||
            !Number.isSafeInteger(item.priceCents) || item.priceCents < 0) {
          throw new Error('Revise quantidade, bonificação e valor dos itens da campanha.');
        }
        itemIds.add(item.id);
        totalCents += item.quantity * item.priceCents;
        return {
          id: item.id, name: item.name.trim().replace(/[\r\n]/g, ' '),
          ean: item.ean, quantity: item.quantity, bonus: item.bonus, priceCents: item.priceCents,
        };
      });
      if (!campaignItems.length || !Number.isSafeInteger(totalCents)) throw new Error('Valor da campanha inválido.');
      return {
        id: campaign.id, title: campaign.title.trim(), benefit: campaign.benefit.trim(),
        items: campaignItems, totalCents,
      };
    });
  }
  if (!items.length && !campaigns.length) throw new Error('O pedido deve conter ao menos um produto.');
  const totalCents = items.reduce((total, item) => total + item.quantity * item.priceCents, 0) +
    campaigns.reduce((total, campaign) => total + campaign.totalCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('Valor total inválido.');
  return { items, campaigns, totalCents, companyName: input.companyName.trim(), terms: input.terms.trim() };
}

function buildEditedMessage(order, changes) {
  const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const lines = changes.items.map((item) =>
    `${item.name.replace(/[\r\n]/g, ' ')} (${item.ean || item.id}) — ${item.quantity} x ${money(item.priceCents)} = ${money(item.quantity * item.priceCents)}`);
  for (const campaign of changes.campaigns) {
    lines.push('', `*Campanha: ${campaign.title}*`, ...campaign.items.map((item) => {
      const base = `${item.name.replace(/[\r\n]/g, ' ')} (${item.ean || item.id})`;
      return item.quantity
        ? `${base} — ${item.quantity} x ${money(item.priceCents)} = ${money(item.quantity * item.priceCents)}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`
        : `${base} — ${item.bonus} bonificadas`;
    }), `Benefício solicitado: ${campaign.benefit}`, `Subtotal campanha: ${money(campaign.totalCents)}`);
  }
  return [
    '*Pedido Ecofitus*',
    `CNPJ: ${order.cnpj}`,
    `Razão social: ${changes.companyName}`,
    `Prazo informado: ${changes.terms}`,
    '',
    ...lines,
    '',
    `*Total: ${money(changes.totalCents)}*`,
    'Prazo, preços e disponibilidade sujeitos à confirmação comercial.',
    `Número do pedido: ${order.id}`,
    `Preparado em: ${new Date(order.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    `Alterado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  ].join('\n');
}

async function updateOrder(directory, id, representativeId, input) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Identificador de pedido inválido.');
  const operation = queue.then(async () => {
    const file = path.join(directory, `${id}.json`);
    const order = JSON.parse(await fs.readFile(file, 'utf8'));
    if ((order.representativeId || 'gabriel') !== representativeId) throw new Error('Pedido não pertence a este representante.');
    const changes = validateEditedOrder(order, input);
    const updated = {
      ...order,
      ...changes,
      updatedAt: new Date().toISOString(),
      message: buildEditedMessage(order, changes),
      editedByRepresentative: true,
    };
    const temp = path.join(directory, `.${id}.${process.pid}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(updated), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temp, file);
    } catch (error) {
      try { await fs.unlink(temp); } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('Falha ao remover arquivo temporário de pedido:', cleanupError.message);
      }
      throw error;
    }
    const { fingerprint: ignored, ...visible } = updated;
    return visible;
  });
  queue = operation.catch(() => {});
  return operation;
}

module.exports = { saveOrder, listOrders, updateOrder, fingerprint };
