# Dune Airdrop Addon

![Dune Airdrop Concept Art](assets/dune_airdrop_art.png)

A powerful, customizable, and automated playtime tracking and rewards system for Dune Awakening self-hosted servers, designed exclusively for the RedBlink Console.

## Features
- **Real-Time Playtime Tracking:** Automatically tracks active online playtime, verifying movement and map coordinates to prevent AFK exploitation.
- **Dynamic Reward Scaling:** Scales XP or item drops based on consecutive hours played.
- **Daily & Weekly Login Rewards:** Calculates and manages sequential daily login streaks and weekly activity thresholds.
- **Node.js Delivery Daemon:** A lightweight external service that interfaces with PostgreSQL Pub/Sub to instantly deliver items in-game via RCON with a smart 60-second loading screen delay and offline retry loop.

## 1. Installation

1. Copy the `dune-airdrop-addon` folder into your `runtime/addons/installed/` directory.
2. In the RedBlink UI, click **INIT SCHEMA**. Wait for it to complete.

## 2. Running the Daemon

Because RedBlink addons are UI-only, this addon requires a **Companion-Service Setup**. The companion Node daemon must be built and run manually using Docker on your host machine so it can monitor the database and execute RCON commands.

### Start the Daemon
From the root of your Dune server repository, run:
```bash
cd runtime/addons/installed/dune-airdrop-addon/daemon
docker build -t airdrop-daemon .
docker rm -f airdrop-daemon
# Note: You may need to add --group-add <docker-gid> to allow the non-root container user to access the docker socket
docker run -d \
  --name airdrop-daemon \
  --network host \
  --restart unless-stopped \
  -e DUNE_DOCKER_ROOT=/repo \
  -v $(pwd)/../../../../../runtime/scripts:/repo/runtime/scripts:ro \
  -v $(pwd)/../../../../../.env:/repo/.env:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  airdrop-daemon
```

**Why does this require Docker socket access?**
The current Dune Console Addon API does not support native item delivery. To automate airdrops, this companion daemon executes RCON commands (`dune admin grant-item-id`) against the running game container. We mitigate this risk by running the daemon as a non-root user and strictly mounting only the required scripts and `.env` as read-only (`:ro`).

### Update the Daemon
If you update the addon in RedBlink, you should rebuild the daemon image:
```bash
cd runtime/addons/installed/dune-airdrop-addon/daemon
docker build -t airdrop-daemon .
docker restart airdrop-daemon
```

### View Logs
```bash
docker logs -f airdrop-daemon
```

### Health Check
Verify the container is running and healthy:
```bash
docker ps | grep airdrop-daemon
```

### Stop the Daemon
```bash
docker stop airdrop-daemon
```

### Uninstall the Daemon
```bash
docker rm -f airdrop-daemon
```

## 3. Delivery & Retry Architecture

The Airdrop Daemon utilizes a strict, safe queueing architecture backed by PostgreSQL locks:
- **At-Most-Once Guarantee:** The daemon enforces an "at-most-once" delivery policy. If an unexpected crash, interruption, or unknown command output occurs (where item publication cannot be positively verified), the delivery receipt state is locked to `UNCERTAIN` to strictly prevent duplicate item deliveries. 
- **Offline Retries:** If a player is offline, the daemon detects this cleanly before executing the item drop (or definitively captures an offline rejection from the RCON CLI) and reschedules the delivery. This retry logic utilizes a capped backoff sequence (1m → 3m → 5m → 5m) so that players are never kept waiting for long periods once they log back in.
- **Leased Queueing & 3-Minute Timeout:** Deliveries are exclusively claimed using a UUID-based lease (`lease_token`) ensuring zero concurrency collisions across worker loops. Delivery execution is bound by a strict 3-minute timeout (`SIGKILL`), preventing hanging RCON processes.
- **Log Clarity:** Delivery logs explicitly differentiate the Queue/Delivery ID (e.g. `Delivery ID 1234`) and the Account ID (`Account: 885233142`), assisting server owners in tracing specific item drops.

## 4. Uninstallation

If you wish to remove the Airdrop Addon completely:
1. Stop the daemon: `docker rm -f airdrop-daemon`
2. Remove the database tables and triggers:
```bash
sudo docker exec -i dune-postgres psql -U postgres -d dune < addons/installed/dune-airdrop-addon/uninstall_playtime_airdrops.sql
```
3. Uninstall the addon via the Dune Console UI.

## Repository Layout

```text
addon.json                       Addon identity, version, entry path, and permissions.
setup_playtime_airdrops.sql      PostgreSQL schemas and triggers for tracking & rewards.
uninstall_playtime_airdrops.sql  PostgreSQL cleanup script for uninstalling.
web/                             The addon page shown inside Dune Docker Console.
daemon/                          The Node.js Delivery Daemon service.
```
