# Dune Airdrop Addon

A powerful, customizable, and automated playtime tracking and rewards system for Dune Awakening self-hosted servers, designed exclusively for the RedBlink Console.

## Features
- **Real-Time Playtime Tracking:** Automatically tracks active online playtime, verifying movement and map coordinates to prevent AFK exploitation.
- **Dynamic Reward Scaling:** Scales XP or item drops based on consecutive hours played.
- **Daily & Weekly Login Rewards:** Calculates and manages sequential daily login streaks and weekly activity thresholds.
- **Node.js Delivery Daemon:** A lightweight external service that interfaces with PostgreSQL Pub/Sub to instantly deliver items in-game via RCON with a smart 60-second loading screen delay and offline retry loop.

## Installation

**Note on Addon Manager:** The Dune Console's addon manager natively supports UI-only addons. It will not automatically execute the required database schemas or manage the delivery daemon. You **must** manually run the SQL schema and start the background worker for this addon to function!

1. Install the addon via the Dune Console UI.
2. Install the database backend:
```bash
sudo docker exec -i dune-postgres psql -U postgres -d dune < addons/installed/dune-airdrop-addon/setup_playtime_airdrops.sql
```
3. Start the companion daemon (Requires Node.js):
```bash
cd addons/installed/dune-airdrop-addon/daemon
npm install
pm2 start index.js --name "airdrop-daemon"
```

## Uninstallation

If you wish to remove the Airdrop Addon completely:
1. Stop the daemon: `pm2 delete airdrop-daemon`
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
