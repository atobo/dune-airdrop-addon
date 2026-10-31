# Safe upgrade and recovery

Version 1.4.2 of the delivery lifecycle is an in-place, additive upgrade. It does
not delete queues, receipts, settings, loot tables, activity records, streaks,
or playtime.

## Before upgrading

1. Create a normal Dune database backup.
2. Record the current queue and receipt counts.
3. Stop the companion daemon before applying the schema upgrade. Do not clear
   queue rows or reset the addon configuration.
4. Apply `setup_playtime_airdrops.sql` once through the addon only while the
   battlegroup is stopped, then start a daemon built from the same release.
5. Keep the backup until queue, receipt, settings, and activity counts have
   been reviewed after the upgrade.

## Preflight

Before migration, verify that the addon has `database:read` and `database:write`
approved, that `dune.player_state`, `dune.actors`, and `dune.accounts` exist,
and that the daemon's non-root UID can write the command-history destination.
Review unresolved player identities and pending/uncertain receipts first. Do
not approve a historical delivery unless independent evidence shows it was not
already granted.

## Migration behaviour

The migration adds delivery state, attempts, retry scheduling, timestamps, a
recovery-approval flag, and an append-only delivery event table. Existing row
IDs and request IDs are retained.

- Historical `SUCCESS` receipts become `DELIVERED`.
- Historical `PENDING` and `UNCERTAIN` receipts become `UNCERTAIN`; they are
  never retried automatically.
- Existing undelivered queue rows become `WAITING_FOR_PLAYER` and require an
  explicit recovery approval before a daemon can issue a command.
- Historical applied rows without a confirmed receipt become `LEGACY_REVIEW`.

This conservative mapping prevents a daemon restart from turning an ambiguous
historic command into a duplicate reward.

## Supported historical evidence and limitations

The v1.4.0 delivery-state migration was exercised against representative historical schema
fixtures for the v1.3.6 and v1.3.7 layouts, including pending rewards,
delivered and pending receipts, custom configuration, loot tables, playtime,
login streaks, and weekly progress. Initial migration and a rerun preserved
those records.

v1.3.4 and v1.3.5 layouts were **not** verified. An installation that predates
v1.3.6, or whose schema has been manually modified, must be treated as an
unsupported historical shape: take a verified backup, inspect the schema and
record counts, and do not proceed if the migration reports an unexpected
structure. Preserve unmappable records for administrator review; do not delete
or recreate them to force an upgrade.

## v1.4.1 notes

v1.4.1 adds additive resolution fields and dispatch indexing for queue review;
run **INIT SCHEMA** after installing it, with the daemon stopped as described
above. It also corrects the default loot-pool classification for a small set of
reviewed resource and component entries. The setup script updates only those
named default entries and does not clear custom loot tables, queue rows,
receipts, activity, streaks, or settings.

## v1.4.2 notes

v1.4.2 packages the Console entry as a self-contained document. Its styles,
bridge code, UI code, and schema SQL travel inside `web/index.html`, avoiding
blocked authenticated asset loads and the installed addon's `connect-src
'none'` policy. **INIT SCHEMA** still sends the same SQL through the approved
database bridge; it does not gain direct database or network access.

## Recovery

Recovery is an administrator decision. Inspect a delivery's request ID,
receipt status, event history, item, account identity, and any command output
before approving it. Only confirmed non-delivery should be approved for a new
attempt. An uncertain delivery remains a review item when authoritative game
inventory reconciliation is unavailable.

If an upgrade is interrupted, rerun the same schema script after restoring
normal database access. The migration records completion in
`dune_airdrop.config` and uses additive `IF NOT EXISTS` statements, so it does
not recreate rewards or reset activity progress.

### Rollback

Rollback means restoring the database backup taken before the upgrade, then
returning the addon and daemon files to the matching previous release. Do not
run the uninstall script as a rollback mechanism: it removes the addon-owned
schema and data. Keep the daemon stopped while restoring or investigating an
interrupted upgrade.

## Permissions and deployment

The UI manual-grant feature requires the separately approved
`admin:grant-items` permission. The daemon does not use the iframe bridge and
does not gain that permission by implication. Ensure its non-root UID/GID can
write the server command-history location; fix the mount ownership rather than
elevating the daemon to root.
