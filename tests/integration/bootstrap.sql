-- Minimal, isolated representation of the current console-owned tables used
-- by addon SQL. It is deliberately test-only and never targets a Dune server.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE dune;
CREATE SCHEMA dune AUTHORIZATION dune;
CREATE TABLE dune.accounts (id BIGINT PRIMARY KEY, "user" TEXT);
CREATE TABLE dune.actors (id BIGINT PRIMARY KEY, owner_account_id BIGINT, class TEXT);
CREATE TABLE dune.player_state (account_id BIGINT, player_pawn_id BIGINT, online_status TEXT, last_saved_at TIMESTAMPTZ DEFAULT now(), position_x DOUBLE PRECISION DEFAULT 0, position_y DOUBLE PRECISION DEFAULT 0, position_z DOUBLE PRECISION DEFAULT 0, xp BIGINT DEFAULT 0);
CREATE TABLE dune.encrypted_player_state (account_id BIGINT, player_pawn_id BIGINT, online_status TEXT);
CREATE TABLE dune.actor_fgl_entities (actor_id BIGINT, entity_id BIGINT, slot_name TEXT);
CREATE TABLE dune.fgl_entities (entity_id BIGINT, components JSONB);
CREATE TABLE dune.items (id BIGINT PRIMARY KEY, inventory_id BIGINT, template_id TEXT);
CREATE TABLE dune.inventories (id BIGINT PRIMARY KEY, account_id BIGINT);
ALTER TABLE dune.accounts OWNER TO dune;
ALTER TABLE dune.actors OWNER TO dune;
ALTER TABLE dune.player_state OWNER TO dune;
ALTER TABLE dune.encrypted_player_state OWNER TO dune;
ALTER TABLE dune.actor_fgl_entities OWNER TO dune;
ALTER TABLE dune.fgl_entities OWNER TO dune;
ALTER TABLE dune.inventories OWNER TO dune;
ALTER TABLE dune.items OWNER TO dune;
GRANT USAGE ON SCHEMA dune TO dune;
GRANT ALL ON ALL TABLES IN SCHEMA dune TO dune;
