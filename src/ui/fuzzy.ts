/**
 * A tiny deterministic fuzzy matcher for the command palette (BUILD-SPEC.md §4
 * Phase 4, §1 of BUILD-SPEC-2). Subsequence match with a score that rewards
 * contiguous runs, word-boundary starts, and an exact prefix — enough to make
 * "thp" find "Take-Home Pay" without pulling in a full search dependency.
 */

export interface FuzzyResult<T> {
  item: T;
  score: number;
}

/**
 * Score `query` against `text`. Returns null when `query` does not match.
 * Higher is better; a prefix/exact match scores highest. A multi-word query is
 * matched token-by-token (every token must appear), so "take home" finds
 * "Take-Home Pay" even though the literal string has a hyphen. An empty query
 * matches everything with a neutral score.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const t = text.toLowerCase();

  const tokens = q.split(/\s+/);
  if (tokens.length === 1) return scoreToken(tokens[0]!, t);

  let total = 0;
  for (const token of tokens) {
    const score = scoreToken(token, t);
    if (score === null) return null; // every word must match somewhere
    total += score;
  }
  return total;
}

/** Score a single whitespace-free token against `text` (already lowercased). */
function scoreToken(q: string, t: string): number | null {
  if (q.length === 0) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - (t.length - q.length);

  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    // Contiguous match with the previous hit is worth more.
    score += ti === prevMatch + 1 ? 10 : 3;
    // Matching at a word boundary (start, or after a space/hyphen) is worth more.
    const prevChar = ti > 0 ? t[ti - 1] : " ";
    if (prevChar === " " || prevChar === "-" || prevChar === "/") score += 8;
    prevMatch = ti;
    qi++;
  }
  if (qi < q.length) return null; // not all query chars matched in order
  // Prefer shorter targets so the tightest match wins ties.
  return score - t.length * 0.1;
}

/**
 * Rank `items` against `query` over each item's searchable text. Items that do
 * not match are dropped; the rest are sorted best-first. With an empty query
 * the original order is preserved.
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  textOf: (item: T) => string,
): FuzzyResult<T>[] {
  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    const score = fuzzyScore(query, textOf(item));
    if (score !== null) results.push({ item, score });
  }
  if (query.trim().length > 0) results.sort((a, b) => b.score - a.score);
  return results;
}
