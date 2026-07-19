-- PostgreSQL Playtime Airdrop Engine - Uninstall Script
-- Run this SQL on your Dune Awakening database to cleanly remove the Airdrop Addon data and triggers.

-- 1. Remove Triggers
DROP TRIGGER IF EXISTS trg_player_state_playtime ON dune.encrypted_player_state;
DROP TRIGGER IF EXISTS trg_player_state_playtime ON dune.player_state;
DROP TRIGGER IF EXISTS trg_notify_airdrop ON dune.airdrop_pending_deliveries;

-- 2. Remove Functions
DROP FUNCTION IF EXISTS dune.trg_track_playtime_v2();
DROP FUNCTION IF EXISTS dune.fn_check_daily_weekly_rewards_v2(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS dune.fn_deliver_playtime_airdrops_v2(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS dune.fn_roll_playtime_reward_v2(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS dune.fn_queue_reward_roll_v2(BIGINT, INT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS dune.fn_get_pawn_tier_v2(BIGINT);
DROP FUNCTION IF EXISTS dune.trg_notify_pending_delivery_v2();
DROP FUNCTION IF EXISTS dune.trg_track_playtime();
DROP FUNCTION IF EXISTS dune.fn_check_daily_weekly_rewards(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS dune.fn_deliver_playtime_airdrops(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS dune.fn_roll_playtime_reward(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS dune.fn_queue_reward_roll(BIGINT, INT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS dune.fn_get_pawn_tier(BIGINT);
DROP FUNCTION IF EXISTS dune.trg_notify_pending_delivery();
DROP FUNCTION IF EXISTS dune.fn_manual_airdrop_spawn(BIGINT, TEXT, INT);

-- 3. Remove Tables
DROP TABLE IF EXISTS dune.airdrop_loot_tables;
DROP TABLE IF EXISTS dune.airdrop_pending_deliveries;
DROP TABLE IF EXISTS dune.airdrop_delivery_receipts;
DROP TABLE IF EXISTS dune.airdrop_active_playtime;
DROP TABLE IF EXISTS dune.airdrop_config;

SELECT 'Arrakis Playtime Airdrop database successfully cleaned up!' AS status;
