import type {
  HarnessDescriptorContract,
  HarnessSessionDetailContract,
  HarnessSessionSummaryContract,
  HarnessSourceContract,
} from "../../contracts/harness.js";

export interface HarnessSessionList {
  source: HarnessSourceContract;
  sessions: HarnessSessionSummaryContract[];
}

/**
 * Compatibility layer between one coding-agent CLI and the unified session
 * contracts. Each adapter owns its data source (DB / files) end to end and
 * must never fabricate data: fields a harness cannot provide stay null.
 */
export interface HarnessAdapter {
  descriptor: HarnessDescriptorContract;
  listSessions(): HarnessSessionList;
  getSessionDetail(id: string): HarnessSessionDetailContract | null;
}
