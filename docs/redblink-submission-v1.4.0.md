# RedBlink submission: Dune Airdrop Addon v1.4.0

## Summary

v1.4.0 hardens reward delivery and upgrades existing installations in place.
It adds persistent delivery states and receipts, offline-player deferral,
FLS-ID-first player resolution, historical-reward review, and conservative
handling of ambiguous delivery outcomes.

## Compatibility and upgrade precautions

- Existing queues, receipts, configuration, loot tables, activity progress,
  login streaks, and playtime are retained by the additive migration.
- Representative v1.3.6 and v1.3.7 historical schema fixtures were migrated
  and rerun successfully. v1.3.4 and v1.3.5 were not verified.
- Administrators must back up the database, stop the daemon, run schema setup
  with the battlegroup stopped, and retain the backup until post-upgrade review
  is complete.
- Historical undelivered rewards are intentionally held for individual review;
  uncertain rewards are never replayed automatically.

## Required permissions

- `database:read` and `database:write` are required.
- `admin:grant-items` is separately approved and only needed for the UI manual
  grant feature. The daemon does not inherit it.

## Safety and test evidence

- Tested real Chromium iframe bridge → actual isolated console API handler →
  real SQL policy → disposable PostgreSQL.
- Passed historical approval, duplicate prevention, `UNCERTAIN` protection,
  permission denial, controlled database failure, bridge failure, and a
  2,000-record dashboard workflow.
- Passed unit/UI tests, migration rerun fixtures, daemon crash/lease recovery,
  and concurrent-worker tests.
- Release ZIP excludes Playwright, Chromium, `node_modules`, tests, temporary
  hooks, and test Docker infrastructure.

## Release artifact

- Version: `1.4.0`
- Attach the locally built `dune-airdrop-addon-1.4.0.zip` and its matching
  SHA-256 sidecar from `dist/`.

This document is submission material only; it is not included in the release
ZIP.
