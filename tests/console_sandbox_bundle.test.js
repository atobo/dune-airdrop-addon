const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

test('packaged entry works in the Console iframe model without external assets or fetch', async () => {
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'setup_playtime_airdrops.sql'), 'utf8');

  assert.match(html, /name="dune-airdrop-runtime" content="self-contained"/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\bhref=/i);
  assert.doesNotMatch(html, /\bfetch\s*\(/);

  const requests = [];
  let windowRef;
  const consoleParent = {
    postMessage(message) {
      requests.push(message);
      const query = message.payload?.query || '';
      let result = { rows: [] };
      if (message.action === 'database.query' && query.includes("to_regclass('dune_airdrop.config')")) {
        result = { rows: [{
          config_table: 'dune_airdrop.config',
          playtime_table: 'dune_airdrop.active_playtime',
          queue_table: 'dune_airdrop.pending_deliveries'
        }] };
      }
      windowRef.setTimeout(() => {
        windowRef.dispatchEvent(new windowRef.MessageEvent('message', {
          source: consoleParent,
          origin: windowRef.location.origin,
          data: {
            type: 'dune-addon-response',
            addonId: message.addonId,
            requestId: message.requestId,
            ok: true,
            result
          }
        }));
      }, 0);
    }
  };

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://console.example/api/addons/installed/dune-airdrop-addon/content/web/index.html',
    beforeParse(window) {
      windowRef = window;
      Object.defineProperty(window, 'parent', { configurable: true, value: consoleParent });
      window.confirm = () => true;
      window.fetch = () => { throw new Error('Installed addon CSP blocks fetch.'); };
    }
  });
  const { window } = dom;

  await waitFor(
    () => requests.some((request) => request.action === 'database.query'),
    'The self-contained bridge did not issue its initial database request.'
  );
  assert.equal(typeof window.DuneAddon?.request, 'function');
  assert.ok(window.document.querySelector('style'));

  await window.handleInitializeSchema();
  await waitFor(
    () => requests.some((request) => request.action === 'database.execute'),
    'INIT SCHEMA did not submit SQL through the Console bridge.'
  );

  const schemaRequest = requests.find((request) => request.action === 'database.execute');
  assert.equal(schemaRequest.payload.query, schema);

  if (window.__fetchDiagnosticsInterval) window.clearInterval(window.__fetchDiagnosticsInterval);
  if (window.__fetchPendingInterval) window.clearInterval(window.__fetchPendingInterval);
  if (window.__fetchDeliveryInterval) window.clearInterval(window.__fetchDeliveryInterval);
  dom.window.close();
});
