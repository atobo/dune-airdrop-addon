import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const entry = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const schema = readFileSync(resolve(root, 'setup_playtime_airdrops.sql'), 'utf8');
const assetRequests = [];

const hostHtml = `<!doctype html>
<meta charset="utf-8">
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style>
<iframe id="addon" sandbox="allow-scripts" src="/api/addons/installed/dune-airdrop-addon/content/web/index.html"></iframe>
<script>
  window.__bridgeLog = [];
  addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type !== 'dune-addon-request') return;
    const query = message.payload?.query || '';
    const entry = { action: message.action, query };
    window.__bridgeLog.push(entry);
    let result = { rows: [] };
    if (message.action === 'database.query' && query.includes("to_regclass('dune_airdrop.config')")) {
      result = { rows: [{ config_table: 'dune_airdrop.config', playtime_table: 'dune_airdrop.active_playtime', queue_table: 'dune_airdrop.pending_deliveries' }] };
    }
    event.source.postMessage({ type: 'dune-addon-response', addonId: message.addonId, requestId: message.requestId, ok: true, result }, '*');
  });
</script>`;

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://console.test');
  if (url.pathname === '/host.html') {
    response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'console_session=approved; SameSite=Strict' });
    response.end(hostHtml);
    return;
  }
  if (url.pathname === '/api/addons/installed/dune-airdrop-addon/content/web/index.html') {
    if (!request.headers.cookie?.includes('console_session=approved')) {
      response.writeHead(401).end('authentication required');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"
    });
    response.end(entry);
    return;
  }
  if (url.pathname.startsWith('/api/addons/installed/dune-airdrop-addon/content/')) {
    assetRequests.push(url.pathname);
    response.writeHead(401).end('separate addon assets are unavailable in this sandbox');
    return;
  }
  response.writeHead(404).end('not found');
});

await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  const failedResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${port}/host.html`, { waitUntil: 'domcontentloaded' });

  const addon = page.frameLocator('#addon');
  await addon.locator('#connectionStatusBadge').waitFor({ state: 'visible', timeout: 10000 });
  const frame = page.frames().find((candidate) => candidate.url().endsWith('/web/index.html'));
  assert.ok(frame, 'The sandboxed addon frame did not load.');
  assert.equal(await frame.evaluate(() => typeof window.DuneAddon?.request), 'function');

  await frame.evaluate(() => {
    window.confirm = () => true;
    return window.handleInitializeSchema();
  });
  await page.waitForTimeout(750);
  const bridgeLog = await page.evaluate(() => window.__bridgeLog);
  const schemaRequest = bridgeLog.find((entry) => entry.action === 'database.execute');
  assert.ok(schemaRequest, `INIT SCHEMA did not reach the parent bridge: ${JSON.stringify(bridgeLog)}`);
  assert.equal(schemaRequest.query, schema);
  assert.deepEqual(assetRequests, []);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${JSON.stringify({ consoleErrors, failedResponses })}`);

  console.log(JSON.stringify({ assetRequests, bridgeActions: bridgeLog.map((entry) => entry.action), failedResponses }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}
