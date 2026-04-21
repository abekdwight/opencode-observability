export interface Command {
  id: string;
  label: string;
  category: "navigation" | "action" | "search";
  keywords?: string[];
  icon?: string;
  shortcut?: string;
}

export const navigationCommands: Command[] = [
  {
    id: "go-dashboard",
    label: "Go to Dashboard",
    category: "navigation",
    keywords: ["home"],
  },
  {
    id: "go-monitor",
    label: "Go to Monitor",
    category: "navigation",
  },
  {
    id: "go-search",
    label: "Go to Search",
    category: "navigation",
  },
  {
    id: "go-directories",
    label: "Go to Directories",
    category: "navigation",
  },
  {
    id: "go-tool-errors",
    label: "Go to Tool Errors",
    category: "navigation",
  },
];

export const actionCommands: Command[] = [
  {
    id: "toggle-theme",
    label: "Toggle Theme",
    category: "action",
    keywords: ["dark", "light"],
  },
  {
    id: "toggle-mermaid-theme",
    label: "Toggle Mermaid Theme",
    category: "action",
    keywords: ["diagram", "elk", "layout", "readability"],
  },
];
