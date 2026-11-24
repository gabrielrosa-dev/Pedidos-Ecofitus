const SPREADSHEET_ID = '12oInQfstoUAfP6x1egIIsRgDIse8Mm78w17NmYs5I1o';
const PARENT_ORIGIN = 'https://gabrielrosa-dev.github.io';
const CATALOG_MAX_AGE = 30 * 1000;
const REPRESENTATIVES = {
  gabriel: { id: 'gabriel', name: 'Gabriel', whatsapp: '5541995922369' },
  vanderson: { id: 'vanderson', name: 'Vanderson', whatsapp: '5541988604367' },
};

function response_(value) {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><script>window.top.postMessage(' +
    json + ',' + JSON.stringify(PARENT_ORIGIN) + ');</script>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doGet(e) {
  const callback = e.parameter.callback;
  if (!/^ecofitusCallback_[a-f0-9]+$/.test(callback || '')) {
    return ContentService.createTextOutput('Requisição inválida.');
  }
  let result;
  try {
    result = { ok: true, data: catalog_() };
  } catch (error) {
    console.error('Falha ao consultar catálogo: ' + error.message);
    result = { ok: false, error: 'Não foi possível atualizar o catálogo. Tente novamente.' };
  }
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(result).replace(/</g, '\\u003c') + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  let nonce = '';
  try {
    const raw = e.parameter.payload;
    nonce = e.parameter.nonce || '';
    if (!/^[a-f0-9-]{36}$/.test(nonce) || !raw || raw.length > 50000) {
      throw new Error('Requisição inválida.');
    }
    const input = JSON.parse(raw);
    let data;
    if (input.action === 'company') {
      data = lookupCompany_(input.cnpj);
    } else if (input.action === 'order') {
      data = createOrder_(input.order);
    } else if (input.action === 'adminList') {
      data = listAdminOrders_(input.auth, input.start, input.end);
    } else if (input.action === 'adminUpdate') {
      data = updateAdminOrder_(input.auth, input.orderId, input.changes);
    } else {
      throw new Error('Operação inválida.');
    }
    return response_({ nonce, ok: true, data });
  } catch (error) {
    console.error('Falha ao processar requisição: ' + error.message);
    return response_({ nonce, ok: false, error: error.message || 'Falha ao processar pedido.' });
  }
}

function spreadsheet_() {
  if (SPREADSHEET_ID === 'COLE_O_ID_DA_PLANILHA_AQUI') throw new Error('Planilha não configurada.');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function setup() {
  const book = spreadsheet_();
  let orders = book.getSheetByName('Pedidos');
  if (!orders) orders = book.insertSheet('Pedidos');
  if (orders.getLastRow() === 0) {
    orders.appendRow(['Número do pedido', 'Data UTC', 'CNPJ', 'Razão social', 'Prazo', 'Produtos', 'Campanhas', 'Total (R$)', 'Mensagem', 'Dados JSON', 'Representante']);
  }
  let representatives = book.getSheetByName('Representantes');
  if (!representatives) {
    representatives = book.insertSheet('Representantes');
    representatives.appendRow(['E-mail', 'Representante', 'Salt', 'Hash da senha']);
  }
}

function checkSetup() {
  for (const representative of Object.values(REPRESENTATIVES)) {
    if (!/^[1-9]\d{9,14}$/.test(representative.whatsapp)) throw new Error('Número de WhatsApp inválido.');
  }
  if (!spreadsheet_().getSheetByName('Pedidos')) throw new Error('Aba Pedidos não encontrada. Execute setup.');
  if (!spreadsheet_().getSheetByName('Representantes')) throw new Error('Aba Representantes não encontrada. Execute setup.');
  const snapshot = catalog_();
  console.log('Configuração básica verificada. Produtos no catálogo: ' + snapshot.products.length);
}

function catalog_(forceRefresh = false) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const stored = forceRefresh ? null : cache.get('catalog-v2');
    if (stored) {
      const cached = JSON.parse(stored);
      if (Date.now() >= cached.updatedAt && Date.now() - cached.updatedAt < CATALOG_MAX_AGE) {
        return { products: cached.products, updatedAt: cached.updatedAt, stale: false, error: null };
      }
    }
    let page = 0;
    let pages = 1;
    const products = [];
    do {
      const response = UrlFetchApp.fetch('https://grupomtf.ic.nexfar.com.br/api/catalog/2773/products', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ cnpj: '23624691000108', distributorId: 3, pagina: page }),
        muteHttpExceptions: true,
      });
      if (response.getResponseCode() !== 200) throw new Error('Nexfar HTTP ' + response.getResponseCode());
      const data = JSON.parse(response.getContentText('UTF-8'));
      if (!Array.isArray(data.products) || !Number.isInteger(data.totalPaginas) ||
          data.totalPaginas < 1 || data.totalPaginas > 1000 || data.pagina !== page) {
        throw new Error('Resposta do catálogo inválida.');
      }
      products.push.apply(products, data.products);
      pages = data.totalPaginas;
      page++;
    } while (page < pages);
    const normalized = catalogCore_().normalizeCatalog({ products });
    if (!normalized.length) throw new Error('Catálogo sem produtos.');
    const updatedAt = Date.now();
    const snapshot = JSON.stringify({ products: normalized, updatedAt });
    if (Utilities.newBlob(snapshot).getBytes().length <= 90000) {
      cache.put('catalog-v2', snapshot, CATALOG_MAX_AGE / 1000);
    } else {
      console.warn('Catálogo excede o limite de cache; a próxima consulta buscará os dados novamente na Nexfar.');
    }
    return { products: normalized, updatedAt, stale: false, error: null };
  } finally {
    lock.releaseLock();
  }
}

