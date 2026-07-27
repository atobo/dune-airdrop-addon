const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const setupSql = fs.readFileSync(path.join(root, 'setup_playtime_airdrops.sql'), 'utf8');
const uninstallSql = fs.readFileSync(path.join(root, 'uninstall_playtime_airdrops.sql'), 'utf8');

test('setup owns addon objects through the dune role and isolated schema', () => {
  assert.match(setupSql, /CREATE SCHEMA IF NOT EXISTS dune_airdrop AUTHORIZATION dune;/);
  assert.match(setupSql, /SET ROLE dune;/);
  assert.match(setupSql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(setupSql, /RESET ROLE;\s*$/);
  assert.doesNotMatch(setupSql, /CREATE (?:OR REPLACE )?(?:TABLE|FUNCTION) dune\.airdrop_/i);
  assert.match(setupSql, /CREATE TABLE IF NOT EXISTS dune_airdrop\.config/);
  assert.match(setupSql, /CREATE OR REPLACE FUNCTION dune_airdrop\.trg_track_playtime_v2/);
  assert.match(setupSql, /EXCEPTION WHEN OTHERS THEN\s+-- A rewards failure must never reject the game's player-state update\.\s+RETURN NEW;/);
});

test('setup migrates legacy data once without altering legacy ownership', () => {
  assert.match(setupSql, /to_regclass\('dune\.airdrop_config'\)/);
  assert.match(setupSql, /legacy_v136_migrated/);
  assert.doesNotMatch(setupSql, /ALTER (?:TABLE|FUNCTION|SCHEMA) dune\.airdrop_/i);
  assert.doesNotMatch(setupSql, /DROP (?:TABLE|FUNCTION) IF EXISTS dune\.airdrop_/i);
});

test('uninstall removes only the isolated addon schema and game trigger', () => {
  assert.match(uninstallSql, /DROP TRIGGER IF EXISTS trg_player_state_playtime ON dune\.encrypted_player_state/);
  assert.match(uninstallSql, /DROP SCHEMA IF EXISTS dune_airdrop CASCADE/);
  assert.doesNotMatch(uninstallSql, /DROP (?:TABLE|FUNCTION) IF EXISTS dune\.airdrop_/i);
});
