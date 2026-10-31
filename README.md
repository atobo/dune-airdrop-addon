# Dune Airdrop Addon

![Dune Airdrop Concept Art](assets/dune_airdrop_art.png)

**Version 1.4.0** is a RedBlink Dune Docker Console addon for playtime,
daily-login, and weekly-attendance rewards. The console UI manages settings,
queue review, and recovery approval. A separately deployed companion daemon
delivers eligible rewards while players are online.

## Before installation

- Back up the Dune database before a first install or upgrade.
- The addon requires approved `database:read` and `database:write`
  permissions. They are required for schema setup, settings, queue visibility,
  and recovery approval.
- `admin:grant-items` is requested for the UI's manual-grant function only.
  Approve it only if that feature is wanted; it is not required for normal
  queue recovery or the companion daemon.
- Automated delivery requires the companion daemon. It invokes the supported
  `dune admin grant-item-id` command and therefore needs carefully reviewed
  access to the host's Docker socket and Dune runtime files.

## Install or upgrade

1. In Dune Docker Console, install the release ZIP through **Addons**, or have
   the console administrator stage the unpacked addon under
   `runtime/addons/installed/dune-airdrop-addon/`.
2. Approve `database:read` and `database:write`. Do not grant
   `admin:grant-items` unless manual grants are deliberately enabled.
3. For an upgrade, stop the existing `airdrop-daemon` first. Do not clear the
   queue, receipts, configuration, or activity tables.
4. Stop the battlegroup, open **Airdrop Manager**, and select **INIT SCHEMA**.
   Wait for success before starting the battlegroup and the matching v1.4.0
   daemon image.

Read [Safe upgrade and recovery](docs/upgrade-v2.md) before upgrading an
existing installation. It covers backup, recovery approval, rollback, and the
historical-migration test boundary.

## Companion daemon

The console addon is an iframe and cannot run unattended delivery. Deploy the
included daemon only after reviewing its mounts and Docker-socket access.

From the daemon directory in the installed addon, use the included example
compose file with an absolute path to the Dune server repository:

```bash
export DUNE_DOCKER_ROOT=/absolute/path/to/dune-awakening-selfhost-docker
export AIRDROP_DAEMON_UID="$(id -u)"
export AIRDROP_DAEMON_GID="$(id -g)"
cd "$DUNE_DOCKER_ROOT/runtime/addons/installed/dune-airdrop-addon/daemon"
docker compose -f docker-compose.dev.yml up -d --build
```

Verify the daemon and inspect its logs:

```bash
docker ps --filter name=airdrop-daemon
docker logs -f airdrop-daemon
```

To update it, stop the existing container, complete the schema upgrade, then
run the same command from the newly installed addon directory. Do not run the
daemon as root to solve a permissions error; set `AIRDROP_DAEMON_UID` and
`AIRDROP_DAEMON_GID` to an account that can write `runtime/generated`.

## Offline, recovery, and uncertain rewards

- Confirmed offline players remain queued as `WAITING_FOR_PLAYER` and are
  retried when they next become eligible.
- Historical undelivered rewards require one explicit recovery approval in the
  dashboard. Verify the reward was not previously granted before approving it.
- `UNCERTAIN` means a command may have crossed the delivery boundary without a
  conclusive result. It is never automatically retried. Reconcile game state,
  receipts, queue events, and command output before taking any manual action.

## Uninstall

Uninstalling deletes addon-owned database data. Create and verify a database
backup first. Stop and remove the daemon, run `uninstall_playtime_airdrops.sql`
against the intended Dune database, then remove the addon through Dune Docker
Console. This operation is not an upgrade path.

## Package contents

The release ZIP contains only runtime files: the manifest, UI, daemon, schema
scripts, and release documentation. It excludes tests, browser tooling,
Playwright, Chromium, development `node_modules`, and temporary test hooks.
