export function parseEnvFile(contents = '') {
  const values = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function buildDatabaseConfig(processEnv = {}, fileValues = {}) {
  if (processEnv.DATABASE_URL) {
    return {
      pool: { connectionString: processEnv.DATABASE_URL, connectionTimeoutMillis: 2000 },
      display: 'DATABASE_URL'
    };
  }
  const value = (key, fallback) => processEnv[key] || fileValues[key] || fallback;
  const portValue = value('DUNE_DB_PORT', value('POSTGRES_PORT', '15432'));
  if (!/^[0-9]{1,5}$/.test(String(portValue)) || Number(portValue) < 1 || Number(portValue) > 65535) {
    throw new Error('DUNE_DB_PORT or POSTGRES_PORT must be a valid TCP port');
  }
  const host = value('DUNE_DB_HOST', '127.0.0.1');
  const database = value('DUNE_DB_NAME', 'dune');
  const user = value('DUNE_DB_USER', 'dune');
  return {
    pool: {
      host,
      port: Number(portValue),
      database,
      user,
      password: value('DUNE_DB_PASSWORD', 'dune'),
      connectionTimeoutMillis: 2000
    },
    display: `${user}@${host}:${portValue}/${database}`
  };
}
