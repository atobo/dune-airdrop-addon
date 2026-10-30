import test from "node:test";
import assert from "node:assert/strict";
import { DeliveryState, classifyDeliveryResult, retryDelaySeconds, safeIdentity } from "./deliveryState.js";

test("only a confirmed success is delivered", () => {
  assert.equal(classifyDeliveryResult({ ok: true, stdout: "Verified inventory stack increased." }).state, DeliveryState.DELIVERED);
  assert.equal(classifyDeliveryResult({ ok: true, stderr: "inventory stack did not increase" }).state, DeliveryState.UNCERTAIN);
  assert.equal(classifyDeliveryResult({ timedOut: true }).state, DeliveryState.UNCERTAIN);
});

test("offline and invalid failures are classified without duplicate-risk retries", () => {
  assert.equal(classifyDeliveryResult({ ok: false, stderr: "Player is Offline." }).state, DeliveryState.WAITING_FOR_PLAYER);
  assert.equal(classifyDeliveryResult({ ok: false, stderr: "Invalid item id" }).state, DeliveryState.FAILED);
  assert.equal(classifyDeliveryResult({ ok: false, stderr: "connection closed" }).state, DeliveryState.UNCERTAIN);
});

test("identity resolution prefers a valid FLS identifier and rejects malformed inputs", () => {
  assert.deepEqual(safeIdentity({ account_id: "42", fls_id: "ABCDEF123456789", online_status: "Online" }), { ok: true, playerId: "ABCDEF123456789", identityType: "fls_id", online: true });
  assert.equal(safeIdentity({ account_id: "not-a-number" }).ok, false);
  assert.equal(safeIdentity({ account_id: "42", fls_id: "short" }).ok, false);
});

test("retry backoff is bounded", () => {
  assert.equal(retryDelaySeconds(1), 30);
  assert.equal(retryDelaySeconds(2), 60);
  assert.equal(retryDelaySeconds(99), 3600);
});
