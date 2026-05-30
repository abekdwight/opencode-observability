import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { MermaidPreferencesProvider } from "./components/mermaid-preferences-provider";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import { ClaudeSessionDetail } from "./routes/claude-session-detail";
import { ClaudeSessions } from "./routes/claude-sessions";
import { CodexSessionDetail } from "./routes/codex-session-detail";
import { CodexSessions } from "./routes/codex-sessions";
import { Dashboard } from "./routes/dashboard";
import { Directories } from "./routes/directories/directories";
import { DirectorySessions } from "./routes/directory-sessions/directory-sessions";
import { Monitor } from "./routes/monitor/monitor";
import { Search } from "./routes/search/search";
import { SessionDetail } from "./routes/session-detail";
import { ToolErrors } from "./routes/tool-errors/tool-errors";
import "./styles/tailwind.css";

ReactDOM.createRoot(document.querySelector<HTMLDivElement>("#app")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <MermaidPreferencesProvider>
        <TooltipProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="monitor" element={<Monitor />} />
                <Route path="session/:sessionId" element={<SessionDetail />} />
                <Route path="codex-sessions" element={<CodexSessions />} />
                <Route
                  path="codex-sessions/:id"
                  element={<CodexSessionDetail />}
                />
                <Route path="claude-sessions" element={<ClaudeSessions />} />
                <Route
                  path="claude-sessions/:id"
                  element={<ClaudeSessionDetail />}
                />
                <Route path="directories" element={<Directories />} />
                <Route path="dir/:directory" element={<DirectorySessions />} />
                <Route path="search" element={<Search />} />
                <Route path="tool-errors" element={<ToolErrors />} />
                <Route path="tool-errors/:tool" element={<ToolErrors />} />
                <Route path="*" element={<Navigate replace to="/" />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </MermaidPreferencesProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
