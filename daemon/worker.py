import os
import time
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone
import json
import logging
import math

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configurable constants
TICK_INTERVAL_SEC = int(os.environ.get("TICK_INTERVAL_SEC", 15))
HEARTBEAT_INTERVAL_SEC = int(os.environ.get("HEARTBEAT_INTERVAL_SEC", 60))

def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "dune-postgres"),
        database=os.environ.get("PGDATABASE", "dune"),
        user=os.environ.get("PGUSER", "postgres"),
        password=os.environ.get("PGPASSWORD", ""),
        port=os.environ.get("PGPORT", "5432")
    )

def ping_heartbeat(conn):
    try:
        with conn.cursor() as cur:
            # Upsert the heartbeat so the SQL triggers know the daemon is alive
            ping_data = json.dumps({"last_ping": datetime.now(timezone.utc).isoformat()})
            cur.execute("""
                INSERT INTO dune.discord_bot_config (config_key, config_value)
                VALUES ('daemon_heartbeat', %s)
                ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;
            """, (ping_data,))
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to ping heartbeat: {e}")
        conn.rollback()

def load_config(conn):
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT config_value FROM dune.discord_bot_config WHERE config_key = 'airdrop_multipliers' LIMIT 1")
            row = cur.fetchone()
            if row and row[0]:
                return row[0]
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        conn.rollback()
    
    # Default fallback
    return {
        "playtime_enabled": True,
        "playtime_interval": 60,
        "playtime_distance": 10.0,
        "playtime_xp": 1
    }

def calculate_distance(x1, y1, z1, x2, y2, z2):
    return math.sqrt(pow(x1 - x2, 2) + pow(y1 - y2, 2) + pow(z1 - z2, 2))

def track_playtime(conn):
    try:
        cfg = load_config(conn)
        playtime_enabled = cfg.get("playtime_enabled", True)
        interval_min = cfg.get("playtime_interval", 60)
        min_dist = cfg.get("playtime_distance", 10.0)
        min_xp = cfg.get("playtime_xp", 1)
        
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            # 1. Fetch all online players
            cur.execute("""
                SELECT account_id, player_pawn_id 
                FROM dune.player_state 
                WHERE LOWER(online_status::text) = 'online'
            """)
            online_players = cur.fetchall()

            for p in online_players:
                acc_id = p["account_id"]
                char_id = p["player_pawn_id"]
                
                if not char_id:
                    continue

                # 2. Daily/Weekly check
                cur.execute("SELECT dune.fn_check_daily_weekly_rewards(%s, %s)", (acc_id, char_id))

                # 3. Get current state (XP and coordinates)
                cur.execute("""
                    SELECT 
                      COALESCE((fe.components->'FLevelComponent'->1->>'TotalXPEarned')::bigint, 0) AS xp
                    FROM dune.actor_fgl_entities afe
                    LEFT JOIN dune.fgl_entities fe ON fe.entity_id = afe.entity_id
                    WHERE afe.actor_id = %s AND afe.slot_name = 'DuneCharacter'
                    LIMIT 1;
                """, (char_id,))
                xp_row = cur.fetchone()
                curr_xp = xp_row["xp"] if xp_row else 0

                cur.execute("""
                    SELECT 
                      ((transform).location).x::float AS x, 
                      ((transform).location).y::float AS y, 
                      ((transform).location).z::float AS z
                    FROM dune.actors WHERE id = %s LIMIT 1;
                """, (char_id,))
                coord_row = cur.fetchone()
                if not coord_row:
                    continue
                x, y, z = coord_row["x"], coord_row["y"], coord_row["z"]

                # 4. Get tracking cache
                cur.execute("SELECT * FROM dune.bot_active_playtime WHERE character_id = %s", (char_id,))
                track = cur.fetchone()

                if not track:
                    # Initialize
                    cur.execute("""
                        INSERT INTO dune.bot_active_playtime (character_id, active_seconds, last_xp, last_x, last_y, last_z, last_active_at)
                        VALUES (%s, 0, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    """, (char_id, curr_xp, x, y, z))
                else:
                    last_x, last_y, last_z = track["last_x"], track["last_y"], track["last_z"]
                    last_xp = track["last_xp"]
                    active_seconds = track["active_seconds"]

                    dist = calculate_distance(x, y, z, last_x, last_y, last_z)
                    xp_diff = curr_xp - last_xp

                    is_active = False
                    if min_dist == 0.0 and min_xp == 0:
                        is_active = True
                    else:
                        if min_dist > 0.0 and dist >= min_dist:
                            is_active = True
                        if min_xp > 0 and xp_diff >= min_xp:
                            is_active = True

                    if is_active:
                        active_seconds += TICK_INTERVAL_SEC
                        
                        # Roll reward if threshold hit
                        if playtime_enabled and active_seconds >= (interval_min * 60):
                            cur.execute("SELECT dune.fn_roll_playtime_reward(%s, %s)", (acc_id, char_id))
                            active_seconds = 0
                            logger.info(f"Rolled playtime reward for character {char_id}")

                        cur.execute("""
                            UPDATE dune.bot_active_playtime 
                            SET active_seconds = %s, last_xp = %s, last_x = %s, last_y = %s, last_z = %s, last_active_at = CURRENT_TIMESTAMP
                            WHERE character_id = %s
                        """, (active_seconds, curr_xp, x, y, z, char_id))
                    else:
                        # Idle update timestamp only
                        cur.execute("""
                            UPDATE dune.bot_active_playtime 
                            SET last_active_at = CURRENT_TIMESTAMP
                            WHERE character_id = %s
                        """, (char_id,))
                
                # Force delivery
                cur.execute("SELECT dune.fn_deliver_playtime_airdrops(%s, %s)", (acc_id, char_id))
            
            conn.commit()
    except Exception as e:
        logger.error(f"Tracking error: {e}")
        conn.rollback()

def main():
    logger.info("Starting Dune Airdrop Daemon...")
    last_heartbeat = 0

    while True:
        try:
            conn = get_db_connection()
            
            now = time.time()
            if now - last_heartbeat >= HEARTBEAT_INTERVAL_SEC:
                ping_heartbeat(conn)
                last_heartbeat = now
            
            track_playtime(conn)
            
            conn.close()
        except Exception as e:
            logger.error(f"Main loop error: {e}")
            
        time.sleep(TICK_INTERVAL_SEC)

if __name__ == "__main__":
    main()
