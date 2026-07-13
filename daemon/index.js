import pg from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// The connection to the local database container
const DB_URL = process.env.DATABASE_URL || 'postgres://dune:dune@127.0.0.1:15432/dune';

const pool = new pg.Pool({
  connectionString: DB_URL,
});

async function runCommand(cmd) {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
  }
}

async function processDeliveries() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT id, account_id, template_id, stack_size, quality_level
      FROM dune.bot_pending_deliveries
      WHERE is_applied = false
      ORDER BY created_at ASC
    `);

    for (const row of res.rows) {
      console.log(`Processing delivery ID ${row.id} for account ${row.account_id}: ${row.stack_size}x ${row.template_id} (Quality: ${row.quality_level})`);
      
      const playerId = row.account_id;
      const itemId = row.template_id;
      const quantity = row.stack_size;
      const quality = row.quality_level || 0;
      
      // Execute the native dune CLI command to trigger the RCON item spawn exactly like Redblink does
      // We use an absolute path to avoid symlink issues with relative paths
      const cmd = `~/dune-awakening-selfhost-docker/dune admin grant-item-id ${playerId} ${itemId} ${quantity} 1 ${quality}`;
      console.log(`Executing: ${cmd}`);
      
      const result = await runCommand(cmd);
      
      if (result.ok) {
        console.log(`Successfully instantly dropped item! Marking as applied.`);
        await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
      } else {
        console.error(`Failed to drop item for delivery ID ${row.id}:`, result.error || result.stderr || result.stdout);
        // We still mark it as applied so it doesn't infinite loop and block the queue
        await client.query(`UPDATE dune.bot_pending_deliveries SET is_applied = true WHERE id = $1`, [row.id]);
      }
    }
  } catch (err) {
    console.error("Error processing deliveries:", err);
  } finally {
    client.release();
  }
}

async function start() {
  console.log("Starting Dune Airdrop Node.js Delivery Daemon...");
  console.log("Monitoring the database for pending instant drops...");
  setInterval(processDeliveries, 10000); // Check every 10 seconds
  processDeliveries();
}

start();
