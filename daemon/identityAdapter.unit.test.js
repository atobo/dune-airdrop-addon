import test from "node:test";
import assert from "node:assert/strict";
import { resolveGrantIdentity } from "./identityAdapter.js";
const clientFor = (rows) => ({ query: async () => ({ rows }) });
test("identity adapter prefers FLS and fails closed", async () => {
  const fls = await resolveGrantIdentity(clientFor([{ account_id: "42", fls_id: "abcdef012345678", online_status: "Online" }]), 42);
  assert.equal(fls.playerId, "abcdef012345678"); assert.equal(fls.online, true);
  assert.equal((await resolveGrantIdentity(clientFor([]), 42)).code, "UNRESOLVED_IDENTITY");
  assert.equal((await resolveGrantIdentity(clientFor([{ account_id: "42" }, { account_id: "42" }]), 42)).code, "AMBIGUOUS_IDENTITY");
  assert.equal((await resolveGrantIdentity(clientFor([{ account_id: "42", fls_id: "bad" }]), 42)).code, "INVALID_FLS_ID");
});
