const INVENTORY_UNCHANGED_RE = /inventory stack did not increase/i;

export function classifyGrantResult(result = {}) {
  if (!result.ok) return "RETRY";
  if (INVENTORY_UNCHANGED_RE.test(String(result.stderr || ""))) return "UNCERTAIN";
  return "SUCCESS";
}
