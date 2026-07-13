# Dune Airdrop Addon

A powerful, customizable, and automated playtime tracking and rewards system for Dune Awakening self-hosted servers, designed exclusively for the RedBlink Console.

## Features
- **Real-Time Playtime Tracking:** Automatically tracks active online playtime, verifying movement and map coordinates to prevent AFK exploitation.
- **Dynamic Reward Scaling:** Scales XP or item drops based on consecutive hours played.
- **Daily & Weekly Login Rewards:** Calculates and manages sequential daily login streaks and weekly activity thresholds.
- **Node.js Delivery Daemon:** A lightweight external service that interfaces with PostgreSQL Pub/Sub to instantly deliver items in-game via RCON with a smart 60-second loading screen delay and offline retry loop.

## Installation

1. Copy the `dune-airdrop-addon` folder into your `addons/installed` directory.
2. Refresh the RedBlink Console UI to complete the installation.
3. Install the database backend:
```bash
sudo docker exec -i dune-postgres psql -U postgres -d dune < setup_playtime_airdrops.sql
```
4. Start the companion daemon (See `daemon/README.md` for details):
```bash
cd daemon
npm install
pm2 start index.js --name "airdrop-daemon"
```

## Repository Layout

```text
addon.json                 Addon identity, version, entry path, and permissions.
setup_playtime_airdrops.sql PostgeSQL schemas and triggers for tracking & rewards.
web/                       The addon page shown inside Dune Docker Console.
daemon/                    The Node.js Delivery Daemon service.
```
