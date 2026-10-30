import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "../../daemon/node_modules/pg/lib/index.js";

const url = process.env.AIRDROP_TEST_DATABASE_URL;
if (!url || !/airdrop_integration_test/.test(url) || /(?:dune-postgres|postgres:15432|\/dune(?:\?|$))/i.test(url)) {
  throw new Error("Refusing database connection: AIRDROP_TEST_DATABASE_URL must name the isolated dune_airdrop_integration_test database.");
}
const client = new pg.Client({ connectionString: url });
const root = path.resolve(import.meta.dirname, "../..");
const sql = fs.readFileSync(path.join(root, "setup_playtime_airdrops.sql"), "utf8");
const q = (text, values) => client.query(text, values);

async function reset() {
  await q("DROP SCHEMA IF EXISTS dune_airdrop CASCADE; DROP SCHEMA IF EXISTS dune CASCADE; DROP ROLE IF EXISTS dune;");
  await q(fs.readFileSync(path.join(import.meta.dirname, "bootstrap.sql"), "utf8"));
}
async function fixture(kind) {
  await q("CREATE SCHEMA dune_airdrop AUTHORIZATION dune; SET ROLE dune;");
  await q(`CREATE TABLE dune_airdrop.active_playtime (character_id BIGINT PRIMARY KEY, active_seconds INT, last_xp BIGINT, last_x DOUBLE PRECISION, last_y DOUBLE PRECISION, last_z DOUBLE PRECISION, last_active_at TIMESTAMPTZ, last_login_date DATE, consecutive_days INT, weekly_login_mask INT, current_week_id INT, last_weekly_claimed_at TIMESTAMPTZ);
    CREATE TABLE dune_airdrop.pending_deliveries (id SERIAL PRIMARY KEY, request_id UUID DEFAULT gen_random_uuid() UNIQUE, account_id BIGINT NOT NULL, template_id TEXT NOT NULL, stack_size INT NOT NULL, quality_level INT DEFAULT 0, is_applied BOOLEAN DEFAULT false, locked_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE dune_airdrop.delivery_receipts (request_id UUID PRIMARY KEY, account_id BIGINT NOT NULL, template_id TEXT NOT NULL, quantity INT NOT NULL, status TEXT DEFAULT 'SUCCESS', granted_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE dune_airdrop.config (config_key TEXT PRIMARY KEY, config_value JSONB);
    CREATE TABLE dune_airdrop.loot_tables (tier INT, category TEXT, template_id TEXT, weight INT, PRIMARY KEY (tier, category, template_id));`);
  await q("INSERT INTO dune_airdrop.active_playtime VALUES (1001, 7200, 42, 1, 2, 3, now(), CURRENT_DATE, 6, 31, 202645, now())");
  await q("INSERT INTO dune_airdrop.config VALUES ('airdrop_multipliers', '{\"playtime_interval\":77,\"weekly_days_required\":6}'), ('custom_setting', '{\"keep\":true}')");
  await q("INSERT INTO dune_airdrop.loot_tables VALUES (1, 'gear', 'CustomLoot', 77)");
  await q("INSERT INTO dune_airdrop.pending_deliveries (request_id, account_id, template_id, stack_size, is_applied) VALUES ('00000000-0000-0000-0000-000000000001', 1001, 'PendingReward', 2, false), ('00000000-0000-0000-0000-000000000002', 1001, 'DeliveredReward', 1, true), ('00000000-0000-0000-0000-000000000003', 1001, 'UncertainReward', 3, false)");
  await q("INSERT INTO dune_airdrop.delivery_receipts VALUES ('00000000-0000-0000-0000-000000000002',1001,'DeliveredReward',1,'SUCCESS',now()), ('00000000-0000-0000-0000-000000000003',1001,'UncertainReward',3,'PENDING',now())");
  if (kind === "v136") {
    await q("ALTER TABLE dune_airdrop.active_playtime RENAME TO legacy_active; ALTER TABLE dune_airdrop.pending_deliveries RENAME TO legacy_pending; ALTER TABLE dune_airdrop.delivery_receipts RENAME TO legacy_receipts; ALTER TABLE dune_airdrop.config RENAME TO legacy_config; ALTER TABLE dune_airdrop.loot_tables RENAME TO legacy_loot;");
    await q("ALTER TABLE dune_airdrop.legacy_active SET SCHEMA dune; ALTER TABLE dune_airdrop.legacy_pending SET SCHEMA dune; ALTER TABLE dune_airdrop.legacy_receipts SET SCHEMA dune; ALTER TABLE dune_airdrop.legacy_config SET SCHEMA dune; ALTER TABLE dune_airdrop.legacy_loot SET SCHEMA dune; ALTER TABLE dune.legacy_active RENAME TO airdrop_active_playtime; ALTER TABLE dune.legacy_pending RENAME TO airdrop_pending_deliveries; ALTER TABLE dune.legacy_receipts RENAME TO airdrop_delivery_receipts; ALTER TABLE dune.legacy_config RENAME TO airdrop_config; ALTER TABLE dune.legacy_loot RENAME TO airdrop_loot_tables;");
  }
  await q("RESET ROLE");
}
async function check(label) {
  const before = await q("SELECT active_seconds, consecutive_days, weekly_login_mask, current_week_id FROM dune_airdrop.active_playtime WHERE character_id=1001");
  assert.deepEqual(before.rows[0], { active_seconds: 7200, consecutive_days: 6, weekly_login_mask: 31, current_week_id: 202645 }, label);
  const rows = await q("SELECT template_id, is_applied, delivery_state, requires_recovery_approval FROM dune_airdrop.pending_deliveries ORDER BY template_id");
  assert.equal(rows.rowCount, 3); assert.equal(rows.rows.find(r => r.template_id === 'DeliveredReward').delivery_state, 'DELIVERED');
  assert.equal(rows.rows.find(r => r.template_id === 'PendingReward').requires_recovery_approval, true);
  assert.equal(rows.rows.find(r => r.template_id === 'UncertainReward').delivery_state, 'UNCERTAIN');
  assert.equal((await q("SELECT config_value FROM dune_airdrop.config WHERE config_key='custom_setting'")).rows[0].config_value.keep, true);
  assert.equal((await q("SELECT weight FROM dune_airdrop.loot_tables WHERE template_id='CustomLoot'")).rows[0].weight, 77);
}
try {
  await client.connect();
  for (const version of ["v137", "v136"]) { await reset(); await fixture(version); await q(sql); await check(version); await q(sql); await check(`${version} rerun`); }
  console.log("PostgreSQL migration integration: 2 verified historical fixtures, initial migration and rerun passed.");
} finally { await client.end(); }
