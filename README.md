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
docker rm -f airdrop-daemon 2>/dev/null || true
# Note: You may need to add --group-add <docker-gid> to allow the non-root container user to access the docker socket
docker run -d \
  --name airdrop-daemon \
  --network host \
  --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  -e DUNE_DOCKER_ROOT=/repo \
  -v "$PWD/../../../../../runtime/scripts:/repo/runtime/scripts:ro" \
  -v "$PWD/../../../../../runtime/data:/repo/runtime/data:ro" \
  -v "$PWD/../../../../../runtime/secrets:/repo/runtime/secrets:ro" \
  -v "$PWD/../../../../../runtime/generated:/repo/runtime/generated:rw" \
  -v "$PWD/../../../../../.env:/repo/.env:ro" \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  airdrop-daemon
```

**Why does this require Docker socket access?**
The current Dune Console Addon API does not support unattended native item delivery. To automate airdrops, this companion daemon executes `dune admin grant-item-id` against the running game container. The daemon runs as a non-root user and mounts the scripts and `.env` read-only. Be aware that a read-only Docker socket mount still permits sensitive Docker API operations; only run the maintained image on a trusted host.

### Update the Daemon
If you update the addon in RedBlink, you should rebuild the daemon image:
```bash
cd runtime/addons/installed/dune-airdrop-addon/daemon
docker build -t airdrop-daemon .
docker rm -f airdrop-daemon 2>/dev/null || true
# Repeat the docker run command from "Start the Daemon" so the new image is used.
```

### View Logs
```bash
docker logs -f airdrop-daemon
```

### Container Status
Verify the container is running:
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

## Uninstallation

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
