const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "setup_playtime_airdrops.sql"), "utf8");

test("delivery lifecycle migration is additive and preserves historical rows", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS delivery_state/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS requires_recovery_approval/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS resolution_status/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS dune_airdrop\.delivery_events/i);
  assert.match(sql, /delivery_lifecycle_v2_migrated/);
  assert.match(sql, /LEGACY_RECOVERY_REQUIRES_APPROVAL/);
  assert.match(sql, /LEGACY_UNCERTAIN_RECEIPT/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+dune_airdrop\.(?:pending_deliveries|delivery_receipts|active_playtime)/i);
  assert.doesNotMatch(sql, /TRUNCATE\s+(?:TABLE\s+)?dune_airdrop\./i);
});

test("resolution data is additive and archived records are excluded from dispatch", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS resolved_at/i);
  assert.match(sql, /resolution_status IS NULL/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+dune_airdrop\.delivery_events/i);
});

test("administrator-reviewed loot corrections are explicit and non-destructive", () => {
  assert.match(sql, /BEGIN ADMIN-REVIEWED LOOT-POOL CORRECTIONS/);
  assert.match(sql, /\('T6IrradiatedCore', 'raw_resources', 'crafted_components'\)/);
  assert.match(sql, /\('DolomiteRock', 'crafted_components', 'raw_resources'\)/);
  assert.ok(sql.indexOf('BEGIN ADMIN-REVIEWED LOOT-POOL CORRECTIONS') < sql.indexOf('BEGIN AUTO-GENERATED LOOT POOLS'));
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+dune_airdrop\.loot_tables/i);
});

test("historical pending and uncertain receipts are held rather than replayed", () => {
  assert.match(sql, /WHEN receipt\.status IN \('PENDING', 'UNCERTAIN'\) THEN 'UNCERTAIN'/);
  assert.match(sql, /requires_recovery_approval = NOT pending\.is_applied/);
});