function lookupCompany_(value) {
  if (typeof value !== 'string' || !catalogCore_().validCnpj(value)) throw new Error('Informe um CNPJ válido.');
  const cnpj = value.replace(/\D/g, '');
  let response;
  try {
    response = UrlFetchApp.fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj, {
      headers: { 'User-Agent': 'PedidosEcofitus/1.0 (CNPJ lookup)' },
      muteHttpExceptions: true,
    });
  } catch (error) {
    console.error('Falha na consulta BrasilAPI: ' + error.message);
    return { cnpj, name: 'Razão social não localizada' };
  }
  const status = response.getResponseCode();
  if (status === 404 || status !== 200) return { cnpj, name: 'Razão social não localizada' };
  let data;
  try { data = JSON.parse(response.getContentText('UTF-8')); } catch (error) {
    return { cnpj, name: 'Razão social não localizada' };
  }
  if (data.cnpj !== cnpj || typeof data.razao_social !== 'string' || !data.razao_social.trim()) {
    return { cnpj, name: 'Razão social não localizada' };
  }
  return { cnpj, name: data.razao_social.trim().replace(/[\r\n]/g, ' ') };
}

function createOrder_(input) {
  if (!input || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id || '')) {
    throw new Error('Identificador de pedido inválido.');
  }
  const representative = REPRESENTATIVES[input.representativeId];
  if (!representative) throw new Error('Selecione um representante válido.');
  const snapshot = catalog_(true);
  catalogCore_().buildOrder(input, snapshot.products, snapshot.updatedAt, 'Aguardando consulta');
  const company = lookupCompany_(input.cnpj);
  const now = Date.now();
  const message = catalogCore_().buildOrder(input, snapshot.products, snapshot.updatedAt, company.name, now);
  const order = catalogCore_().calculateOrder({ ...input, campaigns: input.campaigns === undefined ? [] : input.campaigns }, snapshot.products, now);
  catalogCore_().verifyPriceQuote(input, order);
  const canonical = JSON.stringify({
    representativeId: representative.id, cnpj: company.cnpj, terms: input.terms.trim(),
    items: input.items.map(({ id, quantity }) => ({ id, quantity })).sort((a, b) => a.id.localeCompare(b.id)),
    campaigns: (input.campaigns || []).slice().sort(),
  });
  const fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical)
    .map((b) => ('0' + (b & 255).toString(16)).slice(-2)).join('');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = spreadsheet_().getSheetByName('Pedidos');
    if (!sheet) throw new Error('Histórico não configurado. Execute setup no Apps Script.');
    const count = sheet.getLastRow();
    const ids = count > 1 ? sheet.getRange(2, 1, count - 1, 1).getValues() : [];
    const index = ids.findIndex((row) => row[0] === input.id);
    if (index >= 0) {
      const saved = JSON.parse(sheet.getRange(index + 2, 10).getValue());
      if (saved.fingerprint !== fingerprint) throw new Error('Identificador já utilizado em outro pedido.');
      const savedRepresentative = REPRESENTATIVES[saved.representativeId] || REPRESENTATIVES.gabriel;
      return { id: input.id, url: 'https://wa.me/' + savedRepresentative.whatsapp + '?text=' + encodeURIComponent(saved.message) };
    }
    const createdAt = new Date();
    const fullMessage = message;
    const saved = { id: input.id, createdAt: createdAt.toISOString(), representativeId: representative.id,
      representativeName: representative.name, cnpj: company.cnpj, companyName: company.name,
      terms: input.terms.trim(), ...order, message: fullMessage, fingerprint };
    const json = JSON.stringify(saved);
    if (json.length > 49000) throw new Error('Pedido excede o tamanho permitido.');
    const text = (value) => /^[=+\-@\t\r]/.test(String(value)) ? "'" + value : String(value);
    const details = order.items.map((item) => `${item.quantity}x ${item.name}`).join('; ');
    const campaigns = order.campaigns.map((campaign) => `${campaign.title}: ${campaign.items.map((item) => `${item.quantity}x ${item.name}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`).join(', ')}`).join('; ');
    sheet.appendRow([input.id, createdAt.toISOString(), company.cnpj, text(company.name), text(input.terms.trim()), text(details), text(campaigns), order.totalCents / 100, text(fullMessage), json, representative.name]);
    SpreadsheetApp.flush();
    return { id: input.id, url: 'https://wa.me/' + representative.whatsapp + '?text=' + encodeURIComponent(fullMessage) };
  } finally {
    lock.releaseLock();
  }
}

