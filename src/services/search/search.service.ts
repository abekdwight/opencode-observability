import { getDb } from "../../lib/db.js";
import { buildMessageTotalTokensSql } from "../../lib/message-token-sql.js";

const MESSAGE_TOTAL_TOKENS_SQL = buildMessageTotalTokensSql("m.data");

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number | string;
  snippet?: string;
}

export interface SearchResultRow extends SessionRow {
  messageCount: number;
  totalTokens: number;
}

export interface SearchServiceResult {
  query: string;
  searchTerms: string[];
  results: SearchResultRow[];
}

function splitSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}

function buildLikePattern(term: string): string {
  return `%${escapeLikeWildcards(term)}%`;
}

function buildAndSearchClause(searchTerms: string[]): {
  whereClause: string;
  params: string[];
} {
  const params = searchTerms.flatMap((term) => {
    const like = buildLikePattern(term);
    return [like, like];
  });

  const whereClause = searchTerms
    .map(
      () => `(
      lower(s.title) LIKE lower(?) ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM part p
        WHERE p.session_id = s.id
          AND json_extract(p.data, '$.type') = 'text'
          AND lower(json_extract(p.data, '$.text')) LIKE lower(?) ESCAPE '\\'
      )
    )`,
    )
    .join(" AND ");

  return { whereClause, params };
}

function findFirstMatchIndex(text: string, searchTerms: string[]): number {
  const normalizedText = text.toLowerCase();
  let bestIndex = Number.POSITIVE_INFINITY;

  for (const term of searchTerms) {
    const idx = normalizedText.indexOf(term.toLowerCase());
    if (idx >= 0 && idx < bestIndex) {
      bestIndex = idx;
    }
  }

  return Number.isFinite(bestIndex) ? bestIndex : -1;
}

function countTermMatches(text: string, searchTerms: string[]): number {
  const normalizedText = text.toLowerCase();
  return searchTerms.reduce(
    (count, term) =>
      count + (normalizedText.includes(term.toLowerCase()) ? 1 : 0),
    0,
  );
}

function extractSnippet(text: string, searchTerms: string[]): string | null {
  const firstMatchIndex = findFirstMatchIndex(text, searchTerms);
  if (firstMatchIndex < 0) return null;

  const start = Math.max(0, firstMatchIndex - 40);
  return text.slice(start, start + 120).trim();
}

function fetchSessionSnippet(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  searchTerms: string[],
): string | null {
  if (!searchTerms.length) return null;

  const anyMatchClause = searchTerms
    .map(
      () => `lower(json_extract(p.data, '$.text')) LIKE lower(?) ESCAPE '\\'`,
    )
    .join(" OR ");

  const rows = db
    .prepare(`
    SELECT json_extract(p.data, '$.text') AS text
    FROM part p
    WHERE p.session_id = ?
      AND json_extract(p.data, '$.type') = 'text'
      AND (${anyMatchClause})
    LIMIT 12
  `)
    .all(sessionId, ...searchTerms.map(buildLikePattern)) as {
    text: string | null;
  }[];

  const bestMatch = rows
    .map((row) => {
      if (!row.text) return null;
      return {
        text: row.text,
        score: countTermMatches(row.text, searchTerms),
        firstMatchIndex: findFirstMatchIndex(row.text, searchTerms),
      };
    })
    .filter(
      (row): row is { text: string; score: number; firstMatchIndex: number } =>
        row !== null && row.firstMatchIndex >= 0,
    )
    .sort(
      (a, b) => b.score - a.score || a.firstMatchIndex - b.firstMatchIndex,
    )[0];

  return bestMatch ? extractSnippet(bestMatch.text, searchTerms) : null;
}

export function buildSearchServiceResult(query: string): SearchServiceResult {
  const trimmedQuery = query.trim();
  const searchTerms = splitSearchTerms(trimmedQuery);

  if (!trimmedQuery) {
    return {
      query: trimmedQuery,
      searchTerms,
      results: [],
    };
  }

  const db = getDb();
  try {
    const { whereClause, params } = buildAndSearchClause(searchTerms);

    const rows = db
      .prepare(`
      SELECT id, title, directory, time_created
      FROM session s
      WHERE s.parent_id IS NULL
        AND (${whereClause})
      ORDER BY s.time_created DESC
      LIMIT 30
    `)
      .all(...params) as SessionRow[];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const msgCountMap = new Map<string, number>();
    const tokenMap = new Map<string, number>();

    if (ids.length > 0) {
      const msgCounts = db
        .prepare(`
        SELECT m.session_id, COUNT(*) AS msg_count
        FROM message m WHERE m.session_id IN (${placeholders})
        GROUP BY m.session_id
      `)
        .all(...ids) as { session_id: string; msg_count: number }[];
      for (const row of msgCounts)
        msgCountMap.set(row.session_id, row.msg_count);

      const tokenRows = db
        .prepare(`
        SELECT m.session_id, COALESCE(SUM(${MESSAGE_TOTAL_TOKENS_SQL}), 0) AS total_tokens
        FROM message m
        WHERE m.session_id IN (${placeholders})
          AND json_extract(m.data, '$.role') = 'assistant'
        GROUP BY m.session_id
      `)
        .all(...ids) as { session_id: string; total_tokens: number }[];
      for (const row of tokenRows)
        tokenMap.set(row.session_id, row.total_tokens);
    }

    const results = rows.map<SearchResultRow>((row) => ({
      ...row,
      snippet: fetchSessionSnippet(db, row.id, searchTerms) ?? undefined,
      messageCount: msgCountMap.get(row.id) || 0,
      totalTokens: tokenMap.get(row.id) || 0,
    }));

    return {
      query: trimmedQuery,
      searchTerms,
      results,
    };
  } finally {
    db.close();
  }
}
