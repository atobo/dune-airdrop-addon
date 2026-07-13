import pg from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Automatically find the password from the server's .env file!
let dbPassword = "dune";
try {
  const envPath = path.resolve(process.env.HOME, 'dune-awakening-selfhost-docker/.env');
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

async function runCommand(cmd) {
  try {
    const { stdout, stderr } = await execAsync(cmd);
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
  const cmd = `~/dune-awakening-selfhost-docker/runtime/scripts/dune admin grant-item-id ${playerId} ${itemId} ${quantity} 1 ${quality}`;
  console.log(`Executing RCON: ${cmd}`);
  
  const result = await runCommand(cmd);
  
  const client = await pool.connect();
  try {
    if (result.ok) {
      console.log(`Successfully dropped item! Marking as applied.`);
      await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
    } else {
      console.error(`Failed to drop item for delivery ID ${row.id}:`, result.error || result.stderr || result.stdout);
      await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
    }
  } catch (err) {
    console.error("Error updating delivery status:", err);
  } finally {
    client.release();
  }
}

async function processDelivery(row) {
  // Wait 30 seconds from the time the delivery was created so players can load in
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  const delayMs = Math.max(0, 30000 - ageMs);

  if (delayMs > 0) {
    console.log(`Delaying delivery ID ${row.id} by ${Math.round(delayMs / 1000)} seconds to accommodate loading screens...`);
    setTimeout(() => executeDelivery(row), delayMs);
  } else {
    executeDelivery(row);
  }
}

async function start() {
  console.log("Starting Dune Airdrop Node.js Delivery Daemon...");
  console.log("Attempting to connect to database at", DB_URL, "...");
  
  let client;
  try {
    client = await pool.connect();
    console.log("Connected to database successfully!");
  } catch (err) {
    console.error("CRITICAL: Failed to connect to database!", err.message);
    process.exit(1);
  }

  // Catch up on any pending deliveries that were missed while the daemon was offline
  try {
    console.log("Checking for pending deliveries...");
    const res = await client.query('SELECT * FROM dune.bot_pending_deliveries WHERE is_applied = false');
    if (res.rows.length > 0) {
      console.log(`Found ${res.rows.length} pending deliveries. Processing...`);
      for (const row of res.rows) {
        await processDelivery(row);
      }
    } else {
      console.log("No pending deliveries found.");
    }
  } catch (err) {
    console.error("Error checking for pending deliveries:", err);
  }

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
