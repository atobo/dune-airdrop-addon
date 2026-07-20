-- PostgreSQL Playtime Airdrop Engine - Uninstall Script
-- Run this SQL on your Dune Awakening database to cleanly remove the Airdrop Addon data and triggers.

SET ROLE dune;

-- 1. Remove Triggers
DROP TRIGGER IF EXISTS trg_player_state_playtime ON dune.encrypted_player_state;
DROP TRIGGER IF EXISTS trg_player_state_playtime ON dune.player_state;

-- 2. Remove every addon-owned object without touching legacy objects that may
-- belong to another database role.
DROP SCHEMA IF EXISTS dune_airdrop CASCADE;

RESET ROLE;

SELECT 'Arrakis Playtime Airdrop database successfully cleaned up!' AS status;
