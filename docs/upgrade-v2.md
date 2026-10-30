# Safe upgrade and recovery

Version 1.4.0 of the delivery lifecycle is an in-place, additive upgrade. It does
not delete queues, receipts, settings, loot tables, activity records, streaks,
or playtime.

## Before upgrading

1. Create a normal Dune database backup.
2. Record the current queue and receipt counts.
3. Stop the companion daemon before applying the schema upgrade. Do not clear
   queue rows or reset the addon configuration.
4. Apply `setup_playtime_airdrops.sql` once through the addon only while the
   battlegroup is stopped, then start a daemon built from the same release.

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

## Permissions and deployment

The UI manual-grant feature requires the separately approved
`admin:grant-items` permission. The daemon does not use the iframe bridge and
does not gain that permission by implication. Ensure its non-root UID/GID can
write the server command-history location; fix the mount ownership rather than
elevating the daemon to root.
