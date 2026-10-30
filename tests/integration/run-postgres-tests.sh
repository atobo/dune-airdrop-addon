#!/usr/bin/env bash
set -euo pipefail
test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$test_dir/../.." && pwd)"
compose=(sudo -n docker compose -f "$test_dir/docker-compose.yml")
"${compose[@]}" up -d --wait
trap '"${compose[@]}" down -v' EXIT
export AIRDROP_TEST_DATABASE_URL='postgresql://airdrop_test:airdrop_test_only@127.0.0.1:55439/dune_airdrop_integration_test'
node "$test_dir/run-postgres-tests.mjs"
