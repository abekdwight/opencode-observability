import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import { listRepoGroups } from "../services/directories/directories.service.js";
import {
  buildExportContextWindow,
  buildExportMessageBundleById,
  buildExportMessageBundlesBySession,
  buildExportPartById,
  buildExportSessionsContract,
} from "../services/export/export.service.js";
import { buildSearchServiceResult } from "../services/search/search.service.js";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
  };
};

const MCP_PROTOCOL_VERSION = "2025-06-18" as const;

function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mcpTextResult(structuredContent: unknown) {
  return {
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
    structuredContent,
    isError: false,
  };
}

function buildToolList() {
  return {
    tools: [
      {
        name: "list_repo_groups",
        title: "List repository groups",
        description: "List repository groups and their directories/worktrees.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "list_sessions",
        title: "List sessions",
        description: "List export sessions optionally filtered by worktree.",
        inputSchema: {
          type: "object",
          properties: {
            worktree: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "search_sessions",
        title: "Search sessions",
        description: "Search sessions by text query.",
        inputSchema: {
          type: "object",
          properties: {
            q: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "get_context_window",
        title: "Get context window",
        description: "Get a context window around a message within a session.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            aroundMessageId: { type: "string" },
            before: { type: "number" },
            after: { type: "number" },
          },
          required: ["sessionId", "aroundMessageId"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function buildResourceList() {
  return {
    resources: [
      {
        uri: "opencode://directories",
        name: "Directories",
        title: "Repository groups and directories",
        mimeType: "application/json",
      },
    ],
  };
}

function buildResourceTemplateList() {
  return {
    resourceTemplates: [
      {
        uriTemplate: "opencode://sessions?worktree={worktree}",
        name: "Sessions by worktree",
        title: "Export sessions for a worktree",
        mimeType: "application/json",
      },
      {
        uriTemplate: "opencode://sessions/{sessionId}/messages",
        name: "Session messages",
        title: "Messages for a session",
        mimeType: "application/json",
      },
      {
        uriTemplate: "opencode://messages/{messageId}",
        name: "Message bundle",
        title: "Single message bundle",
        mimeType: "application/json",
      },
      {
        uriTemplate: "opencode://parts/{partId}",
        name: "Message part",
        title: "Single message part",
        mimeType: "application/json",
      },
    ],
  };
}

function readResource(uri: string) {
  const db = getDb();
  try {
    if (uri === "opencode://directories") {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                kind: "directories.list",
                repoGroups: listRepoGroups().map((group) => ({
                  name: group.name,
                  rawWorktree: group.rawWorktree,
                  prettyWorktree: group.prettyWorktree,
                  iconColor: group.iconColor,
                  totalCount: group.totalCount,
                  latestTime: new Date(group.latestTime).toISOString(),
                  directories: Array.from(group.dirs.entries()).map(
                    ([prettyDirectory, directoryInfo]) => ({
                      rawDirectory: directoryInfo.rawDir,
                      prettyDirectory,
                      worktree: directoryInfo.worktree,
                      prettyWorktree: directoryInfo.prettyWorktree,
                      sessionCount: directoryInfo.count,
                    }),
                  ),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (uri.startsWith("opencode://sessions?")) {
      const parsed = new URL(uri);
      const worktree = parsed.searchParams.get("worktree")?.trim();
      const structured = buildExportSessionsContract(
        db,
        worktree ? { worktree } : {},
      );
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(structured, null, 2),
          },
        ],
      };
    }

    if (uri.startsWith("opencode://sessions/")) {
      const trimmed = uri.replace("opencode://sessions/", "");
      const [sessionId, tail] = trimmed.split("/");
      if (tail === "messages" && sessionId) {
        const structured = buildExportMessageBundlesBySession(db, sessionId);
        if (!structured) return null;
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(structured, null, 2),
            },
          ],
        };
      }
    }

    if (uri.startsWith("opencode://messages/")) {
      const messageId = uri.replace("opencode://messages/", "");
      const structured = buildExportMessageBundleById(db, messageId);
      if (!structured) return null;
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(structured, null, 2),
          },
        ],
      };
    }

    if (uri.startsWith("opencode://parts/")) {
      const partId = uri.replace("opencode://parts/", "");
      const structured = buildExportPartById(db, partId);
      if (!structured) return null;
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(structured, null, 2),
          },
        ],
      };
    }

    return null;
  } finally {
    db.close();
  }
}

