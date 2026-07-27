import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatabaseConfig, parseEnvFile } from './databaseConfig.js';

test('database config honors custom host port and quoted passwords', () => {
  const fileValues = parseEnvFile(`
    POSTGRES_PORT=16432
    DUNE_DB_PASSWORD="pa:ss@word"
  `);
  const config = buildDatabaseConfig({}, fileValues);
  assert.equal(config.pool.port, 16432);
  assert.equal(config.pool.password, 'pa:ss@word');
  assert.equal(config.display, 'dune@127.0.0.1:16432/dune');
});

test('database URL remains an explicit highest-priority override', () => {
  const config = buildDatabaseConfig({ DATABASE_URL: 'postgres://example.invalid/dune' }, {});
  assert.equal(config.pool.connectionString, 'postgres://example.invalid/dune');
  assert.equal(config.display, 'DATABASE_URL');
});

test('invalid custom database ports are rejected', () => {
  assert.throws(() => buildDatabaseConfig({}, { POSTGRES_PORT: '70000' }), /valid TCP port/);
});
