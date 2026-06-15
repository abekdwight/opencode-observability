import {
  EXPORT_SCHEMA_VERSION,
  type ExportContextWindowContract,
  type ExportEventsContract,
  type ExportLineageContract,
  type ExportMessageBundleContract,
  type ExportMessageBundlesContract,
  type ExportModelContract,
  type ExportPartContract,
  type ExportPartsContract,
  type ExportSessionsContract,
  findForbiddenFieldPaths,
  isExportPartType,
} from "../../contracts/export.js";
import type { Database } from "../../lib/sqlite.js";
import {
  countExportableMessages,
  type ExportMessageRecord,
  type ExportPartRecord,
  getExportableMessageById,
  getExportSession,
  getPartById,
  getTriggerMessageIdForChildSession,
  listExportableMessages,
  listExportRootSessions,
  listPartsForMessages,
} from "../../repositories/export/export.repository.js";

const EXPORT_SOURCE = {
  instanceId: "opencode-observability",
  exportNamespace: "db",
} as const;

function toIso(value: number | null): string {
  return new Date(value ?? 0).toISOString();
}

function toOptionalModel(
  message: ExportMessageRecord,
): ExportModelContract | undefined {
  if (!message.provider_id && !message.model_id && !message.agent)
    return undefined;
  return {
    providerId: message.provider_id ?? "unknown",
    modelId: message.model_id ?? "unknown",
    agent: message.agent ?? null,
  };
}

function buildLineage(
  messageId: string,
  sessionId: string,
  childSessionIds: string[],
  triggerMessageId: string | null,
): ExportLineageContract {
  return {
    triggerMessageId:
      triggerMessageId && triggerMessageId !== messageId
        ? triggerMessageId
        : null,
    childSessionIds: childSessionIds.filter((id) => id !== sessionId),
  };
}

function toPart(
  part: ExportPartRecord,
  partIndex: number,
): ExportPartContract | null {
  const parsed = JSON.parse(part.data) as Record<string, unknown>;
  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (!isExportPartType(type)) return null;

  if (type === "text") {
    if (typeof parsed.text !== "string") return null;
    return {
      partId: part.id,
      partIndex,
      type,
      text: parsed.text,
    };
  }

  if (type === "tool") {
    const toolName = typeof parsed.tool === "string" ? parsed.tool : "unknown";
    const state =
      parsed.state && typeof parsed.state === "object"
        ? (parsed.state as Record<string, unknown>)
        : {};
    const tool = {
      name: toolName,
      status: typeof state.status === "string" ? state.status : "unknown",
      input: state.input,
      output: state.output,
      error: state.error,
    };
    const violations = findForbiddenFieldPaths(tool);
    if (violations.length > 0) {
      throw new Error(
        `forbidden export fields in tool payload: ${violations.join(", ")}`,
      );
    }
    return {
      partId: part.id,
      partIndex,
      type,
      tool,
    };
  }

  if (type === "reasoning") {
    if (typeof parsed.text !== "string") return null;
    const time =
      parsed.time && typeof parsed.time === "object"
        ? (parsed.time as Record<string, unknown>)
        : null;
    return {
      partId: part.id,
      partIndex,
      type,
      text: parsed.text,
      compactedAt:
        typeof time?.compacted === "number" ? toIso(time.compacted) : undefined,
    };
  }

  if (type === "attachment_ref") {
    const attachment =
      parsed.attachment && typeof parsed.attachment === "object"
        ? (parsed.attachment as Record<string, unknown>)
        : null;
    if (
      !attachment ||
      typeof attachment.kind !== "string" ||
      typeof attachment.name !== "string"
    ) {
      return null;
    }
    return {
      partId: part.id,
      partIndex,
      type,
      attachment: {
        kind: attachment.kind,
        name: attachment.name,
        path: typeof attachment.path === "string" ? attachment.path : undefined,
        mimeType:
          typeof attachment.mimeType === "string"
            ? attachment.mimeType
            : undefined,
      },
    };
  }

  const systemMeta =
    parsed.systemMeta && typeof parsed.systemMeta === "object"
      ? (parsed.systemMeta as Record<string, unknown>)
      : null;
  if (!systemMeta) return null;
  const kind = typeof systemMeta.kind === "string" ? systemMeta.kind : "";
  if (
    !["subagent_link", "delivery_marker", "source_annotation"].includes(kind)
  ) {
    return null;
  }
  const violations = findForbiddenFieldPaths(systemMeta);
  if (violations.length > 0) {
    throw new Error(
      `forbidden export fields in system_meta payload: ${violations.join(", ")}`,
    );
  }
  return {
    partId: part.id,
    partIndex,
    type,
    systemMeta: {
      kind: kind as "subagent_link" | "delivery_marker" | "source_annotation",
      childSessionIds: Array.isArray(systemMeta.childSessionIds)
        ? systemMeta.childSessionIds.filter(
            (id): id is string => typeof id === "string",
          )
        : undefined,
      triggerMessageId:
        typeof systemMeta.triggerMessageId === "string"
          ? systemMeta.triggerMessageId
          : undefined,
      marker:
        typeof systemMeta.marker === "string" ? systemMeta.marker : undefined,
      annotation:
        typeof systemMeta.annotation === "string"
          ? systemMeta.annotation
          : undefined,
    },
  };
}

