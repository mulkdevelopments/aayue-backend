/**
 * PostgreSQL E-string regex: split vendor "composite" colours into atomic tokens.
 * Examples: "Black/White", "Black and White", "Black & White", "Black, White", "Black+White"
 */
/** Pattern text as PostgreSQL regexp_* sees it (after string parsing). */
const PG_COMPOSITE_COLOR_SPLIT_REGEX =
  "(?i)(?:\\s*[/]\\s*|\\s+and\\s+|\\s+&\\s*|\\s*,\\s*|\\s*\\+\\s*)";

/**
 * For embedding in E'...' inside SQL built in JS: each `\` must be doubled or PG
 * eats `\s` / `\+` and regexp_split_to_array throws "quantifier operand invalid".
 */
const PG_COMPOSITE_COLOR_SPLIT_REGEX_E = PG_COMPOSITE_COLOR_SPLIT_REGEX.replace(
  /\\/g,
  "\\\\"
);

/**
 * Placeholder / junk colour strings (compare lowercase). Not shown in facets; variants that are
 * only these values are skipped for colour aggregation.
 */
const JUNK_COLOR_TOKENS_SQL_LIST = `'unknown', 'n/a', 'na', 'n/a.', 'none', '-', '--', 'other', 'misc', 'null', 'undefined', 'tbd', '???', '--select--'`;

const JUNK_COLOR_TOKENS_LOWER = new Set([
  "unknown",
  "n/a",
  "na",
  "n/a.",
  "none",
  "-",
  "--",
  "other",
  "misc",
  "null",
  "undefined",
  "tbd",
  "???",
  "--select--",
]);

/** Use with unnest output column alias `t` */
const SQL_EXCLUDE_JUNK_COLOR_TOKEN_T = `lower(trim(t)) NOT IN (${JUNK_COLOR_TOKENS_SQL_LIST})`;

/** Use on product_variants `pv` full colour field before split */
const SQL_EXCLUDE_JUNK_VARIANT_COLOR_ONLY_PV = `lower(trim(COALESCE(pv.normalized_color, pv.attributes->>'color', ''))) NOT IN (${JUNK_COLOR_TOKENS_SQL_LIST})`;

/**
 * Normalize colour filter query params (case-insensitive match against tokens).
 */
function normalizeColorFilterParams(colors) {
  if (!Array.isArray(colors)) return [];
  return colors
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean)
    .filter((c) => !JUNK_COLOR_TOKENS_LOWER.has(c));
}

/**
 * Match variant colour against selected tokens (lowercase). $paramIndex must be a text[] param.
 * @param {string} pvAlias - SQL alias for product_variants (e.g. pv, pv_c)
 * @param {number} paramIndex - 1-based placeholder index (e.g. after params.push)
 */
function sqlVariantMatchesColorParams(pvAlias, paramIndex) {
  const p = Number(paramIndex);
  const fullLc = `lower(trim(COALESCE(${pvAlias}.normalized_color, ${pvAlias}.attributes->>'color', '')))`;
  return `(
    (${fullLc} NOT IN (${JUNK_COLOR_TOKENS_SQL_LIST}) AND ${fullLc} = ANY($${p}::text[]))
    OR (
      NULLIF(TRIM(COALESCE(${pvAlias}.normalized_color, ${pvAlias}.attributes->>'color', '')), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(
          regexp_split_to_array(
            TRIM(COALESCE(${pvAlias}.normalized_color, ${pvAlias}.attributes->>'color')),
            E'${PG_COMPOSITE_COLOR_SPLIT_REGEX_E}'
          )
        ) AS color_split_tok
        WHERE NULLIF(TRIM(color_split_tok), '') IS NOT NULL
          AND lower(trim(color_split_tok)) NOT IN (${JUNK_COLOR_TOKENS_SQL_LIST})
          AND lower(trim(color_split_tok)) = ANY($${p}::text[])
      )
    )
  )`;
}

module.exports = {
  PG_COMPOSITE_COLOR_SPLIT_REGEX,
  PG_COMPOSITE_COLOR_SPLIT_REGEX_E,
  JUNK_COLOR_TOKENS_SQL_LIST,
  JUNK_COLOR_TOKENS_LOWER,
  SQL_EXCLUDE_JUNK_COLOR_TOKEN_T,
  SQL_EXCLUDE_JUNK_VARIANT_COLOR_ONLY_PV,
  normalizeColorFilterParams,
  sqlVariantMatchesColorParams,
};
