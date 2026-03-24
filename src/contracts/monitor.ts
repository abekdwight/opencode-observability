export interface MonitorSignalBadge {
  key: string;
  label: string;
  count: number;
}

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
  signalBadges: MonitorSignalBadge[];
}