function adminAccount_(auth) {
  if (!auth || typeof auth.email !== 'string' || typeof auth.password !== 'string' ||
      auth.email.length > 200 || auth.password.length > 200) {
    throw new Error('Informe e-mail e senha.');
  }
  const email = auth.email.trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const attemptKey = 'admin-attempt-' + Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, email
  ).map((b) => ('0' + (b & 255).toString(16)).slice(-2)).join('');
  const attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= 10) throw new Error('Muitas tentativas. Tente novamente mais tarde.');
  const sheet = spreadsheet_().getSheetByName('Representantes');
  if (!sheet) throw new Error('Acesso administrativo não configurado.');
  const count = sheet.getLastRow();
  const rows = count > 1 ? sheet.getRange(2, 1, count - 1, 4).getValues() : [];
  const row = rows.find((entry) => String(entry[0]).trim().toLowerCase() === email);
  const calculated = row ? Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(row[2]) + ':' + auth.password
  ).map((b) => ('0' + (b & 255).toString(16)).slice(-2)).join('') : '';
  if (!row || calculated !== String(row[3]).trim().toLowerCase() ||
      !REPRESENTATIVES[String(row[1]).trim()]) {
    cache.put(attemptKey, String(attempts + 1), 900);
    throw new Error('E-mail ou senha inválidos.');
  }
  cache.remove(attemptKey);
  return { email, representative: REPRESENTATIVES[String(row[1]).trim()] };
}

function adminOrderRows_() {
  const sheet = spreadsheet_().getSheetByName('Pedidos');
  if (!sheet) throw new Error('Histórico não configurado. Execute setup no Apps Script.');
  const count = sheet.getLastRow();
  return { sheet, count, rows: count > 1 ? sheet.getRange(2, 1, count - 1, 11).getValues() : [] };
}

function listAdminOrders_(auth, start, end) {
  const account = adminAccount_(auth);
  if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
    throw new Error('Período inválido.');
  }
  const orders = adminOrderRows_().rows.map((row) => {
    try {
      const order = JSON.parse(row[9]);
      delete order.fingerprint;
      return order;
    } catch (error) {
      console.error('Pedido administrativo inválido ignorado: ' + error.message);
      return null;
    }
  }).filter((order) => order && (order.representativeId || 'gabriel') === account.representative.id)
    .filter((order) => {
      const date = String(order.createdAt).slice(0, 10);
      return (!start || date >= start) && (!end || date <= end);
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    representative: { id: account.representative.id, name: account.representative.name },
    orders,
    totalCents: orders.reduce((total, order) => total + order.totalCents, 0),
  };
}

