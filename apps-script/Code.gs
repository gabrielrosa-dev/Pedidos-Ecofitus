const SPREADSHEET_ID = 'COLE_O_ID_DA_PLANILHA_AQUI';
const PARENT_ORIGIN = 'https://gabrielrosa-dev.github.io';
const WHATSAPP = '5541995922369';
const CATALOG_MAX_AGE = 5 * 60 * 1000;

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
    orders.appendRow(['Número do pedido', 'Data UTC', 'CNPJ', 'Razão social', 'Prazo', 'Produtos', 'Campanhas', 'Total (R$)', 'Mensagem', 'Dados JSON']);
  }
}

function catalog_() {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const stored = cache.get('catalog');
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
      const response = UrlFetchApp.fetch('https://ic.nexfar.com.br/api/catalog/2773/products', {
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
      cache.put('catalog', snapshot, CATALOG_MAX_AGE / 1000);
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
  const response = UrlFetchApp.fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj, {
    headers: { 'User-Agent': 'PedidosEcofitus/1.0 (CNPJ lookup)' },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('Consulta de CNPJ indisponível ou CNPJ não encontrado.');
  const data = JSON.parse(response.getContentText('UTF-8'));
  if (data.cnpj !== cnpj || typeof data.razao_social !== 'string' || !data.razao_social.trim()) {
    throw new Error('A consulta não retornou uma razão social válida.');
  }
  return { cnpj, name: data.razao_social.trim().replace(/[\r\n]/g, ' ') };
}

function createOrder_(input) {
  if (!input || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id || '')) {
    throw new Error('Identificador de pedido inválido.');
  }
  const snapshot = catalog_();
  catalogCore_().buildOrder(input, snapshot.products, snapshot.updatedAt, 'Aguardando consulta');
  const company = lookupCompany_(input.cnpj);
  const message = catalogCore_().buildOrder(input, snapshot.products, snapshot.updatedAt, company.name);
  const order = catalogCore_().calculateOrder({ ...input, campaigns: input.campaigns === undefined ? [] : input.campaigns }, snapshot.products);
  const canonical = JSON.stringify({
    cnpj: company.cnpj, terms: input.terms.trim(),
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
      return { id: input.id, url: 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(saved.message) };
    }
    const createdAt = new Date();
    const fullMessage = message + '\nNúmero do pedido: ' + input.id + '\nPreparado em: ' +
      Utilities.formatDate(createdAt, 'America/Sao_Paulo', 'dd/MM/yyyy, HH:mm:ss');
    const saved = { id: input.id, createdAt: createdAt.toISOString(), cnpj: company.cnpj, companyName: company.name,
      terms: input.terms.trim(), ...order, message: fullMessage, fingerprint };
    const json = JSON.stringify(saved);
    if (json.length > 49000) throw new Error('Pedido excede o tamanho permitido.');
    const text = (value) => /^[=+\-@\t\r]/.test(String(value)) ? "'" + value : String(value);
    const details = order.items.map((item) => `${item.quantity}x ${item.name}`).join('; ');
    const campaigns = order.campaigns.map((campaign) => `${campaign.title}: ${campaign.items.map((item) => `${item.quantity}x ${item.name}${item.bonus ? ` + ${item.bonus} bonificadas` : ''}`).join(', ')}`).join('; ');
    sheet.appendRow([input.id, createdAt.toISOString(), company.cnpj, text(company.name), text(input.terms.trim()), text(details), text(campaigns), order.totalCents / 100, text(fullMessage), json]);
    SpreadsheetApp.flush();
    return { id: input.id, url: 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(fullMessage) };
  } finally {
    lock.releaseLock();
  }
}
