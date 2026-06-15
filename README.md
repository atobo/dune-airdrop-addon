# Dune Docker Addon Template

Starter template for building community addons for Dune Docker Console.

Addons run inside the console as iframe pages and talk to the console through a permissioned bridge. Server owners review requested permissions when installing an addon.

## Create Your Addon

1. Click **Use this template** on GitHub.
2. Rename the addon fields in `addon.json`.
3. Build your UI in `web/`.
4. Run validation:

   ```bash
   node scripts/validate.js
   ```

5. Package the addon:

   ```bash
   bash scripts/package.sh
   ```

6. Upload the generated `.zip` from `dist/` to a GitHub Release.
7. Add your addon entry to the community addons index.

## Addon Package Rules

The `.zip` file must contain:

- `addon.json` at the root of the archive.
- The UI entry file referenced by `addon.json`, usually `web/index.html`.
- Any static assets used by the addon.

Do not include secrets, private tokens, database dumps, or machine-specific files.

## `addon.json`

```json
{
  "schemaVersion": 1,
  "id": "my-dune-addon",
  "name": "My Dune Addon",
  "description": "A starter addon for Dune Docker Console.",
  "author": "Your Name",
  "version": "0.1.0",
  "type": "ui",
  "entry": {
    "navigation": "My Addon",
    "path": "web/index.html"
  },
  "permissions": {
    "players": ["read"],
    "database": ["read"]
  }
}
```

Use a unique lowercase `id`, for example `server-notes`, `player-inspector`, or `landsraad-helper`.

## Permissions

Current permission keys:

| Permission | Allows |
| --- | --- |
| `players:read` | Read player summary data exposed by the console. |
| `database:read` | Run read-only database queries through the console bridge. |
| `database:write` | Run write database statements through the console bridge. The console creates a database backup first. |
| `server:status` | Read server status data when supported. |
| `server:restart` | Restart services when supported. |
| `files:addon-data` | Store addon-owned data when supported. |
| `broadcast:send` | Send in-game broadcasts when supported. |

Request only the permissions your addon actually needs.

## Bridge Requests

The helper in `web/src/addon.js` sends bridge requests to the console:

```js
const players = await DuneAddon.request("leadership.players.list");

const rows = await DuneAddon.request("database.query", {
  query: "select player_id, player_name from dune.players limit 10"
});
```

Read-only SQL should use `database.query`. Write SQL must use `database.execute` and requires `database:write`.

## Community Index Entry

After creating a GitHub Release and uploading your `.zip`, add an entry to the community addons repository:

```json
{
  "id": "my-dune-addon",
  "name": "My Dune Addon",
  "description": "A starter addon for Dune Docker Console.",
  "author": "Your Name",
  "version": "0.1.0",
  "sourceUrl": "https://github.com/YourName/my-dune-addon",
  "downloadUrl": "https://github.com/YourName/my-dune-addon/releases/download/v0.1.0/my-dune-addon-0.1.0.zip",
  "sha256": "replace-with-package-sha256"
}
```

`scripts/package.sh` prints the SHA-256 hash after it creates the `.zip`.

## Local Preview

You can open `web/index.html` directly in a browser for layout work. Bridge requests only work when the addon is installed and opened inside Dune Docker Console.
