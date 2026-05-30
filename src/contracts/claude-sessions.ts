import type { SessionMessageContract } from "./session.js";

export interface ClaudeSessionsContract {
  kind: "claude.sessions";
  generatedAt: string;
  source: {
    available: boolean;
    reason: "ok" | "missing-directory";
  };
  sessions: ClaudeSessionSummaryContract[];
}

export interface ClaudeSessionSummaryContract {
  id: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  createdAt: string;
  updatedAt: string;
  model: string | null;
  tokensUsed: number;
  messageCount: number;
  firstUserMessage: string;
  preview: string;
  transcriptExists: boolean;
}

export interface ClaudeSessionDetailContract {
  kind: "claude.session.detail";
  generatedAt: string;
  session: ClaudeSessionSummaryContract;
  transcript: {
    exists: boolean;
    parseWarningCount: number;
  };
  messages: SessionMessageContract[];
}
