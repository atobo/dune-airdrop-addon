import test from "node:test";
import assert from "node:assert/strict";
import { classifyGrantResult } from "./deliveryResult.js";

test("confirmed native grants are successful", () => {
  assert.equal(classifyGrantResult({ ok: true, stdout: "Verified inventory stack increased." }), "SUCCESS");
});

test("published but unverified grants become uncertain", () => {
  assert.equal(classifyGrantResult({
    ok: true,
    stderr: "WARNING: publish succeeded, but the player's inventory stack did not increase for an item."
  }), "UNCERTAIN");
});

test("definitive command failures remain retryable", () => {
  assert.equal(classifyGrantResult({ ok: false, stderr: "Player is Offline." }), "RETRY");
});
