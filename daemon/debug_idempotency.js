import { executeDelivery, checkPendingDeliveries, pool } from './index.js';

async function run() {
  const client = await pool.connect();
  try {
    const deliveryRes = await client.query(`
      INSERT INTO dune.bot_pending_deliveries (account_id, template_id, stack_size, quality_level, created_at, locked_at)
      VALUES (9999, 'IdempotentTestItem', 1, 0, NOW() - INTERVAL '65 seconds', NULL)
      RETURNING *
    `);
    const delivery = deliveryRes.rows[0];

    await client.query(`
      INSERT INTO dune.bot_delivery_receipts (request_id, account_id, template_id, quantity, status)
      VALUES ($1, $2, $3, $4, 'PENDING')
    `, [delivery.request_id, delivery.account_id, delivery.template_id, delivery.stack_size]);

    await checkPendingDeliveries();

  } finally {
    client.release();
    pool.end();
  }
}
run();
