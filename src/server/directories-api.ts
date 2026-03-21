import { Hono } from "hono";
import type {
  DirectoriesContract,
  DirectorySessionsContract,
  DirectorySessionsSort,
} from "../contracts/directories.js";
import { listRepoGroups } from "../services/directories/directories.service.js";
import { buildDirectorySessionsView } from "../services/directories/directory-sessions.service.js";

const DIRECTORY_SESSIONS_SORT_OPTIONS: DirectorySessionsSort[] = [
  "date",
  "tokens",
  "messages",
];

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function decodeDirectoryParam(rawDirectory: string): string {
  try {
    return decodeURIComponent(rawDirectory);
  } catch {
    return rawDirectory;
  }
}

function normalizeSort(rawSort: string | undefined): DirectorySessionsSort {
  if (rawSort === "tokens" || rawSort === "messages") {
    return rawSort;
  }
  return "date";
}

function normalizeFilter(rawFilter: string | undefined): string {
  return typeof rawFilter === "string" ? rawFilter.trim() : "";
}

function compareByDateDesc(
  a: { createdAtMs: number; id: string },
  b: { createdAtMs: number; id: string },
): number {
  return b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id);
}

function buildDirectoriesContract(): DirectoriesContract {
  const repoGroups = listRepoGroups().map((repoGroup) => ({
    name: repoGroup.name,
    rawWorktree: repoGroup.rawWorktree,
    prettyWorktree: repoGroup.prettyWorktree,
    iconColor: repoGroup.iconColor,
    totalCount: repoGroup.totalCount,
    latestTime: toIso(asNumber(repoGroup.latestTime)),
    directories: Array.from(repoGroup.dirs.entries())
      .map(([prettyDirectory, directoryInfo]) => ({
        rawDirectory: directoryInfo.rawDir,
        prettyDirectory,
        sessionCount: directoryInfo.count,
      }))
      .sort(
        (a, b) =>
          b.sessionCount - a.sessionCount ||
          a.prettyDirectory.localeCompare(b.prettyDirectory),
      ),
  }));

  return {
    kind: "directories.list",
    generatedAt: new Date().toISOString(),
    repoGroups,
  };
}

function buildDirectorySessionsContract(
  directory: string,
  sort: DirectorySessionsSort,
  filter: string,
): DirectorySessionsContract {
  const view = buildDirectorySessionsView(directory);
  const normalizedFilter = filter.toLowerCase();

  const sessionRows = view.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    createdAtMs: asNumber(session.time_created),
    updatedAtMs: asNumber(session.time_updated),
    messageCount: view.msgCountMap.get(session.id) ?? 0,
    totalTokens: view.tokenMap.get(session.id) ?? 0,
    subagentCount: view.subCountMap.get(session.id) ?? 0,
    durationMs: view.durationMap.get(session.id) ?? 0,
    summary: {
      additions: asNumber(session.summary_additions),
      deletions: asNumber(session.summary_deletions),
      files: asNumber(session.summary_files),
    },
  }));

  const filteredRows = normalizedFilter
    ? sessionRows.filter((session) =>
        session.title.toLowerCase().includes(normalizedFilter),
      )
    : sessionRows;

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sort === "tokens") {
      return b.totalTokens - a.totalTokens || compareByDateDesc(a, b);
    }

    if (sort === "messages") {
      return b.messageCount - a.messageCount || compareByDateDesc(a, b);
    }

    return compareByDateDesc(a, b);
  });

  return {
    kind: "directory.sessions",
    generatedAt: new Date().toISOString(),
    directory: view.directory,
    sort: {
      selected: sort,
      options: DIRECTORY_SESSIONS_SORT_OPTIONS,
    },
    filter: {
      query: filter,
    },
    sessions: sortedRows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: toIso(row.createdAtMs),
      updatedAt: toIso(row.updatedAtMs),
      messageCount: row.messageCount,
      totalTokens: row.totalTokens,
      subagentCount: row.subagentCount,
      durationMs: row.durationMs,
      summary: row.summary,
    })),
  };
}

export const directoriesApi = new Hono()
  .get("/directories", (c) => c.json(buildDirectoriesContract()))
  .get("/dir/:directory{.+}", (c) => {
    const directory = decodeDirectoryParam(c.req.param("directory"));
    const sort = normalizeSort(c.req.query("sort"));
    const filter = normalizeFilter(c.req.query("filter"));
    return c.json(buildDirectorySessionsContract(directory, sort, filter));
  });
