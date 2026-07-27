# RedBlink Code Review & Add-on Architecture Guidelines

Based on the feedback received during the Airdrop Add-on development, here is a comprehensive breakdown of RedBlink's expectations, preferences, and architectural standards for developing Dune Docker Console Add-ons.

## 1. Idempotency & Retry Safety (CRITICAL)
RedBlink is extremely strict about preventing duplicate actions (like double-granting items) due to network interruptions, page reloads, or impatient users.
- **Opaque Request IDs**: Use `crypto.randomUUID()` for unique identifiers instead of concatenating raw user inputs (which can exceed length limits or contain unsupported characters).
- **Persistent State**: Always persist pending request IDs and their exact payload to `localStorage` *before* firing a bridge request. 
- **Strict Clearing Rules**: Do *not* clear a pending request from storage just because a UI modal was closed or the page refreshed. Only clear it upon confirmed, definitive success (e.g., `receipt.ok === true`) or a permanent rejection (e.g., insufficient permissions).
- **Regeneration**: Regenerate a request ID *only* when the underlying payload (item, quantity, target player) intentionally changes.

## 2. Unresolved State & UI Locking
- If a response is lost or ambiguous (an "Uncertain State"), the UI must **lock all related input fields** so the administrator cannot accidentally change the payload and fire a new request.
- Provide an explicit "Discard Uncertain Delivery" action. The administrator must acknowledge a duplicate-risk warning to manually clear the lock.

## 3. Data Integrity & SQL Injection Safety
- **BigInt Safety**: PostgreSQL IDs (like `container_id` or `account_id`) are often 64-bit integers. **Do not** pass them through JavaScript's `Number()` or `parseInt()` as they will lose precision. 
- **Regex Validation**: Treat large IDs as strings. Validate them using strict Regex (e.g., `/^[0-9]+$/`) before execution.
- **Explicit Casting**: When passing these string IDs into raw SQL queries, explicitly cast them to bigint (e.g., `WHERE id = ${String(actId)}::bigint`).

## 4. Architecture Boundaries
- **Background vs Foreground**: Do not mix paradigms. The `DuneAddon.request()` bridge is strictly a foreground UI mechanism. Do not rely on it (or an open browser tab) to process unattended background tasks, queues, or scheduled deliveries.
- **Daemons**: Background tasks should be handled by an independent daemon (like a Node.js background process) that can recover and run on a server restart.

## 5. Automated Testing Requirements
- RedBlink expects mission-critical native bridge interactions and idempotency logic to have automated test coverage.
- Extract core logic out of DOM event listeners and into pure, exportable functions.
- Write tests using the native `node:test` runner to simulate edge cases like corrupt `localStorage`, payload changes, and ambiguous bridge responses.

## 6. Manifests & Packaging
- Ensure exact parity between the `addon.json` (inside the add-on) and the catalog manifest (`dune-docker-addons.json`).
- Do not invent or include unsupported fields (like `minimumVersion`) in the `addon.json` schema unless explicitly requested by the core team.
- Always recalculate and update the `sha256` hash in the catalog when the `.zip` archive changes.
