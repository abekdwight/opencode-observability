import type { SessionMessageContract } from "./session.js";

export interface CodexSessionsContract {
  kind: "codex.sessions";
  generatedAt: string;
  source: {
    available: boolean;
    reason: "ok" | "missing-database";
  };
  sessions: CodexSessionSummaryContract[];
}

export interface CodexSessionSummaryContract {
  id: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  model: string | null;
  tokensUsed: number;
  firstUserMessage: string;
  preview: string;
  cliVersion: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  rolloutExists: boolean;
}

export interface CodexSessionDetailContract {
  kind: "codex.session.detail";
  generatedAt: string;
  session: CodexSessionSummaryContract;
  rollout: {
    exists: boolean;
    parseWarningCount: number;
  };
  messages: SessionMessageContract[];
}
