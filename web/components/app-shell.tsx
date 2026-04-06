import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/use-theme";
import { cn } from "../lib/cn";
import { type LayoutMode, LayoutModeContext } from "../lib/layout-context";
import { CommandPalette } from "./command-palette/command-palette";

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
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
  const location = useLocation();
  const [headerActions, setHeaderActions] =
    React.useState<React.ReactNode>(null);
  const [layoutMode, setLayoutMode] = React.useState<LayoutMode>("default");
  const { setTheme, resolvedTheme } = useTheme();
  const [cmdkOpen, setCmdkOpen] = React.useState(false);

  const layoutModeValue = React.useMemo(
    () => ({ mode: layoutMode, setMode: setLayoutMode }),
    [layoutMode],
  );

  // Global Cmd+K / Ctrl+K shortcut
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdkOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <LayoutModeContext.Provider value={layoutModeValue}>
      <div
        className={cn(
          "flex flex-col min-h-screen bg-[var(--color-bg-root)]",
          layoutMode === "ide" && "h-screen overflow-hidden",
        )}
        data-testid="app-shell"
      >
        {/* Header */}
        <header className="h-12 flex items-center px-5 gap-4 sticky top-0 z-[var(--z-header)] shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-translucent)] backdrop-blur-xl">
          {/* Brand */}
          <Link
            to="/"
            className="flex items-center gap-2 no-underline text-[var(--color-text-primary)] font-semibold text-[0.88em] tracking-tight whitespace-nowrap shrink-0 hover:no-underline"
          >
            OpenCode Telemetry
          </Link>

          {/* Segmented Nav */}
          <nav
            className="flex bg-[var(--color-bg-elevated)] rounded-lg p-[3px] gap-0.5"
            aria-label="Primary"
          >
            {NAV_ITEMS.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "px-3.5 py-1.5 rounded-md text-[0.8em] font-medium no-underline whitespace-nowrap transition-all duration-150",
                  isActive(location.pathname, to)
                    ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-subtle)] hover:no-underline",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-2">
            {headerActions}

            {/* Command Palette trigger */}
            <button
              type="button"
              onClick={() => setCmdkOpen(true)}
              className="h-7 px-2.5 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] text-xs font-medium flex items-center gap-1.5 hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors duration-150"
            >
              <span className="opacity-60">{isMac ? "⌘" : "Ctrl"}</span>
              {isMac ? "K" : "+K"}
            </button>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              className="h-7 w-7 rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] flex items-center justify-center hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors duration-150 text-sm"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? "☀" : "●"}
            </button>
          </div>
        </header>

        {/* Command Palette */}
        <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />

        {/* Main content */}
        <main
          className={cn(
            layoutMode === "ide"
              ? "flex-1 flex flex-col overflow-hidden"
              : "flex-1 w-full max-w-[1200px] mx-auto p-4",
          )}
        >
          <HeaderActionsContext.Provider value={setHeaderActions}>
            <Outlet />
          </HeaderActionsContext.Provider>
        </main>
      </div>
    </LayoutModeContext.Provider>
  );
}
