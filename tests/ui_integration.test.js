const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const crypto = require('crypto');

test('UI Integration - Full Container Selection and Grant Workflow', async () => {
  // Load HTML and Scripts
  const htmlPath = path.resolve(__dirname, '../web/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  
  const grantLogicSrc = fs.readFileSync(path.resolve(__dirname, '../web/grant_logic.js'), 'utf-8');
  const addonSrc = fs.readFileSync(path.resolve(__dirname, '../web/addon.js'), 'utf-8');

  // Combine HTML and Scripts
  const addonSrcModified = addonSrc.replace('const isSandboxMode = window.parent === window;', 'const isSandboxMode = false;');
  const combinedHtml = html.replace('</body>', `<script>${grantLogicSrc}</script><script>${addonSrcModified}</script></body>`);

  // Setup DOM
  const dom = new JSDOM(combinedHtml, { runScripts: "dangerously", url: "http://localhost/" });
  const window = dom.window;
  const document = window.document;

  // Mock crypto and localStorage
  window.crypto = { randomUUID: () => crypto.randomUUID() };
  let mockStorage = {};
  window.localStorage = {
    getItem: (k) => mockStorage[k] || null,
    setItem: (k, v) => mockStorage[k] = String(v),
    removeItem: (k) => delete mockStorage[k]
  };

  let queriesReceived = [];
  window.DuneAddon = {
    request: async (action, payload) => {
      queriesReceived.push({ action, payload });
      if (action === 'database.query') {
        if (payload.query.includes('ILIKE \'%container%\'')) {
          return { rows: [{ id: '9999999999999', class: '/Game/Chest', owner_account_id: '12345' }] };
        }
        if (payload.query.includes('FROM dune.inventories WHERE id =')) {
          return { rows: [{ account_id: '12345' }] };
        }
        return { rows: [] };
      }
      if (action === 'admin.items.grant') {
        return { ok: true };
      }
      return { ok: true };
    }
  };

  // Mock fetch
  window.fetch = async () => ({ ok: true, text: async () => 'mock_sql' });

  // Allow microtasks to process
  await new Promise(r => setTimeout(r, 50));

  // 1. Initial Data Load Validation
  assert.ok(queriesReceived.some(q => q.action === 'database.query' && q.payload.query.includes('config_key = \'airdrop_multipliers\'')));
  assert.ok(queriesReceived.some(q => q.action === 'database.query' && q.payload.query.includes('SELECT \n          i.id::text as id')));

  // Clear queries from init phase
  queriesReceived = [];

  // 2. Select Container via UI interaction
  const containerRow = document.getElementById('container-row-9999999999999');
  assert.ok(containerRow, 'Container row should exist');
  containerRow.click();
  
  // Modal should be enabled and actId dataset set
  const openSpawnModalBtn = document.getElementById('openSpawnModalBtn');
  assert.ok(!openSpawnModalBtn.classList.contains('hidden'));
  
  const spawnItemTemplateInput = document.getElementById('spawnItemTemplateInput');
  assert.strictEqual(spawnItemTemplateInput.dataset.actId, '9999999999999');

  // Open Modal
  openSpawnModalBtn.click();
  const modal = document.getElementById('spawnItemModal');
  assert.ok(!modal.classList.contains('hidden'));

  // 3. Perform a Spawn Request
  spawnItemTemplateInput.value = 'TestSword';
  const spawnItemQtyInput = document.getElementById('spawnItemQtyInput');
  spawnItemQtyInput.value = '3';
  
  const confirmBtn = document.getElementById('spawnItemConfirmBtn');
  confirmBtn.click();
  
  await new Promise(r => setTimeout(r, 50));

  // Validate Queries
  const grantQuery = queriesReceived.find(q => q.action === 'admin.items.grant');
  assert.ok(grantQuery, "Expected admin.items.grant to be emitted");
  assert.strictEqual(grantQuery.payload.playerId, '12345');
  assert.strictEqual(grantQuery.payload.itemId, 'TestSword');
  assert.strictEqual(grantQuery.payload.quantity, 3);
  
  // Validate UI is closed
  assert.ok(modal.classList.contains('hidden'));

  // Cleanup polling intervals to prevent tests from hanging
  if (window.__fetchDiagnosticsInterval) clearInterval(window.__fetchDiagnosticsInterval);
  if (window.__fetchPendingInterval) clearInterval(window.__fetchPendingInterval);
});
