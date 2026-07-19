import { test, before } from 'node:test';
import assert from 'node:assert';
import { executeDelivery, checkPendingDeliveries, pool } from './index.js';

before(async () => {
  const client = await pool.connect();
  try {
    // Run minimal schema setup so the test works on a completely fresh local database
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS dune;
      CREATE TABLE IF NOT EXISTS dune.bot_pending_deliveries (
        id SERIAL PRIMARY KEY,
        request_id UUID DEFAULT gen_random_uuid() UNIQUE,
        account_id BIGINT NOT NULL,
        template_id TEXT NOT NULL,
        stack_size INT NOT NULL,
        quality_level INT DEFAULT 0,
        is_applied BOOLEAN DEFAULT false,
        locked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dune.bot_delivery_receipts (
        request_id UUID PRIMARY KEY,
        account_id BIGINT NOT NULL,
        template_id TEXT NOT NULL,
        quantity INT NOT NULL,
        status TEXT DEFAULT 'SUCCESS',
        granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dune.discord_bot_config (
        config_key TEXT PRIMARY KEY,
        config_value JSONB
      );
      INSERT INTO dune.discord_bot_config (config_key, config_value) 
      VALUES ('airdrop_multipliers', '{"daemon_enabled": true}') 
      ON CONFLICT DO NOTHING;
    `);
  } finally {
    client.release();
  }
});

test('Daemon Idempotency & Sequential Execution', async (t) => {
  const client = await pool.connect();

  try {
    // 1. Insert a mock pending delivery that mimics a 60-second old event
    const deliveryRes = await client.query(`
      INSERT INTO dune.bot_pending_deliveries (account_id, template_id, stack_size, quality_level, created_at)
      VALUES (8888, 'IdempotentTestItem', 1, 0, NOW() - INTERVAL '65 seconds')
      RETURNING *
    `);
    
    // The Postgres trigger automatically sets locked_at = NOW(), so we must explicitly clear it
    await client.query(`UPDATE dune.bot_pending_deliveries SET locked_at = NULL WHERE id = $1`, [deliveryRes.rows[0].id]);
    
    const delivery = deliveryRes.rows[0];

    // 2. Insert a receipt manually with status 'PENDING' simulating a crashed daemon during execution boundary
    await client.query(`
      INSERT INTO dune.bot_delivery_receipts (request_id, account_id, template_id, quantity, status)
      VALUES ($1, $2, $3, $4, 'PENDING')
    `, [delivery.request_id, delivery.account_id, delivery.template_id, delivery.stack_size]);

    // 3. Execute checkPendingDeliveries
    // It should pick up the delivery, see the PENDING receipt, transition to UNCERTAIN, and mark applied.
    await checkPendingDeliveries();

    // 4. Verify it was marked applied
    const verifyRes = await client.query(`
      SELECT is_applied FROM dune.bot_pending_deliveries WHERE id = $1
    `, [delivery.id]);

    assert.strictEqual(verifyRes.rows[0].is_applied, true, "Delivery should be marked applied because of the uncertain state");
    
    // 5. Verify the receipt was locked to UNCERTAIN
    const receiptRes = await client.query(`
      SELECT status FROM dune.bot_delivery_receipts WHERE request_id = $1
    `, [delivery.request_id]);
    
    assert.strictEqual(receiptRes.rows[0].status, 'UNCERTAIN', "Receipt status should transition from PENDING to UNCERTAIN");

  } finally {
    // Cleanup
    await client.query(`DELETE FROM dune.bot_pending_deliveries WHERE account_id = 8888`);
    await client.query(`DELETE FROM dune.bot_delivery_receipts WHERE account_id = 8888`);
    client.release();
    pool.end();
  }
});
