import { test } from 'node:test';
import assert from 'node:assert';
import { executeDelivery, checkPendingDeliveries, pool } from './index.js';

test('Daemon Idempotency & Sequential Execution', async (t) => {
  const client = await pool.connect();

  try {
    // 1. Insert a mock pending delivery that mimics a 60-second old event
    const deliveryRes = await client.query(`
      INSERT INTO dune.bot_pending_deliveries (account_id, template_id, stack_size, quality_level, created_at, locked_at)
      VALUES (8888, 'IdempotentTestItem', 1, 0, NOW() - INTERVAL '65 seconds', NULL)
      RETURNING *
    `);
    const delivery = deliveryRes.rows[0];

    // 2. Insert a receipt manually simulating a crashed daemon after command completion
    await client.query(`
      INSERT INTO dune.bot_delivery_receipts (request_id, account_id, template_id, quantity)
      VALUES ($1, $2, $3, $4)
    `, [delivery.request_id, delivery.account_id, delivery.template_id, delivery.stack_size]);

    // 3. Execute checkPendingDeliveries
    // It should pick up the delivery, see the receipt, mark it applied, and NOT run the native CLI
    await checkPendingDeliveries();

    // 4. Verify it was marked applied
    const verifyRes = await client.query(`
      SELECT is_applied FROM dune.bot_pending_deliveries WHERE id = $1
    `, [delivery.id]);

    assert.strictEqual(verifyRes.rows[0].is_applied, true, "Delivery should be marked applied because of the receipt");

  } finally {
    // Cleanup
    await client.query(`DELETE FROM dune.bot_pending_deliveries WHERE account_id = 8888`);
    await client.query(`DELETE FROM dune.bot_delivery_receipts WHERE account_id = 8888`);
    client.release();
    pool.end();
  }
});