function callTool(name: string, args: Record<string, unknown>) {
  if (name === "list_repo_groups") {
    const structured = {
      kind: "directories.list",
      repoGroups: listRepoGroups().map((group) => ({
        name: group.name,
        rawWorktree: group.rawWorktree,
        prettyWorktree: group.prettyWorktree,
        iconColor: group.iconColor,
        totalCount: group.totalCount,
        latestTime: new Date(group.latestTime).toISOString(),
        directories: Array.from(group.dirs.entries()).map(
          ([prettyDirectory, directoryInfo]) => ({
            rawDirectory: directoryInfo.rawDir,
            prettyDirectory,
            worktree: directoryInfo.worktree,
            prettyWorktree: directoryInfo.prettyWorktree,
            sessionCount: directoryInfo.count,
          }),
        ),
      })),
    };
    return mcpTextResult(structured);
  }

  if (name === "list_sessions") {
    const db = getDb();
    try {
      const worktree = asString(args.worktree)?.trim();
      return mcpTextResult(
        buildExportSessionsContract(db, worktree ? { worktree } : {}),
      );
    } finally {
      db.close();
    }
  }

  if (name === "search_sessions") {
    const q = asString(args.q)?.trim() ?? "";
    return mcpTextResult(buildSearchServiceResult(q));
  }

  if (name === "get_context_window") {
    const sessionId = asString(args.sessionId);
    const aroundMessageId = asString(args.aroundMessageId);
    if (!sessionId || !aroundMessageId) {
      return {
        content: [
          { type: "text", text: "sessionId and aroundMessageId are required" },
        ],
        isError: true,
      };
    }
    const db = getDb();
    try {
      const structured = buildExportContextWindow(
        db,
        sessionId,
        aroundMessageId,
        asNumber(args.before, 1),
        asNumber(args.after, 1),
      );
      if (!structured) {
        return {
          content: [{ type: "text", text: "context window not found" }],
          isError: true,
        };
      }
      return mcpTextResult(structured);
    } finally {
      db.close();
    }
  }

  return {
    content: [{ type: "text", text: `unknown tool: ${name}` }],
    isError: true,
  };
}

function handleMcpRequest(
  body: JsonRpcRequest,
): JsonRpcSuccess | JsonRpcFailure {
  const id = body.id ?? null;

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return failure(id, -32600, "Invalid Request");
  }

  const params = asObject(body.params);

  if (body.method === "initialize") {
    return success(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: "opencode-observability",
        version: "0.1.0",
      },
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
    });
  }

  if (body.method === "notifications/initialized") {
    return success(id, {});
  }

  if (body.method === "tools/list") {
    return success(id, buildToolList());
  }

  if (body.method === "resources/list") {
    return success(id, buildResourceList());
  }

  if (body.method === "resources/templates/list") {
    return success(id, buildResourceTemplateList());
  }

  if (body.method === "tools/call") {
    const name = asString(params.name);
    if (!name) return failure(id, -32602, "Missing tool name");
    return success(id, callTool(name, asObject(params.arguments)));
  }

  if (body.method === "resources/read") {
    const uri = asString(params.uri);
    if (!uri) return failure(id, -32602, "Missing resource uri");
    const result = readResource(uri);
    if (!result) return failure(id, -32002, "Resource not found");
    return success(id, result);
  }

  return failure(id, -32601, `Method not found: ${body.method}`);
}

export const mcpApi = new Hono()
  .post("/", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(failure(null, -32700, "Parse error"), 400);
    }
    return c.json(handleMcpRequest(payload as JsonRpcRequest));
  })
  .get("/", (c) =>
    c.json(
      {
        kind: "mcp.endpoint",
        protocolVersion: MCP_PROTOCOL_VERSION,
      },
      405,
    ),
  );
