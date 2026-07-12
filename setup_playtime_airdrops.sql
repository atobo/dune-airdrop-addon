-- PostgreSQL Playtime Airdrop Engine
-- Run this SQL on your Dune Awakening self-hosted PostgreSQL database.

-- 1. Create playtime tracking table
CREATE TABLE IF NOT EXISTS dune.bot_active_playtime (
  character_id TEXT PRIMARY KEY,
  active_seconds INT DEFAULT 0,
  last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Trigger function to track active playtime based on database player state saves
CREATE OR REPLACE FUNCTION dune.trg_track_playtime()
RETURNS TRIGGER AS $$
DECLARE
  delta_seconds INT;
  prev_active TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Only track if player's online status is 'online'
  IF LOWER(NEW.online_status::text) = 'online' THEN
    -- Get previous active timestamp
    SELECT last_active_at INTO prev_active 
    FROM dune.bot_active_playtime 
    WHERE character_id = NEW.player_pawn_id;
    
    IF prev_active IS NOT NULL THEN
      -- Calculate seconds passed since last save/update
      delta_seconds := EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - prev_active))::INT;
      
      -- Limit delta to 120 seconds per save to avoid offline time-jumps
      IF delta_seconds > 0 AND delta_seconds < 120 THEN
        INSERT INTO dune.bot_active_playtime (character_id, active_seconds, last_active_at)
        VALUES (NEW.player_pawn_id, delta_seconds, CURRENT_TIMESTAMP)
        ON CONFLICT (character_id) 
        DO UPDATE SET 
          active_seconds = dune.bot_active_playtime.active_seconds + EXCLUDED.active_seconds,
          last_active_at = EXCLUDED.last_active_at;
      ELSE
        -- Update timestamp without adding playtime if time jump is too large (e.g. initial login)
        UPDATE dune.bot_active_playtime 
        SET last_active_at = CURRENT_TIMESTAMP 
        WHERE character_id = NEW.player_pawn_id;
      END IF;
    ELSE
      -- Initialize playtime record for new character
      INSERT INTO dune.bot_active_playtime (character_id, active_seconds, last_active_at)
      VALUES (NEW.player_pawn_id, 0, CURRENT_TIMESTAMP)
      ON CONFLICT (character_id) 
      DO UPDATE SET last_active_at = CURRENT_TIMESTAMP;
    END IF;
  ELSE
    -- Player went offline, invalidate active timestamp to prevent counting while offline
    UPDATE dune.bot_active_playtime 
    SET last_active_at = NULL 
    WHERE character_id = NEW.player_pawn_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Install the trigger on the player_state table updates
DROP TRIGGER IF EXISTS trg_player_state_playtime ON dune.player_state;
CREATE TRIGGER trg_player_state_playtime
AFTER UPDATE ON dune.player_state
FOR EACH ROW
EXECUTE FUNCTION dune.trg_track_playtime();

-- 4. Initial diagnostics print
SELECT 'Arrakis Playtime Airdrop database trigger configured successfully!' AS status;
