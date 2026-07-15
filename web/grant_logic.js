const STORAGE_KEY = 'pending_manual_grant';

function getStoredGrantState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.status || !parsed.payload) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
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
  return `${payload.playerId}:${payload.itemId}:${payload.quantity}:${payload.quality}`;
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
    const newId = `manual:grant:${cryptoObj.randomUUID()}`;
    return {
      action: 'PROCEED',
      newState: { id: newId, payload: newPayload, hash: newHash, status: 'PENDING' }
    };
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
    handlePermanentRejection
  };
}
