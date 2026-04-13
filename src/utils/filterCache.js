/**
 * In-memory TTL cache for expensive filter/facet queries.
 *
 * With lakhs of products the getDynamicFilters endpoint runs 6 parallel
 * aggregation queries. This cache ensures identical requests within the
 * TTL window (default 60 s) are served from memory instead of hitting
 * the database every time a user opens the filter sidebar.
 *
 * Gracefully degrades: if the cache is full it evicts stale entries first,
 * then oldest entries. No external dependency required.
 */

const store = new Map();
const MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 60_000;

function buildKey(params) {
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      const v = params[k];
      if (v != null && v !== "" && (!Array.isArray(v) || v.length > 0)) {
        acc[k] = Array.isArray(v) ? [...v].sort().join(",") : String(v);
      }
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    store.delete(key);
    return null;
  }
  return entry.val;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.exp) store.delete(k);
    }
    if (store.size >= MAX_ENTRIES) {
      const toDelete = Math.ceil(store.size * 0.2);
      let i = 0;
      for (const k of store.keys()) {
        if (i++ >= toDelete) break;
        store.delete(k);
      }
    }
  }
  store.set(key, { val: value, exp: Date.now() + ttlMs });
}

function invalidate(pattern) {
  if (!pattern) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.includes(pattern)) store.delete(k);
  }
}

module.exports = { buildKey, get, set, invalidate };
