export const EXPORT_SCHEMA_VERSION = "v1" as const;

export const EXPORT_PART_TYPES = [
  "text",
  "tool",
  "reasoning",
  "attachment_ref",
  "system_meta",
] as const;

export type ExportPartType = (typeof EXPORT_PART_TYPES)[number];

export const EXPORT_FORBIDDEN_FIELDS = [
  "memoryThreadId",
  "chunkId",
  "chunkIds",
  "embeddingId",
  "embeddingIds",
  "vector",
  "vectorPayload",
  "retrievalScore",
  "retrievalScores",
  "recallRanking",
  "summary",
] as const;

export type ExportForbiddenField = (typeof EXPORT_FORBIDDEN_FIELDS)[number];

export function isExportPartType(value: string): value is ExportPartType {
  return (EXPORT_PART_TYPES as readonly string[]).includes(value);
}

export function findForbiddenFieldPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenFieldPaths(item, `${path}[${index}]`),
    );
  }

  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      const nextPath = `${path}.${key}`;
      const matches = (EXPORT_FORBIDDEN_FIELDS as readonly string[]).includes(
        key,
      )
        ? [nextPath]
        : [];
      return matches.concat(findForbiddenFieldPaths(nested, nextPath));
    },
  );
}

export interface ExportSourceContract {
  instanceId: string;
  exportNamespace: string;
}

export interface ExportModelContract {
  providerId: string;
  modelId: string;
  agent: string | null;
}

export interface ExportLineageContract {
  triggerMessageId: string | null;
  childSessionIds: string[];
}

export interface ExportOrderingContract {
  sessionMessageIndex: number;
}

export interface ExportTextPartContract {
  partId: string;
  partIndex: number;
  type: "text";
  text: string;
}

export interface ExportToolPartPayloadContract {
  name: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

export interface ExportToolPartContract {
  partId: string;
  partIndex: number;
  type: "tool";
  tool: ExportToolPartPayloadContract;
}

export interface ExportReasoningPartContract {
  partId: string;
  partIndex: number;
  type: "reasoning";
  text: string;
  compactedAt?: string;
}

export interface ExportAttachmentRefPartContract {
  partId: string;
  partIndex: number;
  type: "attachment_ref";
  attachment: {
    kind: string;
    name: string;
    path?: string;
    mimeType?: string;
  };
}

export interface ExportSystemMetaPartContract {
  partId: string;
  partIndex: number;
  type: "system_meta";
  systemMeta: {
    kind: "subagent_link" | "delivery_marker" | "source_annotation";
    childSessionIds?: string[];
    triggerMessageId?: string;
    marker?: string;
    annotation?: string;
  };
}

export type ExportPartContract =
  | ExportTextPartContract
  | ExportToolPartContract
  | ExportReasoningPartContract
  | ExportAttachmentRefPartContract
  | ExportSystemMetaPartContract;

export interface ExportPartItemContract {
  sessionId: string;
  parentSessionId: string | null;
  messageId: string;
  part: ExportPartContract;
}

export interface ExportMessageBundleContract {
  bundleId: string;
  sessionId: string;
  parentSessionId: string | null;
  messageId: string;
  role: "user" | "assistant";
  createdAt: string;
  updatedAt: string;
  ordering: ExportOrderingContract;
  source: ExportSourceContract;
  model?: ExportModelContract;
  lineage: ExportLineageContract;
  parts: ExportPartContract[];
}

export interface ExportSessionSummaryContract {
  sessionId: string;
  parentSessionId: string | null;
  title: string;
  directory: string;
  worktree: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ExportEnvelopeBase {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  cursor: string | null;
  nextCursor: string | null;
}

export interface ExportSessionsContract extends ExportEnvelopeBase {
  kind: "export.sessions";
  items: ExportSessionSummaryContract[];
}

export interface ExportMessageBundlesContract extends ExportEnvelopeBase {
  kind: "export.message_bundles";
  items: ExportMessageBundleContract[];
}

export interface ExportPartsContract extends ExportEnvelopeBase {
  kind: "export.parts";
  items: ExportPartItemContract[];
}

export interface ExportEventContract {
  eventId: string;
  type: string;
  at: string;
  target?: {
    sessionId?: string;
    messageId?: string;
    bundleId?: string;
    partId?: string;
  };
}

export interface ExportEventsContract extends ExportEnvelopeBase {
  kind: "export.events";
  items: ExportEventContract[];
}

export interface ExportContextWindowItemContract {
  messageId: string;
  role: "user" | "assistant";
  preview: string | null;
}

export interface ExportContextWindowContract {
  kind: "export.context_window";
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  aroundMessageId: string;
  before: number;
  after: number;
  items: ExportContextWindowItemContract[];
}

export interface ExportSessionNotFoundContract {
  kind: "export.session-not-found";
  sessionId: string;
}

export interface ExportMessageNotFoundContract {
  kind: "export.message-not-found";
  messageId: string;
}

export interface ExportPartNotFoundContract {
  kind: "export.part-not-found";
  partId: string;
}
