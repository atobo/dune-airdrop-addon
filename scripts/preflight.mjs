// Read-only preflight. It deliberately cannot run the migration.
import pg from "../daemon/node_modules/pg/lib/index.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required; this preflight does not read a production .env file.");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  const { rows } = await client.query(`SELECT to_regclass('dune_airdrop.pending_deliveries') AS queue,
    to_regclass('dune_airdrop.config') AS config, to_regclass('dune.player_state') AS players`);
  if (!rows[0].queue || !rows[0].config || !rows[0].players) throw new Error("Required existing addon or console tables are missing; migration was not run.");
  console.log("Preflight passed: required tables are present. No database changes were made.");
} finally { await client.end().catch(() => {}); }
