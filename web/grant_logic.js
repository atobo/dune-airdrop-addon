const STORAGE_KEY = 'pending_manual_grant';

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
  return `${payload.playerId}:${payload.itemId}:${payload.quantity}:${payload.quality}:${payload.containerId}`;
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
