# Dune Airdrop Addon - Node.js Companion Service

## Overview
This directory contains a standalone Node.js daemon that acts as an external **Companion Service** to the Dune Airdrop Addon for the RedBlink Console.

Because the current RedBlink community addon API is UI-only and does not natively support background daemon lifecycles or continuous RabbitMQ player events, this service runs externally to bridge the gap and provide **instant, real-time airdrop deliveries** directly to players without requiring them to relog.

## Architecture
The daemon utilizes an event-driven architecture using PostgreSQL's native **`LISTEN/NOTIFY` (Pub/Sub)** capabilities:
1. The game server auto-saves player states (e.g., playtime, location) to the database every 5 minutes.
2. A custom SQL trigger (`trg_track_playtime`) calculates if the player is eligible for an airdrop and queues it in `dune_airdrop.pending_deliveries`.
3. A second SQL trigger instantly emits a `pg_notify` event containing the delivery details.
4. This Node daemon passively listens for the `pg_notify` event. It mathematically ensures exactly **60 seconds pass** before executing the native RedBlink `dune admin grant-item-id` CLI command to deliver the item. This ensures the player is fully loaded into the game.
5. The daemon records a persistent receipt before crossing the command boundary. Confirmed offline players are deferred, while timeouts and unverified command outcomes become **UNCERTAIN** and require administrator review. They are never automatically replayed.

## Safety and compatibility

- The daemon is not an iframe and cannot call `window.DuneAddon.request()` or the console bridge. It uses the supported `dune admin grant-item-id` command after resolving the current player identity from the Dune database.
- It prefers a valid FLS ID and otherwise uses the durable account ID, matching the console's current action-player preference.
- Existing undelivered rewards are held for explicit recovery approval by the upgrade migration. Installing an upgrade does not replay historic rewards.
- Run the schema upgrade before replacing a daemon image. The daemon expects the delivery lifecycle columns and event table supplied by `setup_playtime_airdrops.sql`.
- Do not run the daemon as root to solve filesystem permissions. Its UID/GID must have write access to the mounted `runtime/generated` directory used by the supported Dune command wrapper.

## Docker permissions

The historical `admin-command-history.tsv: Permission denied` error occurs when
the daemon's effective container UID/GID cannot write the host-mounted
`runtime/generated` directory. `docker-compose.dev.yml` supplies that mount and
runs as `AIRDROP_DAEMON_UID:AIRDROP_DAEMON_GID` (default `1000:1000`), rather
than root. Before deployment, verify the host ownership with `stat` and use the
UID/GID that owns that directory. This file is a reviewed deployment example;
it does not alter an existing container, mount, or host permission.

## Installation and update

Use the reviewed Docker example rather than installing dependencies directly
on the host. From the installed addon directory:

```bash
export DUNE_DOCKER_ROOT=/absolute/path/to/dune-awakening-selfhost-docker
export AIRDROP_DAEMON_UID="$(id -u)"
export AIRDROP_DAEMON_GID="$(id -g)"
cd "$DUNE_DOCKER_ROOT/runtime/addons/installed/dune-airdrop-addon/daemon"
docker compose -f docker-compose.dev.yml up -d --build
```

The daemon reads database configuration from the mounted server `.env`. Before
an upgrade, stop the old daemon, complete the addon schema upgrade, then build
and start the daemon from the matching release. Do not run two daemon versions
against the same queue.

The compose file intentionally uses host networking because the standard
self-hosted PostgreSQL endpoint is host-local. Review every mount and the
Docker-socket risk for the host before using it. Follow logs with:

```bash
docker compose -f docker-compose.dev.yml logs -f airdrop-daemon
```
