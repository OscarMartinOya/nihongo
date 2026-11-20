/* Genera audio/manifest.json ({clave: texto}) con todos los textos del curso.
   Uso: node tools/audio-manifest.js  (después: python tools/gen_audio.py) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const head = app.split('/* ---------- audio (voz japonesa del sistema)')[0];
const code = fs.readFileSync(path.join(root, 'data.js'), 'utf8') + '\n' + head + `
  const out = {};
  for (const id of ALL_IDS) { const t = audioText(ITEMS[id]); out[audioKey(t)] = t; }
  out;`;
const manifest = vm.runInNewContext(code, { navigator: {}, console });
const sorted = Object.fromEntries(Object.entries(manifest).sort());
fs.writeFileSync(path.join(root, 'audio', 'manifest.json'), JSON.stringify(sorted, null, 1) + '\n');
console.log(Object.keys(sorted).length + ' audios en audio/manifest.json');
