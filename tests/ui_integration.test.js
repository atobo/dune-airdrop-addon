const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const crypto = require('crypto');

async function waitFor(predicate, message, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

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
        if (payload.query.includes("to_regclass('dune.airdrop_config')")) {
          return { rows: [{
            config_table: 'dune.airdrop_config',
            playtime_table: 'dune.airdrop_active_playtime',
            queue_table: 'dune.airdrop_pending_deliveries'
          }] };
        }
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

  await waitFor(
    () => document.getElementById('container-row-9999999999999'),
    'Initial container data did not finish loading'
  );

  // 1. Initial Data Load Validation
  assert.ok(queriesReceived.some(q => q.action === 'database.query' && q.payload.query.includes('config_key = \'airdrop_multipliers\'')));
  assert.ok(queriesReceived.some(q => q.action === 'database.query' && q.payload.query.includes('FROM dune.inventories i')));

  // Clear queries from init phase
  queriesReceived = [];

  // Click the Loot tab to reveal the view
  const tabLootBtn = document.getElementById('tabLootBtn');
  if (tabLootBtn) {
    tabLootBtn.click();
    await new Promise(r => setTimeout(r, 10));
  }

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
  
  await waitFor(
    () => queriesReceived.some((entry) => entry.action === 'admin.items.grant'),
    'Grant request was not emitted'
  );

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

test('UI Integration - Clean install prompts for schema initialization', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../web/index.html'), 'utf-8');
  const grantLogicSrc = fs.readFileSync(path.resolve(__dirname, '../web/grant_logic.js'), 'utf-8');
  const addonSrc = fs.readFileSync(path.resolve(__dirname, '../web/addon.js'), 'utf-8');
  const addonSrcModified = addonSrc.replace('const isSandboxMode = window.parent === window;', 'const isSandboxMode = false;');
  const combinedHtml = html.replace('</body>', `<script>${grantLogicSrc}</script><script>${addonSrcModified}</script></body>`);
  const dom = new JSDOM(combinedHtml, { runScripts: 'dangerously', url: 'http://localhost/' });
  const window = dom.window;
  const queries = [];

  window.DuneAddon = {
    request: async (action, payload) => {
      queries.push({ action, payload });
      if (action === 'database.query' && payload.query.includes("to_regclass('dune.airdrop_config')")) {
        return { rows: [{ config_table: null, playtime_table: null, queue_table: null }] };
      }
      return { rows: [] };
    }
  };
  window.fetch = async () => ({ ok: true, text: async () => 'mock_sql' });

  await waitFor(
    () => window.document.getElementById('connectionStatusBadge').textContent === 'Setup Required',
    'Clean installation did not enter setup-required state'
  );

  assert.equal(window.document.getElementById('connectionStatusBadge').textContent, 'Setup Required');
  assert.ok(queries.some((entry) => entry.payload.query.includes("to_regclass('dune.airdrop_config')")));
  assert.ok(!queries.some((entry) => entry.payload.query.includes("config_key = 'airdrop_multipliers'")));
  assert.equal(window.__fetchDiagnosticsInterval, undefined);
  assert.equal(window.__fetchPendingInterval, undefined);
});

test('UI Integration - Recovery paths (PENDING / UNCERTAIN)', async () => {
  const htmlPath = path.resolve(__dirname, '../web/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const grantLogicSrc = fs.readFileSync(path.resolve(__dirname, '../web/grant_logic.js'), 'utf-8');
  const addonSrc = fs.readFileSync(path.resolve(__dirname, '../web/addon.js'), 'utf-8');

  const addonSrcModified = addonSrc.replace('const isSandboxMode = window.parent === window;', 'const isSandboxMode = false;');
  const combinedHtml = html.replace('</body>', `<script>${grantLogicSrc}</script><script>${addonSrcModified}</script></body>`);

  const dom = new JSDOM(combinedHtml, { runScripts: "dangerously", url: "http://localhost/" });
  const window = dom.window;
  const document = window.document;

  window.crypto = { randomUUID: () => 'test-uuid-123' };
  
  // Set an unresolved state in mock localStorage
  const unresolvedState = {
    id: "manual:grant:test-uuid-123",
    status: "PENDING",
    hash: JSON.stringify(["12345", "TestSword", 3, 0, "9999999999999"]),
    payload: { playerId: "12345", itemId: "TestSword", quantity: 3, quality: 0, containerId: "9999999999999" }
  };
  
  window.localStorage.setItem('pending_manual_grant', JSON.stringify(unresolvedState));

  window.DuneAddon = {
    request: async (action, payload) => {
      if (action === 'database.query') {
        if (payload.query.includes("to_regclass('dune.airdrop_config')")) {
          return { rows: [{
            config_table: 'dune.airdrop_config',
            playtime_table: 'dune.airdrop_active_playtime',
            queue_table: 'dune.airdrop_pending_deliveries'
          }] };
        }
        if (payload.query.includes("ILIKE '%container%'")) {
          return { rows: [{ id: '9999999999999', class: '/Game/Chest', owner_account_id: '12345' }] };
        }
        return { rows: [] };
      }
      return { ok: true };
    }
  };
  window.fetch = async () => ({ ok: true, text: async () => 'mock_sql' });

  // Wait for load and initialization
  await new Promise(r => setTimeout(r, 100));

  // Explicitly trigger a state check by selecting a container (simulating user click or recovery)
  if (window.selectContainer) {
    await window.selectContainer('9999999999999');
  }

  // The UI should lock inputs because of the pending state
  const spawnItemTemplateInput = document.getElementById('spawnItemTemplateInput');
  const spawnItemQtyInput = document.getElementById('spawnItemQtyInput');
  const discardBtn = document.getElementById('spawnItemDiscardBtn');

  assert.strictEqual(spawnItemTemplateInput.disabled, true, 'Template input should be disabled');
  assert.strictEqual(spawnItemQtyInput.disabled, true, 'Qty input should be disabled');
  assert.ok(!discardBtn.classList.contains('hidden'), 'Discard button should be visible');
  
  // Discard the state
  discardBtn.click();
  await new Promise(r => setTimeout(r, 50));
  
  assert.strictEqual(window.localStorage.getItem('pending_manual_grant'), null, 'State should be cleared');
  assert.strictEqual(spawnItemTemplateInput.disabled, false, 'Template input should be enabled after discard');
  assert.strictEqual(spawnItemQtyInput.disabled, false, 'Qty input should be enabled after discard');

  if (window.__fetchDiagnosticsInterval) clearInterval(window.__fetchDiagnosticsInterval);
  if (window.__fetchPendingInterval) clearInterval(window.__fetchPendingInterval);
  setTimeout(() => process.exit(0), 100);
});
