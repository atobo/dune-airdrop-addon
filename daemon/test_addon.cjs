const pg = require('pg');
const fs = require('fs');

const DB_URL = process.env.DATABASE_URL || "postgres://dune:dune@127.0.0.1:15432/dune";
const pool = new pg.Pool({ connectionString: DB_URL });

async function runTests() {
  const client = await pool.connect();
  try {
    console.log("Running addon tests...");
    
    // 1. Test duplicate event behavior
    console.log("Testing duplicate daily event prevention...");
    await client.query("UPDATE dune_airdrop.active_playtime SET last_login_date = CURRENT_DATE - INTERVAL '2 days' WHERE character_id = 123");
    
    // Trigger the function twice
    await client.query("SELECT dune_airdrop.fn_check_daily_weekly_rewards_v2(1, 123)");
    await client.query("SELECT dune_airdrop.fn_check_daily_weekly_rewards_v2(1, 123)");
    
    const countRes = await client.query("SELECT COUNT(*) as c FROM dune_airdrop.pending_deliveries WHERE account_id = 1");
    console.log(`Pending deliveries created for daily (should be 1 if only daily enabled): ${countRes.rows[0].c}`);
    
    // 2. Test manual spawn helper with valid and invalid params
    console.log("Testing fn_manual_airdrop_spawn...");
    try {
      await client.query("SELECT dune_airdrop.fn_manual_airdrop_spawn(999, 'TestItem', -1)");
      console.log("FAILED: Expected error for negative qty");
    } catch (e) {
      console.log("PASS: Negative qty rejected.");
    }

    try {
      await client.query("SELECT dune_airdrop.fn_manual_airdrop_spawn(999, '', 1)");
      console.log("FAILED: Expected error for empty template");
    } catch (e) {
      console.log("PASS: Empty template rejected.");
    }
    
    console.log("Tests complete.");
  } catch(err) {
    console.error("Test error:", err);
  } finally {
    client.release();
    pool.end();
  }
}

runTests();
