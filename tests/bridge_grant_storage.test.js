const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridgeGrantStore, determineActionAndState } = require('../web/grant_logic');
const { webcrypto } = require('node:crypto');

function hostStore() {
  let value = null, version = 0;
  return async (action, payload) => {
    if (action === 'addon.storage.get') return { found: version > 0, version, value };
    assert.equal(action, 'addon.storage.put');
    if (payload.expectedVersion !== (version || null)) throw new Error('Storage changed.');
    value = structuredClone(payload.value);
    return { ok: true, version: ++version };
  };
}
const payload = { playerId: 'test-player', itemId: 'TestItem', quantity: 1, quality: 0, containerId: '123' };

test('uncertain grant survives frame reload and retains its request ID', async () => {
  const host = hostStore();
  const before = createBridgeGrantStore(host);
  assert.equal(await before.get(), null);
  const { newState } = determineActionAndState(null, payload, webcrypto);
  newState.status = 'UNCERTAIN';
  await before.set(newState);
  const after = createBridgeGrantStore(host);
  const recovered = await after.get();
  assert.equal(determineActionAndState(recovered, payload, webcrypto).newState.id, newState.id);
  await after.clear();
  assert.equal(await after.get(), null);
});

test('concurrent tabs cannot overwrite a pending grant, even after a clear', async () => {
  const host = hostStore(), first = createBridgeGrantStore(host), stale = createBridgeGrantStore(host);
  await first.get(); await stale.get();
  const state = determineActionAndState(null, payload, webcrypto).newState;
  await first.set(state);
  await assert.rejects(stale.set(state), /changed/);
  await stale.get();
  await first.clear();
  await first.get(); await first.set(state);
  await assert.rejects(stale.clear(), /changed/);
});

test('corrupt, unavailable and failed storage fail closed', async () => {
  const corrupt = createBridgeGrantStore(async () => ({ found: true, version: 1, value: { broken: true } }));
  await assert.rejects(corrupt.get(), /review/);
  await assert.rejects(createBridgeGrantStore(async () => ({})).get(), /unavailable/);
  const failing = createBridgeGrantStore(async () => { throw new Error('Storage offline'); });
  await assert.rejects(failing.set({}), /offline/);
});
