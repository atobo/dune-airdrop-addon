# Bridge API

Addons run inside an iframe. They call back into Dune Docker Console through the bridge helper in `web/dune-addon-bridge.js`.

Use it like this:

```js
const result = await window.DuneAddon.request("players.summary.list");
```

## Available Actions

| Action | Required permission | Purpose |
| --- | --- | --- |
| `players.summary.list` | `players:read` | Read player-summary data exposed by the console. |
| `players.identity.list`, `players.progression.get` | `players:read` | Read player identities and supported progression data. |
| `admin.items.grant` | `admin:grant-items` | Deliver an item through the Console's validated item-grant action. |
| `rewards.deliver`, `.status`, `.list` | `rewards:grant` | Queue and inspect supported Console reward delivery. |
| `players.message.send`, `.status`, `.list` | `players:message` | Queue and inspect private player messages. |
| `database.query` | `database:read` | Run read-only SQL. |
| `database.execute` | `database:write` | Run write SQL. The console creates a database backup first. |
| `addon.storage.get`, `.list` | `files:addon-data` | Read persistent JSON scoped to this addon. |
| `addon.storage.put`, `.delete` | `files:addon-data` | Save or remove addon data; use `expectedVersion` to prevent competing writes. |

Keep bridge calls small and explicit. Ask only for the permissions your addon actually uses.
Reuse a deterministic delivery `requestId` when retrying a reward or item grant;
do not create a fresh ID for a retry. The SQL bridge accepts query text only,
so never interpolate untrusted values into a query.

Addon pages are sandboxed: they cannot use direct Console REST calls, browser
storage, or arbitrary network requests. Bundle the runtime assets you need and
use the bridge for supported Console actions.

Manual grants persist their intent through addon storage before delivery. A
versioned null clears completed state without resetting the version counter.
An uncertain request retains its ID until reviewed; do not substitute an
in-memory fallback when durable storage fails.

## Local Development

The real bridge exists only when your addon is opened inside Dune Docker Console.
If you open `web/index.html` directly in a browser, use mock data for local UI
work.

Example:

```js
async function getPlayers() {
  if (window.parent === window) {
    return [
      {
        name: "Local Test Player",
        level: 42,
        faction: "Atreides",
        guild: "Dev Guild",
        status: "Online",
        map: "Survival_1"
      }
    ];
  }

  const result = await window.DuneAddon.request("players.summary.list");
  return result.rows || result.players || (Array.isArray(result) ? result : []);
}
```

For testing real bridge calls before publishing, install the addon into your own
local Dune Docker Console instance. See [Local Development](local-development.md).
