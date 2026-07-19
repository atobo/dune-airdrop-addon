import pg from 'pg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyGrantResult } from './deliveryResult.js';
import { buildDatabaseConfig, parseEnvFile } from './databaseConfig.js';

const execFileAsync = promisify(execFile);

// Resolve the root of the Dune Docker Console by taking it from env or defaulting to /repo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const duneDockerRoot = process.env.DUNE_DOCKER_ROOT || '/repo';

let envFileValues = {};
try {
  const envPath = path.resolve(duneDockerRoot, '.env');
  envFileValues = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
} catch (e) {
  console.warn("Could not read .env file; using environment variables and database defaults.");
}

const databaseConfig = buildDatabaseConfig(process.env, envFileValues);
const pool = new pg.Pool(databaseConfig.pool);

async function runCommand(executable, args) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args);
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
  }
}

let isProcessing = false;

async function executeDelivery(row) {

  console.log(`Executing delivery ID ${row.id} for account ${row.account_id}: ${row.stack_size}x ${row.template_id} (Quality: ${row.quality_level})`);
  
  const playerId = row.account_id;
  const itemId = row.template_id;
  const quantity = row.stack_size;
  const quality = row.quality_level || 0;

  const client = await pool.connect();
  try {
    // 1. Check Receipt Table FIRST
    const receiptCheck = await client.query(`SELECT status FROM dune.bot_delivery_receipts WHERE request_id = $1`, [row.request_id]);
    if (receiptCheck.rows.length > 0) {
      const status = receiptCheck.rows[0].status;
      if (status === 'SUCCESS') {
        console.log(`Receipt already exists and is SUCCESS for request_id ${row.request_id}. Marking as applied.`);
        await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
        return;
      } else if (status === 'PENDING' || status === 'UNCERTAIN') {
        console.warn(`Request ID ${row.request_id} has status ${status}. The daemon previously crashed during the execution boundary! Transitioning to UNCERTAIN and locking delivery to prevent double-grants.`);
        await client.query(`UPDATE dune.bot_delivery_receipts SET status = 'UNCERTAIN' WHERE request_id = $1`, [row.request_id]);
        await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
        return;
      }
    }
  } catch (err) {
    console.error("Error checking receipt:", err);
    return;
  } finally {
    client.release();
  }
  
  const updateClient = await pool.connect();
  try {
    // 2. Persist PENDING receipt BEFORE external execution boundary
    await updateClient.query(`
      INSERT INTO dune.bot_delivery_receipts (request_id, account_id, template_id, quantity, status)
      VALUES ($1, $2, $3, $4, 'PENDING')
      ON CONFLICT (request_id) DO UPDATE SET status = 'PENDING'
    `, [row.request_id, playerId, itemId, quantity]);
    
    // Execute the native dune CLI command to trigger the RCON item spawn exactly like Redblink does
    const executable = path.resolve(duneDockerRoot, 'runtime/scripts/dune');
    const args = ['admin', 'grant-item-id', String(playerId), String(itemId), String(quantity), '1', String(quality)];
    
    console.log(`Executing RCON: ${executable} ${args.join(' ')}`);
    const result = await runCommand(executable, args);
    
    const outcome = classifyGrantResult(result);
    if (outcome === 'SUCCESS') {
      console.log(`Successfully dropped item! Updating receipt to SUCCESS and marking as applied.`);
      await updateClient.query(`UPDATE dune.bot_delivery_receipts SET status = 'SUCCESS' WHERE request_id = $1`, [row.request_id]);
      await updateClient.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
    } else if (outcome === 'UNCERTAIN') {
      console.warn(`Item command was published but inventory verification did not confirm delivery ${row.id}. Locking it as UNCERTAIN to prevent a duplicate grant.`);
      await updateClient.query(`UPDATE dune.bot_delivery_receipts SET status = 'UNCERTAIN' WHERE request_id = $1`, [row.request_id]);
      await updateClient.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
    } else {
      console.error(`Failed to drop item for delivery ID ${row.id} (Player might be offline?):`, result.error || result.stderr || result.stdout);
      console.log(`Removing PENDING receipt to allow retry queueing for delivery ID ${row.id}.`);
      await updateClient.query(`DELETE FROM dune.bot_delivery_receipts WHERE request_id = $1`, [row.request_id]);
      await updateClient.query(`UPDATE dune.bot_pending_deliveries SET locked_at = NULL WHERE id = $1`, [row.id]);
    }
  } catch (err) {
    console.error("Error updating delivery status:", err);
  } finally {
    updateClient.release();
  }
}

async function processDelivery(row) {
  // Wait 60 seconds from the time the delivery was created so players can load in
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  const delayMs = Math.max(0, 60000 - ageMs);

  if (delayMs > 0) {
    console.log(`Delaying delivery processing by ${Math.round(delayMs / 1000)} seconds to accommodate loading screens...`);
    setTimeout(() => checkPendingDeliveries(), delayMs);
  } else {
    checkPendingDeliveries();
  }
}

async function checkPendingDeliveries() {
  if (isProcessing) return;
  isProcessing = true;

  const client = await pool.connect();
  try {
    // Check if the daemon is enabled in the configuration
    const configRes = await client.query(`SELECT config_value FROM dune.discord_bot_config WHERE config_key = 'airdrop_multipliers'`);
    if (configRes.rows.length > 0) {
      const config = configRes.rows[0].config_value;
      if (config.daemon_enabled === false) {
        return; // Daemon is disabled, skip processing
      }
    }

    while (true) {
      const res = await client.query(`
        WITH claim AS (
          SELECT id FROM dune.bot_pending_deliveries 
          WHERE is_applied = false 
            AND created_at < NOW() - INTERVAL '60 seconds'
            AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '300 seconds')
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE dune.bot_pending_deliveries 
        SET locked_at = NOW() 
        FROM claim 
        WHERE dune.bot_pending_deliveries.id = claim.id 
        RETURNING dune.bot_pending_deliveries.*;
      `);
      
      if (res.rows.length === 0) {
        break; // No more pending deliveries to claim
      }
      
      await executeDelivery(res.rows[0]);
    }
  } catch (err) {
    console.error("Error checking for pending deliveries:", err);
  } finally {
    client.release();
    isProcessing = false;
  }
}

async function start() {
  console.log("Starting Dune Airdrop Node.js Delivery Daemon...");
  console.log("Attempting to connect to database at", databaseConfig.display, "...");
  
  let client;
  try {
    client = await pool.connect();
    console.log("Connected to database successfully!");
  } catch (err) {
    console.error("CRITICAL: Failed to connect to database!", err.message);
    process.exit(1);
  }

  // Catch up on boot and start the retry loop every 30 seconds
  console.log("Starting pending delivery retry loop...");
  checkPendingDeliveries();
  setInterval(checkPendingDeliveries, 30000);

  // Subscribe to the new_airdrop channel
  await client.query('LISTEN new_airdrop');
  console.log("Listening for real-time airdrop events via Postgres Pub/Sub...");

  // Handle incoming notifications
  client.on('notification', async (msg) => {
    try {
      const delivery = JSON.parse(msg.payload);
      console.log("\n--- Real-Time Airdrop Event Received! ---");
      await processDelivery(delivery);
    } catch (err) {
      console.error("Error parsing or processing notification:", err);
    }
  });

  // Keep the connection alive and handle disconnects
  client.on('error', (err) => {
    console.error("Fatal database connection error:", err.message);
    process.exit(1);
  });

  // Start the heartbeat loop every 15 seconds
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

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export {
  executeDelivery,
  checkPendingDeliveries,
  pool,
  isProcessing
};
