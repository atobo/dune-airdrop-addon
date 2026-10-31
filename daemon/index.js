import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildDatabaseConfig, parseEnvFile } from "./databaseConfig.js";
import { DeliveryState, classifyDeliveryResult, retryDelaySeconds } from "./deliveryState.js";
import { resolveGrantIdentity } from "./identityAdapter.js";

const execFileAsync = promisify(execFile);
const duneDockerRoot = process.env.DUNE_DOCKER_ROOT || "/repo";
const COMMAND_TIMEOUT_MS = 180000;
const LEASE_SECONDS = 300;
let tickRunning = false;
let envFileValues = {};
try { envFileValues = parseEnvFile(fs.readFileSync(path.resolve(duneDockerRoot, ".env"), "utf8")); } catch { console.warn("Could not read .env file; using environment variables and database defaults."); }
const databaseConfig = buildDatabaseConfig(process.env, envFileValues);
const pool = new pg.Pool(databaseConfig.pool);

async function runCommand(executable, args) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, { timeout: COMMAND_TIMEOUT_MS, killSignal: "SIGKILL" });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return { ok: false, timedOut: error.killed === true || error.signal === "SIGKILL", error: error.message || "command failed", stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

function resultDetail(result) { return `${result.error || ""}\n${result.stderr || ""}\n${result.stdout || ""}`.replace(/\0/g, "").slice(0, 500); }
async function appendEvent(client, deliveryId, state, detail = "") {
  await client.query("INSERT INTO dune_airdrop.delivery_events (delivery_id, state, detail) VALUES ($1, $2, $3)", [deliveryId, state, detail.slice(0, 500)]);
}

// This mirrors the console's current preference: FLS ID when present, then the
// durable account ID. The external daemon cannot legitimately invoke iframe bridge actions.
const resolveIdentity = resolveGrantIdentity;

async function recoverExpiredLeases(client) {
  const result = await client.query(`
    UPDATE dune_airdrop.pending_deliveries
    SET delivery_state = $1, locked_at = NULL, last_error_code = 'ABANDONED_DELIVERY', last_error_at = NOW(), updated_at = NOW()
    WHERE delivery_state = $2 AND locked_at < NOW() - INTERVAL '5 minutes'
    RETURNING id, request_id`, [DeliveryState.UNCERTAIN, DeliveryState.DELIVERING]);
  for (const row of result.rows) {
    await client.query("UPDATE dune_airdrop.delivery_receipts SET status = 'UNCERTAIN', status_updated_at = NOW(), failure_reason = 'Daemon lease expired after command preparation.' WHERE request_id = $1 AND status = 'PENDING'", [row.request_id]);
    await appendEvent(client, row.id, DeliveryState.UNCERTAIN, "Daemon lease expired; administrator reconciliation required.");
  }
}

async function deferOfflineDeliveries(client) {
  const result = await client.query(`
    UPDATE dune_airdrop.pending_deliveries pending
    SET delivery_state = $1, next_attempt_at = NOW() + INTERVAL '5 minutes', last_error_code = 'PLAYER_OFFLINE', last_error_at = NOW(), updated_at = NOW()
    WHERE pending.is_applied = false AND pending.requires_recovery_approval = false AND pending.resolution_status IS NULL
      AND pending.delivery_state IN ($2, $3, $4) AND coalesce(pending.next_attempt_at, NOW()) <= NOW()
      AND NOT EXISTS (SELECT 1 FROM dune.player_state ps WHERE ps.account_id = pending.account_id AND lower(ps.online_status::text) = 'online')
    RETURNING pending.id`, [DeliveryState.WAITING_FOR_PLAYER, DeliveryState.READY, DeliveryState.RETRY_WAIT, DeliveryState.WAITING_FOR_PLAYER]);
  for (const row of result.rows) await appendEvent(client, row.id, DeliveryState.WAITING_FOR_PLAYER, "Player is offline; delivery deferred.");
}

async function claimDelivery(client) {
  const result = await client.query(`
    WITH candidate AS (
      SELECT id FROM dune_airdrop.pending_deliveries
      WHERE is_applied = false AND requires_recovery_approval = false AND resolution_status IS NULL
        AND delivery_state IN ($1, $2, $3) AND coalesce(next_attempt_at, NOW()) <= NOW()
      ORDER BY created_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE dune_airdrop.pending_deliveries pending
      SET delivery_state = $4, locked_at = NOW(), delivery_attempts = delivery_attempts + 1, updated_at = NOW()
      FROM candidate WHERE pending.id = candidate.id RETURNING pending.*`,
    [DeliveryState.READY, DeliveryState.RETRY_WAIT, DeliveryState.WAITING_FOR_PLAYER, DeliveryState.DELIVERING]);
  return result.rows[0] || null;
}

async function prepareDelivery(client, delivery) {
  const result = await client.query("SELECT status, account_id, template_id, quantity FROM dune_airdrop.delivery_receipts WHERE request_id = $1 FOR UPDATE", [delivery.request_id]);
  if (result.rows.length) {
    const receipt = result.rows[0];
    const same = String(receipt.account_id) === String(delivery.account_id) && receipt.template_id === delivery.template_id && Number(receipt.quantity) === Number(delivery.stack_size);
    if (same && (receipt.status === DeliveryState.WAITING_FOR_PLAYER || receipt.status === DeliveryState.RETRY_WAIT)) {
      await client.query("UPDATE dune_airdrop.delivery_receipts SET status = 'PENDING', status_updated_at = NOW(), failure_reason = NULL WHERE request_id = $1", [delivery.request_id]);
      await appendEvent(client, delivery.id, DeliveryState.DELIVERING, "Previously confirmed non-delivery is being retried.");
      return true;
    }
    const state = receipt.status === "SUCCESS" && same ? DeliveryState.DELIVERED : DeliveryState.UNCERTAIN;
    await client.query("UPDATE dune_airdrop.pending_deliveries SET delivery_state = $1, locked_at = NULL, is_applied = $2, last_error_code = $3, last_error_at = NOW(), updated_at = NOW() WHERE id = $4", [state, state === DeliveryState.DELIVERED, state === DeliveryState.DELIVERED ? null : "EXISTING_RECEIPT_REQUIRES_REVIEW", delivery.id]);
    await appendEvent(client, delivery.id, state, "Existing receipt prevented automatic command dispatch.");
    return false;
  }
  await client.query(`INSERT INTO dune_airdrop.delivery_receipts (request_id, account_id, template_id, quantity, status, status_updated_at)
    VALUES ($1, $2, $3, $4, 'PENDING', NOW())`, [delivery.request_id, delivery.account_id, delivery.template_id, delivery.stack_size]);
  await appendEvent(client, delivery.id, DeliveryState.DELIVERING, "Command prepared with persistent receipt.");
  return true;
}

async function finalizeDelivery(delivery, outcome, result) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const delay = outcome.state === DeliveryState.WAITING_FOR_PLAYER ? "NOW() + INTERVAL '5 minutes'" : outcome.state === DeliveryState.RETRY_WAIT ? `NOW() + INTERVAL '${retryDelaySeconds(delivery.delivery_attempts)} seconds'` : "NULL";
    await client.query(`UPDATE dune_airdrop.pending_deliveries SET delivery_state = $1, is_applied = $2, locked_at = NULL, next_attempt_at = ${delay}, last_error_code = $3::text, last_error_at = CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() END, updated_at = NOW() WHERE id = $4 AND delivery_state = $5`, [outcome.state, outcome.state === DeliveryState.DELIVERED, outcome.code === "VERIFIED" ? null : outcome.code, delivery.id, DeliveryState.DELIVERING]);
    const receiptStatus = outcome.state === DeliveryState.DELIVERED ? "SUCCESS" : outcome.state;
    await client.query("UPDATE dune_airdrop.delivery_receipts SET status = $1, granted_at = CASE WHEN $1 = 'SUCCESS' THEN NOW() ELSE granted_at END, status_updated_at = NOW(), failure_reason = $2 WHERE request_id = $3", [receiptStatus, outcome.code === "VERIFIED" ? null : resultDetail(result), delivery.request_id]);
    await appendEvent(client, delivery.id, outcome.state, outcome.code);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function dispatchDelivery(delivery) {
  const client = await pool.connect();
  let identity;
  try { identity = await resolveIdentity(client, delivery.account_id); } finally { client.release(); }
  if (!identity.ok) return finalizeDelivery(delivery, { state: DeliveryState.FAILED, code: identity.code }, { error: identity.code });
  if (!identity.online) return finalizeDelivery(delivery, { state: DeliveryState.WAITING_FOR_PLAYER, code: "PLAYER_OFFLINE" }, { error: "Player is offline" });
  const result = await runCommand(path.resolve(duneDockerRoot, "runtime/scripts/dune"), ["admin", "grant-item-id", identity.playerId, String(delivery.template_id), String(delivery.stack_size), "1", String(delivery.quality_level || 0)]);
  return finalizeDelivery(delivery, classifyDeliveryResult(result), result);
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await recoverExpiredLeases(client);
    await deferOfflineDeliveries(client);
    const delivery = await claimDelivery(client);
    if (!delivery) { await client.query("COMMIT"); return; }
    const dispatch = await prepareDelivery(client, delivery);
    await client.query("COMMIT");
    if (dispatch) await dispatchDelivery(delivery);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Airdrop delivery tick failed:", error.message || error);
  } finally { client.release(); tickRunning = false; }
}

async function start() {
  console.log(`Starting Dune Airdrop Delivery Daemon (${databaseConfig.display})`);
  const listener = await pool.connect();
  await listener.query("LISTEN new_airdrop");
  listener.on("notification", () => void tick());
  listener.on("error", (error) => { console.error("Airdrop notification connection failed:", error.message || error); process.exitCode = 1; });
  await tick();
  setInterval(() => void tick(), 30000);
  setInterval(async () => {
    const client = await pool.connect();
    try { await client.query("INSERT INTO dune_airdrop.config (config_key, config_value) VALUES ('daemon_heartbeat', jsonb_build_object('last_ping', NOW(), 'version', '2')) ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value"); } finally { client.release(); }
  }, 15000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => { console.error("Airdrop daemon failed to start:", error.message || error); process.exit(1); });
}

export { pool, resolveIdentity, claimDelivery, prepareDelivery, finalizeDelivery, tick, start };
