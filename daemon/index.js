import pg from 'pg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

// Resolve the root of the Dune Docker Console by going up from this installed addon's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const duneDockerRoot = path.resolve(__dirname, '../../../../..');

// Automatically find the password from the server's .env file!
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
  connectionTimeoutMillis: 2000, // Fail fast if the DB is unreachable
});

async function runCommand(executable, args) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args);
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
  }
}

async function executeDelivery(row) {

  console.log(`Executing delivery ID ${row.id} for account ${row.account_id}: ${row.stack_size}x ${row.template_id} (Quality: ${row.quality_level})`);
  
  const playerId = row.account_id;
  const itemId = row.template_id;
  const quantity = row.stack_size;
  const quality = row.quality_level || 0;
  
  // Execute the native dune CLI command to trigger the RCON item spawn exactly like Redblink does
  const executable = path.resolve(duneDockerRoot, 'runtime/scripts/dune');
  const args = ['admin', 'grant-item-id', String(playerId), String(itemId), String(quantity), '1', String(quality)];
  
  console.log(`Executing RCON: ${executable} ${args.join(' ')}`);
  
  const result = await runCommand(executable, args);
  
  const client = await pool.connect();
  try {
    if (result.ok) {
      console.log(`Successfully dropped item! Marking as applied.`);
      await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
    } else {
      console.error(`Failed to drop item for delivery ID ${row.id} (Player might be offline?):`, result.error || result.stderr || result.stdout);
      console.log(`Keeping delivery ID ${row.id} in the queue to retry later.`);
    }
  } catch (err) {
    console.error("Error updating delivery status:", err);
  } finally {
    client.release();
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
  const client = await pool.connect();
  try {
    while (true) {
      const res = await client.query(`
        WITH claim AS (
          SELECT id FROM dune.bot_pending_deliveries 
          WHERE is_applied = false 
            AND created_at < NOW() - INTERVAL '60 seconds'
            AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
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
  }
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
}

start();
