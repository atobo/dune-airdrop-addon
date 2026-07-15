const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const crypto = require('crypto');

(async () => {
  const htmlPath = path.resolve(__dirname, 'web/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const grantLogicSrc = fs.readFileSync(path.resolve(__dirname, 'web/grant_logic.js'), 'utf-8');
  const addonSrc = fs.readFileSync(path.resolve(__dirname, 'web/addon.js'), 'utf-8');

  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
  const window = dom.window;
  const document = window.document;

  window.crypto = { randomUUID: () => crypto.randomUUID() };
  let mockStorage = {};
  window.localStorage = {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => mockStorage[k] = String(v),
    removeItem: (k) => delete mockStorage[k]
  };

  let queriesReceived = [];
  let bridgeResponses = [];
  
  window.DuneAddon = {
    request: async (action, payload) => {
      queriesReceived.push({ action, payload });
      if (bridgeResponses.length > 0) {
        return bridgeResponses.shift()();
      }
      if (action === 'database.query') {
        return { rows: [] };
      }
      return { ok: true };
    }
  };

  window.fetch = async () => ({ ok: true, text: async () => 'mock_sql' });

  const grantScript = document.createElement('script');
  grantScript.textContent = grantLogicSrc;
  document.body.appendChild(grantScript);

  const addonSrcModified = addonSrc.replace('const isSandboxMode = window.parent === window;', 'const isSandboxMode = false;');
  const addonScript = document.createElement('script');
  addonScript.textContent = addonSrcModified;
  document.body.appendChild(addonScript);

  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  await new Promise(r => setTimeout(r, 50));
  queriesReceived = [];

  bridgeResponses.push(() => ({
    rows: [{ id: '9999999999999', class: '/Game/Chest', owner_account_id: '12345' }]
  }));

  await window.selectContainer('9999999999999');
  
  const openSpawnModalBtn = document.getElementById('openSpawnModalBtn');
  openSpawnModalBtn.click();
  const modal = document.getElementById('spawnItemModal');

  const spawnItemTemplateInput = document.getElementById('spawnItemTemplateInput');
  spawnItemTemplateInput.value = 'TestSword';
  const spawnItemQtyInput = document.getElementById('spawnItemQtyInput');
  spawnItemQtyInput.value = '3';
  
  bridgeResponses.push(() => ({ rows: [{ account_id: '12345' }] }));
  bridgeResponses.push(() => ({ ok: true, success: true }));

  const confirmBtn = document.getElementById('spawnItemConfirmBtn');
  confirmBtn.click();
  
  await new Promise(r => setTimeout(r, 50));

  console.log("QUERIES:", JSON.stringify(queriesReceived, null, 2));
})();
