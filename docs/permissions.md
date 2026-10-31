# Permissions

Server owners review addon permissions before installing an addon. Keep permissions narrow and easy to understand.

## Supported Permission Keys

| Permission | Allows |
| --- | --- |
| `players:read` | Read player summaries, identities and supported progression data. |
| `ops:read` | Read operations, activity, economy and container-health summaries. |
| `database:read` | Run read-only database queries through the console bridge. |
| `database:write` | Run write database statements through the console bridge. The console creates a database backup first. |
| `admin:grant-items` | Deliver items through the Console's validated item-grant action. |
| `rewards:grant` | Queue and inspect supported rewards through the Console's delivery service. |
| `players:message` | Queue and inspect private messages to individual players. |
| `server:status` | Read hardware telemetry through `server.hardware.status`. |
| `server:restart` | Reserved for restarting services. |
| `files:addon-data` | Read and write persistent JSON scoped to the addon ID. |
| `broadcast:send` | Reserved for sending in-game broadcasts. |
| `scheduler:server` | Legacy scheduler permission; not a general addon scheduling API. |

Declaring a permission does not implement an action or approve access. The
server owner must approve requested permissions when installing or updating an
addon. Prefer typed player, storage and reward actions where they satisfy the
addon requirement.

## Examples

Read players only:

```json
"permissions": {
  "players": ["read"]
}
```

Read database only:

```json
"permissions": {
  "database": ["read"]
}
```

Read and write database:

```json
"permissions": {
  "database": ["read", "write"]
}
```
