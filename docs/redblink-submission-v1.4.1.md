# RedBlink submission: Dune Airdrop Addon v1.4.1

## Summary

v1.4.1 is the release candidate following v1.4.0 delivery-lifecycle work. It
adds administrator-visible delivery history and safe queue-resolution actions,
aligns the console bridge with the current addon template, and makes the
non-root companion daemon's Docker-socket group requirement explicit. It also
corrects twelve reviewed default loot-pool classifications.

## Compatibility and upgrade precautions

- The upgrade is additive. Existing queues, receipts, configuration, loot
  tables, activity progress, login streaks, and playtime are retained.
- Stop the daemon, back up the Dune database, install the ZIP, then run **INIT
  SCHEMA** with the battlegroup stopped before starting the matching daemon.
- v1.4.1 adds queue-resolution fields and an index without deleting data. The
  reviewed loot correction updates only its named default entries; custom loot
  configurations are not reset.
- Representative v1.3.6 and v1.3.7 historical schema fixtures were migrated
  and rerun successfully. v1.3.4 and v1.3.5 were not verified.
- Historical undelivered rewards require individual review. `UNCERTAIN`
  rewards are never replayed automatically.

## Required permissions

- `database:read` and `database:write` are required.
- `admin:grant-items` is separately approved and is only required for the UI
  manual-grant feature. The companion daemon does not inherit it.

## Safety and testing evidence

- Isolated Chromium iframe bridge, real console handler and policy checks, and
  disposable PostgreSQL workflows were exercised for approval, duplicate
  prevention, `UNCERTAIN` protection, permission denial, database failure,
  bridge failure, and a 2,000-record dashboard workflow.
- Unit/UI, migration-rerun, daemon crash/lease-recovery, and concurrent-worker
  tests passed.
- The release ZIP excludes Playwright, Chromium, `node_modules`, tests,
  temporary hooks, and test Docker infrastructure.

## Release artifact

- Version: `1.4.1`
- Attach `dune-airdrop-addon-1.4.1.zip` and its matching SHA-256 sidecar from
  `dist/` to the GitHub release.

This document is submission material only; it is not included in the release
ZIP.
