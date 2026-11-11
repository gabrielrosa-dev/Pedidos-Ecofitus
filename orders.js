'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let queue = Promise.resolve();

function fingerprint(input) {
  const canonical = {
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

module.exports = { saveOrder, listOrders, fingerprint };
