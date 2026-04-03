import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { Directories } from "./pages/Directories";
import { DirectorySessions } from "./pages/DirectorySessions";
import { Monitor } from "./pages/Monitor";
import { Search } from "./pages/Search";
import { SessionDetail } from "./pages/SessionDetail";
import { ToolErrors } from "./pages/ToolErrors";
import "./tokens.css";
import "./styles.css";

ReactDOM.createRoot(document.querySelector<HTMLDivElement>("#app")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="session/:sessionId" element={<SessionDetail />} />
          <Route path="directories" element={<Directories />} />
          <Route path="dir/:directory" element={<DirectorySessions />} />
          <Route path="search" element={<Search />} />
          <Route path="tool-errors" element={<ToolErrors />} />
          <Route path="tool-errors/:tool" element={<ToolErrors />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
