export const DeliveryState = Object.freeze({
  READY: "READY",
  WAITING_FOR_PLAYER: "WAITING_FOR_PLAYER",
  DELIVERING: "DELIVERING",
  DELIVERED: "DELIVERED",
  RETRY_WAIT: "RETRY_WAIT",
  FAILED: "FAILED",
  UNCERTAIN: "UNCERTAIN",
  CANCELLED: "CANCELLED",
  LEGACY_REVIEW: "LEGACY_REVIEW"
});

const OFFLINE_RE = /(?:player is offline|player.*not online|offline player)/i;
const INVALID_ITEM_RE = /(?:invalid item|unknown item|item id .* not found|invalid template)/i;
const DEFINITIVE_IDENTITY_RE = /(?:invalid player|player id .* invalid|multiple players)/i;
const INVENTORY_UNCHANGED_RE = /inventory stack did not increase/i;

// This classifier deliberately has a small retry allow-list. Once a command may
// have reached the game server, retrying it could duplicate an earned reward.
export function classifyDeliveryResult(result = {}) {
  const output = `${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.timedOut || /\btimeout\b/i.test(String(result.error || ""))) {
    return { state: DeliveryState.UNCERTAIN, code: "COMMAND_TIMEOUT", retryable: false };
  }
  if (OFFLINE_RE.test(output)) {
    return { state: DeliveryState.WAITING_FOR_PLAYER, code: "PLAYER_OFFLINE", retryable: true };
  }
  if (INVALID_ITEM_RE.test(output)) {
    return { state: DeliveryState.FAILED, code: "INVALID_ITEM", retryable: false };
  }
  if (DEFINITIVE_IDENTITY_RE.test(output)) {
    return { state: DeliveryState.FAILED, code: "INVALID_IDENTITY", retryable: false };
  }
  if (result.ok && !INVENTORY_UNCHANGED_RE.test(output)) {
    return { state: DeliveryState.DELIVERED, code: "VERIFIED", retryable: false };
  }
  return { state: DeliveryState.UNCERTAIN, code: "UNVERIFIED_COMMAND_RESULT", retryable: false };
}

export function retryDelaySeconds(attempts) {
  const attempt = Math.max(1, Number(attempts) || 1);
  return Math.min(60 * 60, 30 * (2 ** Math.min(attempt - 1, 7)));
}

export function safeIdentity(row = {}) {
  const accountId = String(row.account_id ?? "").trim();
  const flsId = String(row.fls_id ?? "").trim();
  const online = String(row.online_status ?? "").toLowerCase() === "online";
  if (!/^\d+$/.test(accountId)) return { ok: false, code: "INVALID_ACCOUNT_ID" };
  if (flsId && !/^[a-f0-9]{15,64}$/i.test(flsId)) return { ok: false, code: "INVALID_FLS_ID" };
  return { ok: true, playerId: flsId || accountId, identityType: flsId ? "fls_id" : "account_id", online };
}
