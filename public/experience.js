'use strict';

let slides = [];
let dots = [];
let slideIndex = 0;
let timer;

function showSlide(index) {
  if (!slides.length) return;
  slideIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => { slide.hidden = i !== slideIndex; });
  dots.forEach((dot, i) => {
    if (i === slideIndex) dot.setAttribute('aria-current', 'true');
    else dot.removeAttribute('aria-current');
  });
}

function setRotation() {
  clearInterval(timer);
  if (slides.length > 1) {
    timer = setInterval(() => {
      if (!document.getElementById('campaign-dialog').open) showSlide(slideIndex + 1);
    }, 6000);
  }
}

function renderCampaigns(campaigns) {
  const section = document.querySelector('.campaign-section');
  const slideContainer = document.getElementById('campaign-slides');
  const controls = document.getElementById('campaign-controls');
  slideContainer.replaceChildren();
  controls.replaceChildren();
  slides = [];
  dots = [];
  slideIndex = 0;
  section.hidden = !campaigns.length;
  campaigns.forEach((campaign, index) => {
    const slide = document.createElement('div');
    slide.className = 'campaign-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} de ${campaigns.length}: ${campaign.title}`);
    slide.hidden = index !== 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'campaign-open';
    button.dataset.campaign = campaign.id;
    button.setAttribute('aria-label', `Ver detalhes da campanha ${campaign.title}`);
    if (campaign.imageUrl) {
      const image = document.createElement('img');
      image.src = campaign.imageUrl;
      image.alt = `Campanha ${campaign.title}`;
      image.loading = index === 0 ? 'eager' : 'lazy';
      image.addEventListener('error', () => {
        image.replaceWith(document.createTextNode(campaign.title));
        slide.style.removeProperty('--campaign-image');
      });
      button.append(image);
      const safeUrl = campaign.imageUrl.replace(/["\\\r\n]/g, '');
      slide.style.setProperty('--campaign-image', `url("${safeUrl}")`);
    } else {
      button.append(document.createTextNode(campaign.title));
    }
    slide.append(button);
    slideContainer.append(slide);
    slides.push(slide);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'campaign-dot';
    dot.setAttribute('aria-label', `Mostrar campanha ${index + 1}: ${campaign.title}`);
    if (index === 0) dot.setAttribute('aria-current', 'true');
    controls.append(dot);
    dots.push(dot);
  });
  setRotation();
}

document.getElementById('campaign-controls').addEventListener('click', (event) => {
  const dot = event.target.closest('.campaign-dot');
  const index = dots.indexOf(dot);
  if (index >= 0) {
    showSlide(index);
    setRotation();
  }
});

window.EcofitusExperience = { renderCampaigns };

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
