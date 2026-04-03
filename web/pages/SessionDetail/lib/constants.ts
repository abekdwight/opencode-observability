// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const COLLAPSE_HEIGHT = 300;

export const TOOL_ICONS: Record<string, string> = {
  read: "📄",
  grep: "🔍",
  bash: "⚡",
  glob: "📂",
  write: "✏️",
  edit: "✏️",
  apply_patch: "✏️",
  task: "🤖",
  background_output: "🤖",
  webfetch: "🌐",
  websearch_web_search_exa: "🌐",
  lsp_diagnostics: "🔧",
  todowrite: "📋",
  skill: "⚙️",
};

export type FilterMode = "all" | "user" | "assistant";
export const FILTER_CYCLE: FilterMode[] = ["all", "user", "assistant"];
export const FILTER_LABELS: Record<FilterMode, string> = {
  all: "🧑‍💻🤖",
  user: "🧑‍💻",
  assistant: "🤖",
};

export const MERMAID_SELECTOR = "pre > code.language-mermaid";
export const MERMAID_MODAL_MIN_SCALE = 0.25;
export const MERMAID_MODAL_MAX_SCALE = 6;
