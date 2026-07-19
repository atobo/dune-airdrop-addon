const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('manifest and package versions stay aligned', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'addon.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.version, packageJson.version);
});

test('daemon declares its runtime PostgreSQL dependency', () => {
  const daemonPackage = JSON.parse(fs.readFileSync(path.join(root, 'daemon/package.json'), 'utf8'));
  assert.match(daemonPackage.dependencies.pg, /^\^8\./);
  assert.ok(fs.existsSync(path.join(root, 'daemon/package-lock.json')));
});

test('reward minimum is bounded and guarded against an endless loop', () => {
  const sql = fs.readFileSync(path.join(root, 'setup_playtime_airdrops.sql'), 'utf8');
  assert.match(sql, /v_min_drops := LEAST\(4, GREATEST\(0,/);
  assert.match(sql, /v_minimum_attempts < 32/);
});

test('uninstall removes current v2 functions and dedicated addon state', () => {
  const sql = fs.readFileSync(path.join(root, 'uninstall_playtime_airdrops.sql'), 'utf8');
  assert.match(sql, /DROP FUNCTION IF EXISTS dune\.trg_track_playtime_v2\(\)/);
  assert.match(sql, /DROP TABLE IF EXISTS dune\.airdrop_delivery_receipts/);
  assert.match(sql, /DROP TABLE IF EXISTS dune\.airdrop_config/);
});

test('addon database objects use only the dedicated airdrop namespace', () => {
  const files = [
    'setup_playtime_airdrops.sql',
    'uninstall_playtime_airdrops.sql',
    'web/addon.js',
    'daemon/index.js'
  ];
  for (const relativePath of files) {
    const contents = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(contents, /dune\.[a-z]+_bot_config/i, relativePath);
    assert.doesNotMatch(contents, /dune\.bot_(?:active|pending|delivery)/, relativePath);
  }
});