function getChildSessionIds(parts: ExportPartRecord[]): string[] {
  const ids = new Set<string>();
  for (const part of parts) {
    const parsed = JSON.parse(part.data) as Record<string, unknown>;
    if (parsed.type !== "tool") continue;
    const state = parsed.state;
    if (!state || typeof state !== "object") continue;
    const metadata = (state as Record<string, unknown>).metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const sessionId = (metadata as Record<string, unknown>).sessionId;
    if (typeof sessionId === "string") ids.add(sessionId);
  }
  return Array.from(ids);
}

function buildBundleWithTrigger(
  db: Database,
  message: ExportMessageRecord,
  sessionMessageIndex: number,
  parts: ExportPartRecord[],
): ExportMessageBundleContract {
  const childSessionIds = getChildSessionIds(parts);
  const exportParts = parts
    .map((part, index) => toPart(part, index))
    .filter((part): part is ExportPartContract => part !== null);
  const triggerMessageId = message.parent_id
    ? getTriggerMessageIdForChildSession(db, message.session_id)
    : null;

  return {
    bundleId: message.id,
    sessionId: message.session_id,
    parentSessionId: message.parent_id,
    messageId: message.id,
    role: message.role,
    createdAt: toIso(message.source_created ?? message.time_created),
    updatedAt: toIso(message.source_completed ?? message.time_updated),
    ordering: { sessionMessageIndex },
    source: { ...EXPORT_SOURCE },
    model: toOptionalModel(message),
    lineage: buildLineage(
      message.id,
      message.session_id,
      childSessionIds,
      triggerMessageId,
    ),
    parts: exportParts,
  };
}

export function buildExportSessionsContract(
  db: Database,
  filters: { worktree?: string } = {},
): ExportSessionsContract {
  return {
    kind: "export.sessions",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cursor: null,
    nextCursor: null,
    items: listExportRootSessions(db, filters).map((session) => ({
      sessionId: session.id,
      parentSessionId: session.parent_id,
      title: session.title,
      directory: session.directory,
      worktree: session.worktree,
      createdAt: toIso(session.time_created),
      updatedAt: toIso(session.time_updated),
      messageCount: countExportableMessages(db, session.id),
    })),
  };
}

export function buildExportMessageBundlesBySession(
  db: Database,
  sessionId: string,
): ExportMessageBundlesContract | null {
  const session = getExportSession(db, sessionId);
  if (!session) return null;

  const messages = listExportableMessages(db, sessionId);
  const parts = listPartsForMessages(
    db,
    messages.map((message) => message.id),
  );
  const partsByMessage = new Map<string, ExportPartRecord[]>();
  for (const part of parts) {
    const existing = partsByMessage.get(part.message_id) ?? [];
    existing.push(part);
    partsByMessage.set(part.message_id, existing);
  }

  return {
    kind: "export.message_bundles",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cursor: null,
    nextCursor: null,
    items: messages.map((message, index) =>
      buildBundleWithTrigger(
        db,
        message,
        index + 1,
        partsByMessage.get(message.id) ?? [],
      ),
    ),
  };
}

export function buildExportPartById(
  db: Database,
  partId: string,
): ExportPartsContract | null {
  const part = getPartById(db, partId);
  if (!part) return null;
  const messageParts = listPartsForMessages(db, [part.message_id]);
  const partIndex = messageParts.findIndex((item) => item.id === part.id);
  const exportPart = toPart(part, partIndex);
  if (!exportPart) {
    throw new Error(`unsupported export part type for part ${partId}`);
  }

  return {
    kind: "export.parts",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cursor: null,
    nextCursor: null,
    items: [
      {
        sessionId: part.session_id,
        parentSessionId: part.parent_id,
        messageId: part.message_id,
        part: exportPart,
      },
    ],
  };
}

export function buildExportEventsContract(): ExportEventsContract {
  return {
    kind: "export.events",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cursor: null,
    nextCursor: null,
    items: [],
  };
}

function previewFromBundle(bundle: ExportMessageBundleContract): string | null {
  const textPart = bundle.parts.find(
    (part): part is Extract<ExportPartContract, { type: "text" }> =>
      part.type === "text",
  );
  return textPart?.text ?? null;
}

export function buildExportContextWindow(
  db: Database,
  sessionId: string,
  aroundMessageId: string,
  before: number,
  after: number,
): ExportContextWindowContract | null {
  const sessionBundles = buildExportMessageBundlesBySession(db, sessionId);
  if (!sessionBundles) return null;
  const index = sessionBundles.items.findIndex(
    (item) => item.messageId === aroundMessageId,
  );
  if (index < 0) return null;

  const start = Math.max(0, index - before);
  const end = Math.min(sessionBundles.items.length, index + after + 1);
  const items = sessionBundles.items.slice(start, end).map((bundle) => ({
    messageId: bundle.messageId,
    role: bundle.role,
    preview: previewFromBundle(bundle),
  }));

  return {
    kind: "export.context_window",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    aroundMessageId,
    before,
    after,
    items,
  };
}

export function buildExportMessageBundleById(
  db: Database,
  messageId: string,
): ExportMessageBundlesContract | null {
  const message = getExportableMessageById(db, messageId);
  if (!message) return null;

  const sessionMessages = listExportableMessages(db, message.session_id);
  const messageIndex = sessionMessages.findIndex(
    (item) => item.id === message.id,
  );
  const parts = listPartsForMessages(db, [message.id]);

  return {
    kind: "export.message_bundles",
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    cursor: null,
    nextCursor: null,
    items: [buildBundleWithTrigger(db, message, messageIndex + 1, parts)],
  };
}