function validateAdminChanges_(order, changes) {
  if (!changes || typeof changes.companyName !== 'string' || !changes.companyName.trim() ||
      changes.companyName.length > 300 || /[\r\n]/.test(changes.companyName) ||
      !catalogCore_().isValidTerm(changes.terms) ||
      !Array.isArray(changes.items) || changes.items.length > 200) {
    throw new Error('Revise os dados do pedido.');
  }
  const ids = new Set();
  const items = changes.items.map((item) => {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || item.id.length > 100 ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 ||
        typeof item.ean !== 'string' || item.ean.length > 100 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        !Number.isSafeInteger(item.priceCents) || item.priceCents < 1) {
      throw new Error('Revise nome, quantidade e valor dos produtos.');
    }
    ids.add(item.id);
    return { id: item.id, ean: item.ean, name: item.name.trim(), quantity: item.quantity, priceCents: item.priceCents };
  });
  const campaigns = Array.isArray(order.campaigns) ? order.campaigns : [];
  if (!items.length && !campaigns.length) throw new Error('O pedido deve conter ao menos um produto.');
  const totalCents = items.reduce((total, item) => total + item.quantity * item.priceCents, 0) +
    campaigns.reduce((total, campaign) => total + campaign.totalCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('Valor total inválido.');
  return { items, campaigns, totalCents, companyName: changes.companyName.trim(), terms: changes.terms.trim() };
}

function editedOrderMessage_(order, changes) {
  const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const lines = changes.items.map((item) =>
    `${item.name} (${item.ean || item.id}) — ${item.quantity} x ${money(item.priceCents)} = ${money(item.quantity * item.priceCents)}`);
  for (const campaign of changes.campaigns) {
    lines.push('', `*Campanha: ${campaign.title}*`, ...campaign.items.map((item) =>
      `${item.name} (${item.ean || item.id}) — ${item.quantity} x ${money(item.priceCents)}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`),
      `Benefício solicitado: ${campaign.benefit}`, `Subtotal campanha: ${money(campaign.totalCents)}`);
  }
  return [
    '*Pedido Ecofitus*', `CNPJ: ${order.cnpj}`, `Razão social: ${changes.companyName}`,
    `Prazo informado: ${changes.terms}`, '', ...lines, '', `*Total: ${money(changes.totalCents)}*`,
  ].join('\n');
}

function updateAdminOrder_(auth, orderId, changes) {
  const account = adminAccount_(auth);
  if (!/^[0-9a-f-]{36}$/i.test(orderId || '')) throw new Error('Pedido inválido.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = adminOrderRows_();
    const index = result.rows.findIndex((row) => {
      try { return JSON.parse(row[9]).id === orderId; } catch { return false; }
    });
    if (index < 0) throw new Error('Pedido não encontrado.');
    const order = JSON.parse(result.rows[index][9]);
    if ((order.representativeId || 'gabriel') !== account.representative.id) throw new Error('Pedido não encontrado.');
    const validated = validateAdminChanges_(order, changes);
    const updated = {
      ...order,
      ...validated,
      updatedAt: new Date().toISOString(),
      message: editedOrderMessage_(order, validated),
      editedByRepresentative: true,
    };
    const details = updated.items.map((item) => `${item.quantity}x ${item.name}`).join('; ');
    const campaigns = updated.campaigns.map((campaign) =>
      `${campaign.title}: ${campaign.items.map((item) => `${item.quantity}x ${item.name}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`).join(', ')}`).join('; ');
    const text = (value) => /^[=+\-@\t\r]/.test(String(value)) ? "'" + value : String(value);
    result.sheet.getRange(index + 2, 4, 1, 8).setValues([[
      text(updated.companyName), text(updated.terms), text(details), text(campaigns),
      updated.totalCents / 100, text(updated.message), JSON.stringify(updated), REPRESENTATIVES[account.representative.id].name,
    ]]);
    SpreadsheetApp.flush();
    delete updated.fingerprint;
    return { order: updated };
  } finally {
    lock.releaseLock();
  }
}
