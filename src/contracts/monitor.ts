import type { SignalBadge, SignalLevel } from "./shared.js";

export interface MonitorSessionSummary {
  id: string;
  title: string;
  directory: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;
  signalLevel: SignalLevel;
}

export interface MonitorSnapshotContract {
  kind: "monitor.snapshot";
  generatedAt: string;
  activeRootSessions: MonitorSessionSummary[];
  compactionCounts: {
    main: number;
    subagent: number;
    total: number;
  };
  signalBadges: SignalBadge[];
}
