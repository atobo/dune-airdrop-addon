# Future Addon Enhancements (v2.0)

This document contains brainstormed features and enhancements to build out after the base addon receives RedBlink approval.

## 1. Advanced Airdrop Probability Configuration
Give server admins ultimate sandbox control over airdrop loot economies by exposing drop percentages to the RedBlink UI.

**New UI Sliders:**
- **Raw Resource Drop Chance** (Default: 100%)
- **Crafted Component Drop Chance** (Default: 100%)
- **Schematic Drop Chance** (Default: 80%)
- **Gear Drop Chance** (Default: 40%)

## 2. Minimum Guaranteed Drops
A failsafe mechanism to prevent "ghost drops" (airdrop cycles where the player receives nothing due to bad RNG).
- **New UI Slider:** "Minimum Guaranteed Items" (Range: 1-4)
- **Logic:** If the RNG roll results in fewer items than the minimum threshold, the script will forcefully grant random categories until the minimum is met.

## 3. Tier-Specific Stack Size Configuration
Allow admins to define custom stack size ranges for resources based on the player's tier, rather than a global setting.
- **Concept:** Lower-tier players might receive stacks of 5-10, while max-level players receive 20-50 to match end-game building requirements.
- **Implementation:** Add min/max quantity inputs for each tier level in the UI settings panel.

## Architecture Notes for Implementation
- **UI Bridge:** We will need to map the new UI settings using `redblink.config.set()` and sync them into a new Postgres configuration table (e.g., `dune.airdrop_config`) via the Node.js daemon.
- **SQL Updates:** The hardcoded probabilities and quantities in `dune.fn_queue_reward_roll` will be replaced with dynamic queries pulling from the new configuration table.

## 4. In-Game Player Chat Commands
Add a background listener to provide players with interactive chat commands.
- **Concept:** Players can type `/airdrop` (or `!airdrop`) in the global chat to instantly receive a private message containing:
  - Time remaining until their next airdrop
  - Their consecutive days logged in (Daily Streak)
  - Their weekly login stats (e.g., "3/5 days")
- **Implementation:** Have the Node.js daemon tail the game's chat logs in the Postgres database. When it detects the command, it queries the player's stats from `bot_active_playtime` and fires an RCON command (`admin broadcast`) to send them a private server message with the formatted stats.
- **UI Settings Toggle:** Add a toggle in the RedBlink UI allowing admins to choose between `/airdrop` (Silent but throws an engine "Invalid Short Command" error) or `!airdrop` (No error, but is visible to everyone and clutters global chat). Include a small tooltip/note explaining this tradeoff to the admin.
