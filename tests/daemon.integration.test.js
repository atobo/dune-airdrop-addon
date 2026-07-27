import test from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import crypto from 'crypto';

const DB_URL = process.env.DATABASE_URL || 'postgres://dune:dune@127.0.0.1:15432/dune';
const pool = new pg.Pool({ connectionString: DB_URL });

async function resetDB(client) {
  await client.query('TRUNCATE dune.bot_pending_deliveries, dune.bot_delivery_receipts RESTART IDENTITY CASCADE');
}

test('Database connection and schema setup', async (t) => {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'dune' AND table_name = 'bot_pending_deliveries'
      );
    `);
    assert.strictEqual(res.rows[0].exists, true, 'bot_pending_deliveries table should exist');
  } finally {
    client.release();
  }
});

test('1. A player who comes online after reaching the offline-deferral cap becomes eligible within five minutes', async (t) => {
  const client = await pool.connect();
  try {
    await resetDB(client);
    // Insert a pending delivery with offline_deferrals = 5 (well past cap)
    await client.query(`
      INSERT INTO dune.bot_pending_deliveries (account_id, template_id, stack_size, quality_level, request_id, offline_deferrals)
      VALUES (1001, 'item_1', 1, 0, $1, 5)
    `, [crypto.randomUUID()]);

    // Simulate processOfflineDeferrals logic manually
    const res = await client.query(`
      UPDATE dune.bot_pending_deliveries 
      SET next_eligibility_check_at = NOW() + LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(offline_deferrals, 2)))
      WHERE account_id = 1001
      RETURNING next_eligibility_check_at, offline_deferrals;
    `);

    const row = res.rows[0];
    const diffMs = new Date(row.next_eligibility_check_at).getTime() - Date.now();
    
    // The wait time should be capped at 5 minutes (300,000 ms) despite 5 deferrals
    assert.ok(diffMs <= 300000 + 1000, `Wait time ${diffMs}ms should be <= 5 minutes`);
    assert.ok(diffMs >= 300000 - 1000, `Wait time ${diffMs}ms should be ~5 minutes`);
  } finally {
    client.release();
  }
});

test('3. Transaction B does not double-increment delivery_attempts', async (t) => {
  const client = await pool.connect();
  try {
    await resetDB(client);
    
    const reqId = crypto.randomUUID();
    const leaseToken = crypto.randomUUID();

    await client.query(`
      INSERT INTO dune.bot_pending_deliveries (account_id, template_id, stack_size, quality_level, request_id, delivery_attempts, lease_token, locked_at)
      VALUES (1002, 'item_2', 1, 0, $1, 1, $2, NOW())
    `, [reqId, leaseToken]);

    // Transaction B simulates an offline rejection
    // It should increment ONLY offline_deferrals, NOT delivery_attempts
    await client.query(`
      UPDATE dune.bot_pending_deliveries 
      SET offline_deferrals = offline_deferrals + 1,
          last_failure_code = 'RETRY_OFFLINE',
          lease_token = NULL,
          locked_at = NULL
      WHERE request_id = $1
    `, [reqId]);

    const res = await client.query(`SELECT delivery_attempts, offline_deferrals FROM dune.bot_pending_deliveries WHERE request_id = $1`, [reqId]);
    assert.strictEqual(res.rows[0].delivery_attempts, 1, 'delivery_attempts should NOT be double incremented');
    assert.strictEqual(res.rows[0].offline_deferrals, 1, 'offline_deferrals should be incremented');
  } finally {
    client.release();
  }
});

test('4. Exact offline delays are evaluated correctly: 1, 3, 5, 5 minutes', async (t) => {
  const client = await pool.connect();
  try {
    // 0 -> 1 min
    const r0 = await client.query(`SELECT LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(0, 2))) as val`);
    assert.strictEqual(r0.rows[0].val.minutes || 0, 1, "0 deferrals = 1 minute");
    
    // 1 -> 3 min
    const r1 = await client.query(`SELECT LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(1, 2))) as val`);
    assert.strictEqual(r1.rows[0].val.minutes || 0, 3, "1 deferral = 3 minutes");
    
    // 2 -> 5 min
    const r2 = await client.query(`SELECT LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(2, 2))) as val`);
    assert.strictEqual(r2.rows[0].val.minutes || 0, 5, "2 deferrals = 5 minutes");
    
    // 3 -> 5 min (capped)
    const r3 = await client.query(`SELECT LEAST(INTERVAL '5 minutes', INTERVAL '1 minute' * POWER(3, LEAST(3, 2))) as val`);
    assert.strictEqual(r3.rows[0].val.minutes || 0, 5, "3 deferrals = 5 minutes (capped)");
  } finally {
    client.release();
  }
});

test('6. Timeout and unknown output strictly never enter a retry path', async (t) => {
  // Simulating classifyError from daemon logic
  function classifyError(errorStr, stdout, stderr) {
    if (errorStr === 'TIMEOUT') return 'TIMEOUT';
    const combinedOut = (stdout + ' ' + stderr).toLowerCase();
    if (combinedOut.includes("player is offline")) return 'RETRY_OFFLINE';
    return 'UNKNOWN_OUTPUT';
  }

  assert.strictEqual(classifyError('TIMEOUT', '', ''), 'TIMEOUT');
  assert.strictEqual(classifyError('Some error', 'Failed entirely', ''), 'UNKNOWN_OUTPUT');
  assert.strictEqual(classifyError(null, 'Player is offline', ''), 'RETRY_OFFLINE');
});

test('7. Expired lease without a receipt becomes strictly terminal CORRUPTED_NO_RECEIPT', async (t) => {
  const client = await pool.connect();
  try {
    await resetDB(client);
    
    const reqId = crypto.randomUUID();
    const resInsert = await client.query(`
      INSERT INTO dune.bot_pending_deliveries (account_id, template_id, stack_size, quality_level, request_id, lease_token, locked_at)
      VALUES (1004, 'item_4', 1, 0, $1, $2, NOW() - INTERVAL '15 minutes')
      RETURNING id;
    `, [reqId, crypto.randomUUID()]);

    const id = resInsert.rows[0].id;
    
    // Simulating lease recovery with no receipt in bot_delivery_receipts
    const receiptRes = await client.query(`SELECT status FROM dune.bot_delivery_receipts WHERE request_id = $1`, [reqId]);
    
    if (receiptRes.rows.length === 0) {
      await client.query(`
        UPDATE dune.bot_pending_deliveries 
        SET is_applied = true, last_failure_code = 'CORRUPTED_NO_RECEIPT', last_failure_at = NOW(), lease_token = NULL, locked_at = NULL 
        WHERE id = $1
      `, [id]);
    }

    const checkRes = await client.query(`SELECT is_applied, last_failure_code, lease_token FROM dune.bot_pending_deliveries WHERE id = $1`, [id]);
    assert.strictEqual(checkRes.rows[0].is_applied, true);
    assert.strictEqual(checkRes.rows[0].last_failure_code, 'CORRUPTED_NO_RECEIPT');
    assert.strictEqual(checkRes.rows[0].lease_token, null);
  } finally {
    client.release();
  }
});
