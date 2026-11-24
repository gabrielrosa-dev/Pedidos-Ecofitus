'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this.hidden = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  closest(selector) { return selector === '.campaign-dot' && this.className === 'campaign-dot' ? this : null; }
}

test('campanhas dinâmicas renderizam banners e controles de rotação', () => {
  const ids = new Map();
  const getElementById = (id) => {
    if (!ids.has(id)) ids.set(id, new Element());
    return ids.get(id);
  };
  const section = new Element();
  const document = {
    getElementById,
    querySelector: () => section,
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener() {},
  };
  const window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  const dialog = getElementById('campaign-dialog');
  const context = vm.createContext({
    document, window, navigator: {}, console,
    setInterval(callback) { context.rotate = callback; return 1; },
    clearInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'experience.js'), 'utf8'), context);
  context.window.EcofitusExperience.renderCampaigns([
    { id: 'one', title: 'Campanha 1', imageUrl: 'https://example.com/1.png' },
    { id: 'two', title: 'Campanha 2', imageUrl: 'https://example.com/2.png' },
    { id: 'three', title: 'Campanha 3', imageUrl: 'https://example.com/3.png' },
  ]);
  const slides = getElementById('campaign-slides').children;
  const dots = getElementById('campaign-controls').children;
  assert.equal(slides.length, 3);
  assert.equal(slides[0].children[0].dataset.campaign, 'one');
  assert.equal(slides[0].children[0].children[0].src, 'https://example.com/1.png');
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, true, true]);
  getElementById('campaign-controls').listeners.click({ target: dots[2] });
  assert.deepEqual(slides.map((slide) => slide.hidden), [true, true, false]);
  assert.equal(dots[2].attributes['aria-current'], 'true');
  assert.equal(dots[0].attributes['aria-current'], undefined);
  context.rotate();
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, true, true]);
  dialog.open = true;
  context.rotate();
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, true, true]);
});
