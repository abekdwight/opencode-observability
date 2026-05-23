export interface MonitorPromptCommandContract {
  id: string;
  sessionId: string;
  text: string;
  createdAt: string;
}

export interface MonitorPromptEnqueueRequestContract {
  text: string;
}

export interface MonitorPromptEnqueueResponseContract {
  accepted: true;
  commandId: string;
  sessionId: string;
}

export interface MonitorPromptPollRequestContract {
  sessionIds?: string[];
}

export interface MonitorPromptPollResponseContract {
  commands: MonitorPromptCommandContract[];
}

export interface MonitorPromptAckRequestContract {
  commandIds: string[];
}

export interface MonitorPromptAckResponseContract {
  acknowledged: number;
}
