#!/usr/bin/env node
// Downloads the live source files from the deployed Dino chat app and saves
// them into the game-source/ directory (reference copies for the cheats work).

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://ggx-dino-chat.web.app';
const FILES = ['game.js', 'items.js', 'map.js', 'characters.js'];
const OUT_DIR = path.join(__dirname, '..', 'game-src');

function download(file) {
  return new Promise((resolve, reject) => {
    https.get(`${BASE}/${file}`, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${file}: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const out = path.join(OUT_DIR, file);
        fs.writeFileSync(out, body);
        console.log(`Saved ${body.length} bytes to ${out}`);
        resolve();
      });
    }).on('error', (err) => reject(new Error(`${file}: ${err.message}`)));
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try {
    await Promise.all(FILES.map(download));
  } catch (err) {
    console.error(`Download failed: ${err.message}`);
    process.exit(1);
  }
})();
