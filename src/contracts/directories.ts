export type DirectorySessionsSort = "date" | "tokens" | "messages";

export interface DirectoryEntryContract {
  rawDirectory: string;
  prettyDirectory: string;
  worktree: string;
  prettyWorktree: string;
  sessionCount: number;
}

export interface RepoGroupContract {
  name: string;
  rawWorktree: string;
  prettyWorktree: string;
  iconColor: string | null;
  totalCount: number;
  latestTime: string;
  directories: DirectoryEntryContract[];
}

export interface DirectoriesContract {
  kind: "directories.list";
  generatedAt: string;
  repoGroups: RepoGroupContract[];
}

export interface DirectorySessionContract {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalTokens: number;
  subagentCount: number;
  durationMs: number;
  summary: {
    additions: number;
    deletions: number;
    files: number;
  };
}

export interface DirectorySessionsContract {
  kind: "directory.sessions";
  generatedAt: string;
  directory: string;
  sort: {
    selected: DirectorySessionsSort;
    options: DirectorySessionsSort[];
  };
  filter: {
    query: string;
  };
  sessions: DirectorySessionContract[];
}
