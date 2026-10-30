// Compatibility boundary for the external daemon. The authenticated console
// bridge is iframe-only, so this intentionally mirrors only its public
// FLS-first target preference and fails closed on stale or ambiguous records.
import { safeIdentity } from "./deliveryState.js";

export const IDENTITY_SQL = `
  SELECT a.owner_account_id AS account_id,
    CASE WHEN trim(coalesce(ac."user", '')) ~ '^[A-Fa-f0-9]{15,64}$' THEN trim(ac."user") ELSE '' END AS fls_id,
    coalesce(ps.online_status::text, 'Offline') AS online_status
  FROM dune.actors a
  JOIN dune.player_state ps ON ps.account_id = a.owner_account_id AND ps.player_pawn_id = a.id
  LEFT JOIN dune.accounts ac ON ac.id = a.owner_account_id
  WHERE a.owner_account_id = $1::bigint AND a.class ILIKE '%PlayerCharacter%'
  ORDER BY a.id DESC LIMIT 2`;

export async function resolveGrantIdentity(client, accountId) {
  const result = await client.query(IDENTITY_SQL, [accountId]);
  if (result.rows.length !== 1) return { ok: false, code: result.rows.length ? "AMBIGUOUS_IDENTITY" : "UNRESOLVED_IDENTITY" };
  return safeIdentity(result.rows[0]);
}
