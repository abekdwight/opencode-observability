import { getDb } from "../../lib/db.js";
import { calcSessionActiveDurations } from "../../lib/duration.js";
import { buildMessageTotalTokensSql } from "../../lib/message-token-sql.js";

const MESSAGE_TOTAL_TOKENS_SQL = buildMessageTotalTokensSql("m.data");

export interface DirectorySessionRow {
  id: string;
  title: string;
  time_created: number;
  time_updated: number;
  summary_additions: number;
  summary_deletions: number;
  summary_files: number;
}

export interface DirectorySessionsView {
  directory: string;
  sessions: DirectorySessionRow[];
  msgCountMap: Map<string, number>;
  tokenMap: Map<string, number>;
  subCountMap: Map<string, number>;
  durationMap: Map<string, number>;
}

export function buildDirectorySessionsView(
  directory: string,
): DirectorySessionsView {
  const db = getDb();
  try {
    const sessions = db
      .prepare(`
      SELECT s.id, s.title, s.time_created, s.time_updated,
             s.summary_additions, s.summary_deletions, s.summary_files
      FROM session s
      WHERE s.parent_id IS NULL
        AND s.directory = ?
      ORDER BY s.time_created DESC
      LIMIT 50
    `)
      .all(directory) as DirectorySessionRow[];

    if (sessions.length === 0) {
      return {
        directory,
        sessions,
        msgCountMap: new Map(),
        tokenMap: new Map(),
        subCountMap: new Map(),
        durationMap: new Map(),
      };
    }

    const ids = sessions.map((session) => session.id);
    const placeholders = ids.map(() => "?").join(",");

    const msgCounts = db
      .prepare(`
      SELECT m.session_id, COUNT(*) as msg_count
      FROM message m WHERE m.session_id IN (${placeholders})
      GROUP BY m.session_id
    `)
      .all(...ids) as { session_id: string; msg_count: number }[];
    const msgCountMap = new Map(
      msgCounts.map((count) => [count.session_id, count.msg_count]),
    );

    const tokenRows = db
      .prepare(`
      SELECT m.session_id, COALESCE(SUM(${MESSAGE_TOTAL_TOKENS_SQL}), 0) AS total_tokens
      FROM message m
      WHERE m.session_id IN (${placeholders})
        AND json_extract(m.data, '$.role') = 'assistant'
      GROUP BY m.session_id
    `)
      .all(...ids) as { session_id: string; total_tokens: number }[];
    const tokenMap = new Map(
      tokenRows.map((row) => [row.session_id, row.total_tokens]),
    );

    const subCounts = db
      .prepare(`
      SELECT parent_id, COUNT(*) as cnt
      FROM session
      WHERE parent_id IN (${placeholders})
      GROUP BY parent_id
    `)
      .all(...ids) as { parent_id: string; cnt: number }[];
    const subCountMap = new Map(
      subCounts.map((row) => [row.parent_id, row.cnt]),
    );

    const durationMap = calcSessionActiveDurations(db, ids);

    return {
      directory,
      sessions,
      msgCountMap,
      tokenMap,
      subCountMap,
      durationMap,
    };
  } finally {
    db.close();
  }
}
