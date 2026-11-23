'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('bolinhas selecionam a campanha e acompanham a rotação', () => {
  const slides = Array.from({ length: 3 }, () => ({ hidden: false }));
  const dots = Array.from({ length: 3 }, () => ({
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, handler) { this[name] = handler; },
  }));
  const dialog = { open: false };
  const installButton = { addEventListener() {} };
  const document = {
    querySelectorAll(selector) { return selector === '.campaign-slide' ? slides : dots; },
    getElementById(id) {
      if (id === 'campaign-dialog') return dialog;
      if (id === 'install-app') return installButton;
      return {};
    },
  };
  let rotate;
  const window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  const context = vm.createContext({
    document, window, navigator: {}, console,
    setInterval(callback) { rotate = callback; return 1; }, clearInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'experience.js'), 'utf8'), context);
  dots[2].click();
  assert.deepEqual(slides.map((slide) => slide.hidden), [true, true, false]);
  assert.equal(dots[2].attributes['aria-current'], 'true');
  assert.equal(dots[0].attributes['aria-current'], undefined);
  rotate();
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, true, true]);
  assert.equal(dots[0].attributes['aria-current'], 'true');
  dialog.open = true;
  rotate();
  assert.deepEqual(slides.map((slide) => slide.hidden), [false, true, true]);
});
