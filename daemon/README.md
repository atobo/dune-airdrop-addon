# Dune Airdrop Addon - Node.js Companion Service

## Overview
This directory contains a standalone Node.js daemon that acts as an external **Companion Service** to the Dune Airdrop Addon for the RedBlink Console. 

Because the current RedBlink community addon API is UI-only and does not natively support background daemon lifecycles or continuous RabbitMQ player events, this service runs externally to bridge the gap and provide **instant, real-time airdrop deliveries** directly to players without requiring them to relog.

## Architecture
The daemon utilizes an event-driven architecture using PostgreSQL's native **`LISTEN/NOTIFY` (Pub/Sub)** capabilities:
1. The game server auto-saves player states (e.g., playtime, location) to the database every 5 minutes.
2. A custom SQL trigger (`trg_track_playtime`) calculates if the player is eligible for an airdrop and queues it in `dune.bot_pending_deliveries`.
3. A second SQL trigger instantly emits a `pg_notify` event containing the delivery details.
4. This Node daemon passively listens for the `pg_notify` event. It mathematically ensures exactly **60 seconds pass** before executing the native RedBlink `dune admin grant-item-id` CLI command to deliver the item. This ensures the player is fully loaded into the game.
5. If the delivery fails (e.g., the player logs out during the 60-second wait), the daemon automatically queues it and **retries every 30 seconds** until the player logs back in.

## Installation & Usage

1. **Install Dependencies:**
   ```bash
   cd daemon
   npm install
   ```

2. **Run the Daemon:**
   You can run the daemon manually in a terminal, or set it up to run automatically in the background using `pm2`, `tmux`, or a `systemd` service.
   ```bash
   node index.js
   ```

The daemon automatically reads your secure database credentials from the parent `dune-awakening-selfhost-docker/.env` file.
