'use strict';

window.ecofitusRequest = function (path, body) {
  const scriptUrl = window.ECOFITUS_SCRIPT_URL || '';
  if (!scriptUrl) {
    const base = (window.ECOFITUS_API_BASE || '').replace(/\/$/, '');
    if (!base && location.hostname.endsWith('.github.io')) {
      return Promise.reject(new Error('Serviço de pedidos ainda não configurado. Entre em contato com a equipe comercial.'));
    }
    return fetch(`${base}${path}`, body === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível processar a solicitação.');
      return data;
    });
  }
  const parsed = new URL(scriptUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(parsed.pathname) || parsed.search || parsed.hash) {
    return Promise.reject(new Error('Endereço do serviço de pedidos inválido.'));
  }
  if (path === '/api/catalog' && body === undefined) {
    return new Promise((resolve, reject) => {
      const callback = 'ecofitusCallback_' + crypto.randomUUID().replace(/-/g, '');
      const script = document.createElement('script');
      const timeout = setTimeout(() => finish(new Error('A consulta do catálogo demorou demais.')), 60000);
      function finish(error, data) {
        clearTimeout(timeout);
        delete window[callback];
        script.remove();
        if (error) reject(error); else resolve(data);
      }
      window[callback] = (result) => {
        if (!result || !result.ok) finish(new Error(result && result.error || 'Falha ao consultar o catálogo.'));
        else finish(null, result.data);
      };
      script.onerror = () => finish(new Error('Não foi possível acessar o serviço do catálogo.'));
      script.src = `${scriptUrl}?callback=${callback}`;
      document.head.append(script);
    });
  }
  const action = path === '/api/company' ? 'company' : path === '/api/order' ? 'order' : '';
  if (!action || body === undefined) return Promise.reject(new Error('Operação não suportada.'));
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomUUID();
    const iframe = document.createElement('iframe');
    const form = document.createElement('form');
    iframe.name = 'ecofitus_' + nonce.replace(/-/g, '');
    iframe.hidden = true;
    form.hidden = true;
    form.method = 'POST';
    form.action = scriptUrl;
    form.target = iframe.name;
    const payload = action === 'company' ? { action, cnpj: body.cnpj } : { action, order: body };
    for (const [name, value] of Object.entries({ nonce, payload: JSON.stringify(payload) })) {
      const input = document.createElement('input');
      input.name = name;
      input.value = value;
      form.append(input);
    }
    const timeout = setTimeout(() => finish(new Error('O serviço demorou demais. Tente novamente.')), 90000);
    function finish(error, result) {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      form.remove();
      iframe.remove();
      if (error) reject(error); else resolve(result);
    }
    function onMessage(event) {
      let origin;
      try { origin = new URL(event.origin); } catch { return; }
      const host = origin.hostname;
      const googleHost = host === 'script.googleusercontent.com' ||
        host.endsWith('.script.googleusercontent.com') ||
        /^[a-z0-9-]+-script\.googleusercontent\.com$/.test(host);
      if (origin.protocol !== 'https:' || !googleHost || !event.data || event.data.nonce !== nonce) return;
      if (!event.data.ok) finish(new Error(event.data.error || 'Falha ao processar solicitação.'));
      else finish(null, event.data.data);
    }
    window.addEventListener('message', onMessage);
    document.body.append(iframe, form);
    form.submit();
  });
};
