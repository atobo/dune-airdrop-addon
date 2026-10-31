import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const baseUrl = process.env.AIRDROP_CONSOLE_URL || 'http://console-api:8088';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
await page.goto(`${baseUrl}/real-console-host.html`, { waitUntil: 'domcontentloaded' });
const addon = page.frameLocator('#addon');
await assert.doesNotReject(() => addon.locator('#connectionStatusBadge').waitFor({ state: 'visible', timeout: 30000 }));
await assert.doesNotReject(() => addon.getByRole('button', { name: 'review' }).first().waitFor({ state: 'visible', timeout: 30000 }));

page.on('dialog', dialog => dialog.accept());
const firstReview = addon.getByRole('button', { name: 'review' }).first();
const approvedTemplate = await firstReview.locator('xpath=ancestor::tr/td[2]').textContent();
await firstReview.click();
await addon.getByText('Historical reward approved for normal offline-aware delivery.').waitFor({ timeout: 30000 });

// Clicking a stale approval function for the same row must affect zero rows and create no event.
const approvedId = await page.evaluate(() => {
  const write = window.__bridgeLog.find(entry => entry.action === 'database.execute' && entry.query.includes('Historical recovery approved'));
  return write?.query.match(/WHERE id = (\d+)::int/)?.[1];
});
assert.match(String(approvedId), /^\d+$/);
await addon.locator('body').evaluate((_, id) => window.approveHistoricalDelivery(id), approvedId);
await addon.getByText(/Recovery approval failed: Reward is no longer eligible/).waitFor({ timeout: 30000 });

// UNCERTAIN is never eligible, even when the function is invoked directly with its id.
await addon.locator('body').evaluate(() => window.approveHistoricalDelivery('2000'));
await addon.getByText(/Recovery approval failed: Reward is no longer eligible/).last().waitFor({ timeout: 30000 });

const visibleRows = await addon.locator('#pendingAirdropsTableBody tr').count();
const summary = await addon.locator('#deliverySummary').innerText();
const bridgeLog = await page.evaluate(() => window.__bridgeLog);
assert.equal(visibleRows, 500);
assert.match(summary, /WAITING FOR PLAYER\s+1999/);
assert.match(summary, /UNCERTAIN\s+1/);
assert.ok(bridgeLog.some(entry => entry.action === 'database.execute' && entry.ok));

// A deliberately broken parent bridge must time out without changing PostgreSQL.
const bridgeTargetId = await addon.getByRole('button', { name: 'review' }).first().getAttribute('onclick').then(value => value?.match(/'(\d+)'/)?.[1]);
assert.match(String(bridgeTargetId), /^\d+$/);
await page.evaluate(() => { window.__bridgeFailure = true; });
await addon.locator('body').evaluate((_, id) => window.approveHistoricalDelivery(id), bridgeTargetId);
await addon.getByText(/Recovery approval failed: Bridge request timed out/).waitFor({ timeout: 35000 });

console.log(JSON.stringify({ approvedId, approvedTemplate: approvedTemplate?.trim(), bridgeTargetId, visibleRows, summary, bridgeCalls: bridgeLog.length, consoleErrors }, null, 2));
await browser.close();
