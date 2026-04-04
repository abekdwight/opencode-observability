import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

// ---------------------------------------------------------------------------
// HeaderActionsContext — lets child pages inject actions into the header
// ---------------------------------------------------------------------------
type HeaderActionsSetter = (node: React.ReactNode) => void;

export const HeaderActionsContext = React.createContext<HeaderActionsSetter>(
  () => {},
);

const NAV_ITEMS = [
  { to: "/", label: "Home" },
  { to: "/directories", label: "Directories" },
  { to: "/search", label: "Search" },
  { to: "/monitor", label: "Monitor" },
] as const;

function isActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname.startsWith(to);
}

export function AppShell() {
  const location = useLocation();
  const [headerActions, setHeaderActions] = React.useState<React.ReactNode>(null);

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header-bar">
        <Link to="/" className="app-brand">
          OpenCode Telemetry
        </Link>

        <nav className="app-seg-nav" aria-label="Primary">
          {NAV_ITEMS.map(({ to, label }) => (
            <Link
              key={to}
              className={isActive(location.pathname, to) ? "active" : undefined}
              to={to}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="app-header-actions">{headerActions}</div>
      </header>

      <main className="app-main">
        <HeaderActionsContext.Provider value={setHeaderActions}>
          <Outlet />
        </HeaderActionsContext.Provider>
      </main>
    </div>
  );
}
