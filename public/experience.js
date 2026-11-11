'use strict';

const slides = Array.from(document.querySelectorAll('.campaign-slide'));
const position = document.getElementById('campaign-position');
let slideIndex = 0;
let timer;

function showSlide(index) {
  slideIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => { slide.hidden = i !== slideIndex; });
  position.textContent = `${slideIndex + 1} / ${slides.length}`;
}
function setRotation() {
  clearInterval(timer);
  if (slides.length > 1) {
    timer = setInterval(() => {
      if (!document.getElementById('campaign-dialog').open) showSlide(slideIndex + 1);
    }, 6000);
  }
}
document.getElementById('campaign-previous').addEventListener('click', () => { showSlide(slideIndex - 1); setRotation(); });
document.getElementById('campaign-next').addEventListener('click', () => { showSlide(slideIndex + 1); setRotation(); });
setRotation();

const installButton = document.getElementById('install-app');
const installStatus = document.getElementById('install-status');
let installPrompt;
function installed() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
if (installed()) installButton.hidden = true;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.hidden = true;
  installStatus.hidden = false;
  installStatus.textContent = 'Aplicativo instalado.';
});
installButton.addEventListener('click', async () => {
  installStatus.hidden = false;
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      installStatus.textContent = choice.outcome === 'accepted'
        ? 'Instalação solicitada no navegador.'
        : 'Instalação cancelada. Para tentar novamente, recarregue a página.';
    } catch (error) {
      console.error('Não foi possível iniciar a instalação:', error);
      installStatus.textContent = 'Não foi possível iniciar a instalação. Use o menu do navegador ou tente novamente.';
    }
    return;
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    installStatus.textContent = 'No iPhone ou iPad, abra no Safari e toque em Compartilhar → Adicionar à Tela de Início.';
  } else {
    installStatus.textContent = 'Use o menu do navegador e procure “Instalar aplicativo” ou “Adicionar à tela inicial”. A opção depende do navegador e requer HTTPS.';
  }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.error('Não foi possível registrar o aplicativo:', error);
    installStatus.hidden = false;
    installStatus.textContent = 'A instalação automática está indisponível neste navegador ou conexão.';
  });
}
