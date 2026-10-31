# RedBlink submission: Dune Airdrop Addon v1.4.2

## Summary

v1.4.2 repairs two installed-Console release blockers discovered during the
v1.4.1 review. The packaged entry is now self-contained: CSS, bridge code, UI
code, and schema SQL are bundled into `web/index.html`.

## Console compatibility

- The entry no longer depends on separately authenticated CSS or JavaScript
  requests from the opaque-origin addon iframe.
- **INIT SCHEMA** no longer fetches `setup_playtime_airdrops.sql`. It uses the
  embedded, byte-for-byte schema string and submits it through the existing
  `database.execute` bridge action.
- The package does not add direct network or database access; its requested
  permissions are unchanged.

## Verification

- The installed-environment regression starts the self-contained entry with
  external fetching blocked, verifies the bridge loads, and confirms **INIT
  SCHEMA** submits the exact schema SQL through a mocked database bridge.
- The standard unit, migration, UI, daemon, package-safety, and release-package
  checks pass.
- The release ZIP excludes tests, browser tooling, `node_modules`, development
  sources, and temporary test infrastructure.

## Upgrade precautions

Back up the database, stop the daemon, install the ZIP, then run **INIT
SCHEMA** with the battlegroup stopped before starting the matching daemon. The
schema migration remains additive and preserves queues, receipts, activity,
streaks, playtime, settings, and custom loot tables.

## Release artifact

- Version: `1.4.2`
- Attach `dune-airdrop-addon-1.4.2.zip` and its matching SHA-256 sidecar from
  `dist/` to the GitHub release.

This document is submission material only; it is not included in the release
ZIP.
