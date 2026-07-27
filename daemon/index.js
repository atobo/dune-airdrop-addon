import pg from 'pg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const duneDockerRoot = process.env.DUNE_DOCKER_ROOT || '/repo';

let dbPassword = "dune";
try {
  const envPath = path.resolve(duneDockerRoot, '.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  const match = envFile.match(/^DUNE_DB_PASSWORD=(.*)$/m);
  if (match) dbPassword = match[1].trim();
} catch (e) {
  console.error("Could not read .env file, using default password.");
}

const DB_URL = process.env.DATABASE_URL || `postgres://dune:${dbPassword}@127.0.0.1:15432/dune`;

const pool = new pg.Pool({
  connectionString: DB_URL,
  connectionTimeoutMillis: 2000,
});

async function runCommand(executable, args, timeoutMs = 180000) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
    return { ok: true, stdout, stderr };
  } catch (err) {
    if (err.killed && err.signal === 'SIGKILL') {
      return { ok: false, error: 'TIMEOUT', stdout: err.stdout || '', stderr: err.stderr || '' };
    }
    return { ok: false, error: err.message || 'UNKNOWN_ERROR', stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function classifyError(errorStr, stdout, stderr) {
  if (errorStr === 'TIMEOUT') return 'TIMEOUT';
  
  const combinedOut = (stdout + ' ' + stderr).toLowerCase();
  
  if (combinedOut.includes("player is offline") || combinedOut.includes("cannot find player") || combinedOut.includes("no player by account id")) {
    return 'RETRY_OFFLINE';
  }
  
  if (combinedOut.includes("invalid item") || combinedOut.includes("cannot grant") || combinedOut.includes("validation failed")) {
    return 'VALIDATION_FAILED';
  }
  
  if (combinedOut.includes("verification failed") || combinedOut.includes("failed to verify")) {
    return 'VERIFICATION_FAILED';
  }

  return 'UNKNOWN_OUTPUT';
}

async function finalizeTransactionB(delivery, result) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const check = await client.query(`
      SELECT id FROM dune.bot_pending_deliveries 
      WHERE id = $1 AND lease_token = $2 FOR UPDATE
    `, [delivery.id, delivery.lease_token]);
    
    if (check.rows.length === 0) {
      console.warn(`[Transaction B] Lost lease for delivery ${delivery.id}. Performing no mutation.`);
      await client.query('ROLLBACK');
      return;
    }
    
    if (result.ok) {
      await client.query(`UPDATE dune.bot_delivery_receipts SET status = 'SUCCESS', status_updated_at = NOW() WHERE request_id = $1`, [delivery.request_id]);
      await client.query(`
        UPDATE dune.bot_pending_deliveries 
        SET is_applied = true, lease_token = NULL, locked_at = NULL, last_failure_code = NULL, last_failure_at = NULL
        WHERE id = $1
      `, [delivery.id]);
    } else {
      const code = classifyError(result.error, result.stdout, result.stderr);
      let rawReason = (result.error + ' | ' + result.stdout + ' | ' + result.stderr).replace(/\0/g, '');
      if (rawReason.length > 255) rawReason = rawReason.substring(0, 255);
      
      if (code === 'RETRY_OFFLINE') {
        await client.query(`DELETE FROM dune.bot_delivery_receipts WHERE request_id = $1 AND status = 'PENDING'`, [delivery.request_id]);
        await client.query(`
          UPDATE dune.bot_pending_deliveries 
          SET offline_deferrals = offline_deferrals + 1,
              next_eligibility_check_at = NOW() + LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(offline_deferrals, 2))),
              last_failure_code = 'RETRY_OFFLINE',
              last_failure_at = NOW(),
              lease_token = NULL,
              locked_at = NULL
          WHERE id = $1
        `, [delivery.id]);
      } else if (code === 'VALIDATION_FAILED') {
        await client.query(`UPDATE dune.bot_delivery_receipts SET status = 'FAILED', status_updated_at = NOW(), failure_reason = $2 WHERE request_id = $1`, [delivery.request_id, rawReason]);
        await client.query(`
          UPDATE dune.bot_pending_deliveries 
          SET is_applied = true, lease_token = NULL, locked_at = NULL, last_failure_code = $2, last_failure_at = NOW()
          WHERE id = $1
        `, [delivery.id, code]);
      } else {
        await client.query(`UPDATE dune.bot_delivery_receipts SET status = 'UNCERTAIN', status_updated_at = NOW(), failure_reason = $2 WHERE request_id = $1`, [delivery.request_id, rawReason]);
        await client.query(`
          UPDATE dune.bot_pending_deliveries 
          SET is_applied = true, lease_token = NULL, locked_at = NULL, last_failure_code = $2, last_failure_at = NOW()
          WHERE id = $1
        `, [delivery.id, code]);
      }
    }
    
    await client.query('COMMIT');
  } catch (err) {
    console.error(`[Transaction B] Finalization error for delivery ${delivery.id}:`, err);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function executeDelivery(delivery) {
  if (!/^[0-9]+$/.test(String(delivery.account_id))) {
    console.error(`[Transaction B] Invalid account_id for delivery ${delivery.id}. Terminating.`);
    await finalizeTransactionB(delivery, { ok: false, error: "VALIDATION_FAILED: Invalid account_id format." });
    return;
  }
  
  const executable = path.resolve(duneDockerRoot, 'runtime/scripts/dune');
  const args = ['admin', 'grant-item-id', String(delivery.account_id), String(delivery.template_id), String(delivery.stack_size), '1', String(delivery.quality_level || 0)];
  
  console.log(`Executing RCON [3min timeout] for delivery ID ${delivery.id} (Account: ${delivery.account_id}): ${executable} ${args.join(' ')}`);
  const result = await runCommand(executable, args);
  await finalizeTransactionB(delivery, result);
}

async function processOfflineDeferrals() {
  const client = await pool.connect();
  try {
    while (true) {
      await client.query('BEGIN');
      const res = await client.query(`
        WITH claim AS (
          SELECT pending.id 
          FROM dune.bot_pending_deliveries pending
          WHERE pending.is_applied = false 
            AND pending.lease_token IS NULL 
            AND pending.created_at <= NOW() - INTERVAL '60 seconds'
            AND (pending.next_eligibility_check_at IS NULL OR pending.next_eligibility_check_at <= NOW())
            AND NOT EXISTS (
              SELECT 1 FROM dune.player_state ps 
              WHERE ps.account_id = pending.account_id AND LOWER(ps.online_status::text) = 'online'
            )
          ORDER BY pending.next_eligibility_check_at ASC NULLS FIRST, pending.created_at ASC, pending.id ASC
          FOR UPDATE SKIP LOCKED LIMIT 10
        )
        UPDATE dune.bot_pending_deliveries 
        SET offline_deferrals = offline_deferrals + 1,
            next_eligibility_check_at = NOW() + LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(offline_deferrals, 2))),
            last_failure_code = 'OFFLINE_WAIT',
            last_failure_at = NOW()
        FROM claim WHERE dune.bot_pending_deliveries.id = claim.id
        RETURNING dune.bot_pending_deliveries.*;
      `);
      await client.query('COMMIT');
      if (res.rows.length === 0) break;
    }
  } catch (err) {
    if (err.message.includes("relation \"dune.player_state\" does not exist")) {
      // Ignore if table does not exist yet during migrations
    } else {
      console.error("Error processing offline deferrals:", err);
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function recoverLeases() {
  const client = await pool.connect();
  try {
    while (true) {
      await client.query('BEGIN');
      const res = await client.query(`
        SELECT id, request_id, account_id, template_id, stack_size, quality_level 
        FROM dune.bot_pending_deliveries
        WHERE is_applied = false 
          AND lease_token IS NOT NULL 
          AND locked_at < NOW() - INTERVAL '10 minutes'
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);

      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        break; 
      }
      
      const row = res.rows[0];
      const receiptRes = await client.query(`SELECT status, quality_level FROM dune.bot_delivery_receipts WHERE request_id = $1 FOR UPDATE`, [row.request_id]);
      
      if (receiptRes.rows.length === 0) {
        console.error(`[Lease Recovery] Missing receipt for delivery ID ${row.id}. Marking as CORRUPTED_NO_RECEIPT.`);
        await client.query(`
          UPDATE dune.bot_pending_deliveries 
          SET is_applied = true, last_failure_code = 'CORRUPTED_NO_RECEIPT', last_failure_at = NOW(), lease_token = NULL, locked_at = NULL 
          WHERE id = $1
        `, [row.id]);
      } else {
        const receipt = receiptRes.rows[0];
        if (receipt.quality_level !== row.quality_level) {
          console.error(`[Lease Recovery] Payload mismatch for delivery ID ${row.id}.`);
          await client.query(`
            UPDATE dune.bot_pending_deliveries 
            SET is_applied = true, last_failure_code = 'PAYLOAD_MISMATCH', last_failure_at = NOW(), lease_token = NULL, locked_at = NULL 
            WHERE id = $1
          `, [row.id]);
        } else if (receipt.status === 'PENDING') {
          console.log(`[Lease Recovery] Recovering abandoned PENDING delivery ID ${row.id}.`);
          await client.query(`UPDATE dune.bot_delivery_receipts SET status = 'UNCERTAIN', status_updated_at = NOW(), failure_reason = 'ABANDONED_PENDING' WHERE request_id = $1`, [row.request_id]);
          await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true, lease_token = NULL, locked_at = NULL WHERE id = $1`, [row.id]);
        } else {
          console.log(`[Lease Recovery] Synchronizing terminal receipt state for delivery ID ${row.id}.`);
          await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true, lease_token = NULL, locked_at = NULL WHERE id = $1`, [row.id]);
        }
      }
      await client.query('COMMIT');
    }
  } catch (err) {
    console.error("Error during lease recovery:", err);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function checkPendingDeliveries() {
  const client = await pool.connect();
  try {
    const configRes = await client.query(`SELECT config_value FROM dune.discord_bot_config WHERE config_key = 'airdrop_multipliers'`);
    if (configRes.rows.length > 0 && configRes.rows[0].config_value.daemon_enabled === false) return;

    while (true) {
      let delivery = null;
      let shouldDispatch = false;
      await client.query('BEGIN');
      
      const leaseToken = crypto.randomUUID();
      const claimRes = await client.query(`
        WITH claim AS (
          SELECT pending.id 
          FROM dune.bot_pending_deliveries pending
          WHERE pending.is_applied = false 
            AND pending.lease_token IS NULL 
            AND pending.created_at <= NOW() - INTERVAL '60 seconds'
            AND (pending.next_eligibility_check_at IS NULL OR pending.next_eligibility_check_at <= NOW())
            AND EXISTS (
              SELECT 1 FROM dune.player_state ps 
              WHERE ps.account_id = pending.account_id AND LOWER(ps.online_status::text) = 'online'
            )
          ORDER BY pending.next_eligibility_check_at ASC NULLS FIRST, pending.created_at ASC, pending.id ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE dune.bot_pending_deliveries 
        SET lease_token = $1, locked_at = NOW(), delivery_attempts = delivery_attempts + 1 
        FROM claim 
        WHERE dune.bot_pending_deliveries.id = claim.id 
        RETURNING dune.bot_pending_deliveries.*;
      `, [leaseToken]);
      
      if (claimRes.rows.length === 0) {
        await client.query('ROLLBACK');
        break;
      }
      
      delivery = claimRes.rows[0];
      
      const checkReceiptRes = await client.query(`SELECT status, quality_level FROM dune.bot_delivery_receipts WHERE request_id = $1 FOR UPDATE`, [delivery.request_id]);
      if (checkReceiptRes.rows.length === 0) {
        await client.query(`INSERT INTO dune.bot_delivery_receipts (request_id, status, quality_level) VALUES ($1, 'PENDING', $2)`, [delivery.request_id, delivery.quality_level || 0]);
        shouldDispatch = true;
      } else {
        const receipt = checkReceiptRes.rows[0];
        if (receipt.quality_level !== (delivery.quality_level || 0)) {
          await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true, last_failure_code = 'PAYLOAD_MISMATCH', last_failure_at = NOW(), lease_token = NULL, locked_at = NULL WHERE id = $1`, [delivery.id]);
        } else if (receipt.status === 'PENDING') {
          await client.query(`UPDATE dune.bot_delivery_receipts SET status = 'UNCERTAIN', status_updated_at = NOW(), failure_reason = 'ABANDONED_PENDING' WHERE request_id = $1`, [delivery.request_id]);
          await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true, lease_token = NULL, locked_at = NULL WHERE id = $1`, [delivery.id]);
        } else {
          await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true, lease_token = NULL, locked_at = NULL WHERE id = $1`, [delivery.id]);
        }
      }
      
      await client.query('COMMIT');
      
      if (shouldDispatch) {
        executeDelivery(delivery).catch(err => console.error("Dispatch execution failed:", err));
      }
    }
  } catch (err) {
    if (err.message.includes("relation \"dune.player_state\" does not exist")) {
      // Ignore during initial schema setup
    } else {
      console.error("Error checking for pending deliveries:", err);
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function loop() {
  await recoverLeases();
  await processOfflineDeferrals();
  await checkPendingDeliveries();
}

async function start() {
  console.log("Starting Dune Airdrop Node.js Delivery Daemon...");
  const sanitizedUrl = DB_URL.replace(/:([^:@]+)@/, ':***@');
  console.log("Attempting to connect to database at", sanitizedUrl, "...");
  
  let client;
  try {
    client = await pool.connect();
    console.log("Connected to database successfully!");
  } catch (err) {
    console.error("CRITICAL: Failed to connect to database!", err.message);
    process.exit(1);
  }

  console.log("Starting pending delivery retry loop...");
  loop();
  setInterval(loop, 30000);

  await client.query('LISTEN new_airdrop');
  console.log("Listening for real-time airdrop events via Postgres Pub/Sub...");

  client.on('notification', async (msg) => {
    try {
      console.log("\n--- Real-Time Airdrop Event Received! ---");
      // Check immediately for fast dispatch
      checkPendingDeliveries();
    } catch (err) {
      console.error("Error parsing or processing notification:", err);
    }
  });

  client.on('error', (err) => {
    console.error("Fatal database connection error:", err.message);
    process.exit(1);
  });

  setInterval(async () => {
    const hbClient = await pool.connect();
    try {
      await hbClient.query(`
        INSERT INTO dune.discord_bot_config (config_key, config_value) 
        VALUES ('daemon_heartbeat', jsonb_build_object('last_ping', NOW()))
        ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;
      `);
    } catch (err) {
      console.error("Failed to write daemon heartbeat:", err);
    } finally {
      hbClient.release();
    }
  }, 15000);
}

start();
