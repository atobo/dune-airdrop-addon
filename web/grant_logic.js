const STORAGE_KEY = 'pending_manual_grant';

// Opaque-origin Console iframes cannot use localStorage. Keep the intent in
// the existing addon-owned store, with compare-and-swap across tabs/reloads.
function createBridgeGrantStore(request) {
  const key = 'manual-grant.pending.v1';
  let version = null;
  return {
    async get() {
      const result = await request('addon.storage.get', { key });
      if (!result || typeof result.found !== 'boolean') throw new Error('Manual grant storage is unavailable.');
      if (result.found && (!Number.isInteger(result.version) || result.version < 1)) throw new Error('Manual grant storage version is invalid.');
      version = result.found ? result.version : null;
      if (!result.found || result.value === null) return null;
      return getStoredGrantState({
        getItem: () => JSON.stringify(result.value),
        removeItem: () => { throw new Error('Stored manual grant needs review; no new grant was sent.'); }
      });
    },
    async set(value) {
      const result = await request('addon.storage.put', { key, value, expectedVersion: version });
      if (!result?.ok || !Number.isInteger(result.version)) throw new Error('Manual grant state could not be saved.');
      version = result.version;
    },
    async clear() {
      // Retain a versioned null rather than deleting: versions must not reset
      // and let an older tab overwrite a newer request (the ABA problem).
      await this.set(null);
    }
  };
}

function getStoredGrantState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    
    if (!parsed || typeof parsed !== 'object') throw new Error('Not an object');
    if (typeof parsed.id !== 'string' || !parsed.id.startsWith('manual:grant:')) throw new Error('Invalid ID');
    if (parsed.status !== 'PENDING' && parsed.status !== 'UNCERTAIN') throw new Error('Invalid status');
    
    if (!parsed.payload || typeof parsed.payload !== 'object') throw new Error('Invalid payload');
    const p = parsed.payload;
    if (typeof p.playerId !== 'string' || p.playerId.trim() === '') throw new Error('Invalid playerId');
    if (typeof p.itemId !== 'string' || p.itemId.trim() === '') throw new Error('Invalid itemId');
    if (typeof p.containerId !== 'string' || p.containerId.trim() === '') throw new Error('Invalid containerId');
    
    if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 1000) throw new Error('Invalid quantity');
    if (!Number.isInteger(p.quality) || p.quality < 0 || p.quality > 5) throw new Error('Invalid quality');
    
    // Hash check
    if (parsed.hash !== computePayloadHash(p)) throw new Error('Hash mismatch');
    
    return parsed;
  } catch (e) {
    storage.removeItem(STORAGE_KEY);
    return null; // Corrupt local storage handled safely
  }
}

function setStoredGrantState(state, storage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearStoredGrantState(storage) {
  storage.removeItem(STORAGE_KEY);
}

function computePayloadHash(payload) {
  return JSON.stringify([
    payload.playerId,
    payload.itemId,
    payload.quantity,
    payload.quality,
    payload.containerId
  ]);
}

function isAmbiguousBridgeError(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  return message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('delivery outcome uncertain');
}

function determineActionAndState(currentState, newPayload, cryptoObj) {
  const newHash = computePayloadHash(newPayload);
  
  if (!currentState) {
    const newId = `manual:grant:${cryptoObj.randomUUID()}`;
    return {
      action: 'PROCEED',
      newState: { id: newId, payload: newPayload, hash: newHash, status: 'PENDING' }
    };
  }
  
  if (currentState.status === 'UNCERTAIN') {
    if (currentState.hash === newHash) {
      return { action: 'PROCEED', newState: currentState };
    } else {
      return { action: 'REJECT_UNCERTAIN', newState: currentState };
    }
  }
  
  if (currentState.hash === newHash) {
    return { action: 'PROCEED', newState: currentState };
  } else {
    // Another tab may still be waiting for this request. Never replace its
    // only durable ID before a receipt or explicit administrator review.
    return { action: 'REJECT_UNCERTAIN', newState: currentState };
  }
}

function handleBridgeReceipt(receipt, currentState, storage) {
  if (receipt && receipt.ok === true) {
    // Success - clear state
    clearStoredGrantState(storage);
    return { success: true, message: 'Spawned successfully' };
  } else {
    // E.g. bridge error or duplicate: true but ok is false.
    // Transition to uncertain state so we don't double-grant.
    if (currentState) {
      currentState.status = 'UNCERTAIN';
      setStoredGrantState(currentState, storage);
    }
    return { success: false, message: 'Delivery outcome uncertain. Retained request ID.' };
  }
}

function handlePermanentRejection(currentState, storage) {
  clearStoredGrantState(storage);
}

if (typeof module !== 'undefined') {
  module.exports = {
    getStoredGrantState,
    setStoredGrantState,
    clearStoredGrantState,
    computePayloadHash,
    determineActionAndState,
    handleBridgeReceipt,
    handlePermanentRejection,
    isAmbiguousBridgeError,
    createBridgeGrantStore
  };
}
