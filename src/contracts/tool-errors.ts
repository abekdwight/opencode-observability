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

export interface ToolErrorsContract {
  kind: "tool-errors.detail";
  generatedAt: string;
  tool: string;
  dailyErrorCounts: ToolErrorTimelinePointContract[];
  latestErrors: ToolErrorRecordContract[];
}
