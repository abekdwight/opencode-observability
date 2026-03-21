export const BUILTIN_TOOLS: Set<string> = new Set<string>([
  "read",
  "grep",
  "bash",
  "glob",
  "todowrite",
  "lsp_diagnostics",
  "apply_patch",
  "task",
  "background_output",
  "webfetch",
  "edit",
  "background_cancel",
  "write",
  "skill",
  "ast_grep_search",
  "session_search",
  "question",
  "session_info",
  "session_read",
  "lsp_symbols",
  "skill_mcp",
  "interactive_bash",
  "session_list",
  "lsp_find_references",
  "ast_grep_replace",
  "look_at",
  "todoread",
]);

export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.has(name);
}

export function extractMcpServerName(toolName: string): string | null {
  if (isBuiltinTool(toolName)) return null;

  const separator = toolName.indexOf("_");
  if (separator === -1) return "other";

  const serverName = toolName.slice(0, separator).trim();
  return serverName.length > 0 ? serverName : "other";
}
