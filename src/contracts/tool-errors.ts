export interface ToolErrorsPathParamsContract {
  tool: string;
}

export interface ToolErrorTimelinePointContract {
  day: string;
  count: number;
}

export interface ToolErrorRecordContract {
  timeCreated: number;
  sessionId: string;
  error: string;
}

export interface ToolErrorOverviewToolContract {
  tool: string;
  errorCount: number;
  totalCalls: number;
  errorRate: number;
}

export interface ToolErrorOverviewPatternContract {
  label: string;
  count: number;
}

export interface ToolErrorOverviewRecordContract
  extends ToolErrorRecordContract {
  tool: string;
}

export interface ToolErrorsOverviewContract {
  kind: "tool-errors.overview";
  generatedAt: string;
  windowDays: number;
  summary: {
    totalErrors: number;
    distinctTools: number;
    affectedSessions: number;
  };
  insights: string[];
  topTools: ToolErrorOverviewToolContract[];
  errorPatterns: ToolErrorOverviewPatternContract[];
  latestErrors: ToolErrorOverviewRecordContract[];
}

export interface ToolErrorsContract {
  kind: "tool-errors.detail";
  generatedAt: string;
  tool: string;
  dailyErrorCounts: ToolErrorTimelinePointContract[];
  latestErrors: ToolErrorRecordContract[];
}
