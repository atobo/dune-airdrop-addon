#!/usr/bin/env python3
import time
import json
import psycopg2
from psycopg2.extras import RealDictCursor

# Database credentials (using Unix sockets inside the Postgres container)
DB_HOST = ""
DB_PORT = 5432
DB_NAME = "dune"
DB_USER = "postgres"
DB_PASS = ""

TICK_INTERVAL = 10     # Increment timer every 10 seconds

def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASS
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        return None

def run_playtime_tick():
    conn = get_db_connection()
    if not conn:
        return

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Load active configurations
            cur.execute("SELECT config_value FROM dune.airdrop_addon_config WHERE config_key = 'airdrop_multipliers' LIMIT 1;")
            config_row = cur.fetchone()
            
            if not config_row or not config_row['config_value']:
                return
                
            config = config_row['config_value']
            
            # Ensure background daemon is enabled in dashboard settings
            if not config.get('playtime_enabled', True) or not config.get('use_daemon', False):
                return

            interval_min = int(config.get('playtime_interval', 60))
            if interval_min < 1:
                interval_min = 60

            min_dist = float(config.get('playtime_distance', 0.0))
            min_xp = int(config.get('playtime_xp', 0))

            # 2. Fetch all online players from dune.player_state (casting connection status ENUM to TEXT)
            cur.execute("""
                SELECT ps.player_pawn_id, ps.account_id, ps.character_name, a.transform
                FROM dune.player_state ps
                LEFT JOIN dune.actors a ON a.id = ps.player_pawn_id::text
                WHERE LOWER(ps.online_status::text) = 'online' OR LOWER(ps.online_status::text) = 'true';
            """)
            online_players = cur.fetchall()

            for player in online_players:
                char_id = str(player['player_pawn_id'])
                account_id = player['account_id']
                name = player['character_name']
                transform = player['transform']

                # Extract translation coordinates safely from transform array
                x, y, z = 0.0, 0.0, 0.0
                if transform and len(transform) >= 3:
                    try:
                        x = float(transform[0])
                        y = float(transform[1])
                        z = float(transform[2])
                    except Exception:
                        pass

                # 3. Check if playtime tracking record exists
                cur.execute("""
                    SELECT active_seconds, last_xp, last_x, last_y, last_z 
                    FROM dune.bot_active_playtime 
                    WHERE character_id = %s;
                """, (char_id,))
                track_row = cur.fetchone()

                # Fetch current XP dynamically
                cur.execute("""
                    SELECT COALESCE((fe.components->'FLevelComponent'->1->>'TotalXPEarned')::bigint, 0) as xp
                    FROM dune.actor_fgl_entities afe
                    LEFT JOIN dune.fgl_entities fe ON fe.entity_id = afe.entity_id
                    WHERE afe.actor_id = %s AND afe.slot_name = 'DuneCharacter'
                    LIMIT 1;
                """, (char_id,))
                xp_row = cur.fetchone()
                curr_xp = xp_row['xp'] if xp_row else 0

                if not track_row:
                    # Initialize playtime record
                    cur.execute("""
                        INSERT INTO dune.bot_active_playtime (character_id, active_seconds, last_xp, last_x, last_y, last_z, last_active_at)
                        VALUES (%s, 0, %s, %s, %s, %s, NOW());
                    """, (char_id, curr_xp, x, y, z))
                else:
                    # Enforce AFK validation checks if config thresholds are set > 0
                    is_active = False
                    if min_dist == 0.0 and min_xp == 0:
                        is_active = True
                    else:
                        # Calculate distance offset
                        last_x = float(track_row['last_x'] or 0.0)
                        last_y = float(track_row['last_y'] or 0.0)
                        last_z = float(track_row['last_z'] or 0.0)
                        dist = ((x - last_x)**2 + (y - last_y)**2 + (z - last_z)**2)**0.5
                        
                        # Calculate XP offset
                        last_xp = int(track_row['last_xp'] or 0)
                        xp_diff = curr_xp - last_xp

                        if min_dist > 0.0 and dist >= min_dist:
                            is_active = True
                        if min_xp > 0 and xp_diff >= min_xp:
                            is_active = True

                    accumulated = track_row['active_seconds']
                    if is_active:
                        accumulated += TICK_INTERVAL

                    # If playtime target is met, trigger reward roll
                    if accumulated >= (interval_min * 60):
                        print(f"[Airdrop Daemon] Rolling playtime rewards for {name} ({char_id})")
                        cur.execute("SELECT dune.fn_roll_playtime_reward(%s, %s);", (account_id, char_id))
                        accumulated = 0

                    cur.execute("""
                        UPDATE dune.bot_active_playtime 
                        SET active_seconds = %s, last_xp = %s, last_x = %s, last_y = %s, last_z = %s, last_active_at = NOW() 
                        WHERE character_id = %s;
                    """, (accumulated, curr_xp, x, y, z, char_id))

                # 4. Check for daily/weekly login streaks and deliver pending drops instantly
                cur.execute("SELECT dune.fn_check_daily_weekly_rewards(%s, %s);", (account_id, char_id))
                cur.execute("SELECT dune.fn_deliver_playtime_airdrops(%s, %s);", (account_id, char_id))

            conn.commit()
    except Exception as e:
        print(f"Error executing daemon tick: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    print("[Airdrop Daemon] Arrakis Airdrop Playtime Daemon started successfully.")
    print(f"[Airdrop Daemon] Polling active players every {TICK_INTERVAL} seconds...")
    while True:
        try:
            run_playtime_tick()
        except KeyboardInterrupt:
            print("\nShutting down daemon...")
            break
        except Exception as e:
            print(f"Daemon loop encountered error: {e}")
        time.sleep(TICK_INTERVAL)
