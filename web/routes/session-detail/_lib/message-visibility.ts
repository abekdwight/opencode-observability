// ---------------------------------------------------------------------------
// Pure helper: determines whether a session message has any visible content.
// Used by MessageList to skip rendering fully-empty message wrappers.
// ---------------------------------------------------------------------------

export interface VisibleContentParams {
  text: string;
  toolsVisible: boolean;
  toolCallsCount: number;
  fileDiffsCount: number;
  subagentLinksCount: number;
}

/**
 * Returns true when the message has at least one piece of content that should
 * be rendered in the session detail view.
 *
 * Priority order (short-circuit):
 * 1. Non-whitespace text → always visible
 * 2. Tool calls with visible tools → visible
 * 3. File diffs → visible
 * 4. Subagent links → visible
 * 5. Otherwise → not visible
 */
export function hasVisibleMessageContent(
  params: VisibleContentParams,
): boolean {
  // Text is always visible when non-empty (trim whitespace)
  if (params.text.trim().length > 0) return true;

  // Tool calls when tools are visible
  if (params.toolCallsCount > 0 && params.toolsVisible) return true;

  // File diffs
  if (params.fileDiffsCount > 0) return true;

  // Subagent links
  if (params.subagentLinksCount > 0) return true;

  return false;
}
