'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const campaign = fs.readFileSync(path.join(root, 'public', 'campaigns.js'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'catalog.js'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'Campaigns.gs'), `function campaignCore_() {\nconst module = { exports: {} };\n${campaign}\nreturn module.exports;\n}\n`);
fs.writeFileSync(path.join(__dirname, 'Catalog.gs'), `function catalogCore_() {\nconst module = { exports: {} };\nfunction require(name) { if (name === './public/campaigns') return campaignCore_(); throw new Error('Módulo desconhecido: ' + name); }\n${catalog}\nreturn module.exports;\n}\n`);
console.log('Campaigns.gs e Catalog.gs gerados.');
