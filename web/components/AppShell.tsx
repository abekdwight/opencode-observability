import { Link, Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header">
        <h1>Dashboard</h1>
        <nav className="app-nav" aria-label="Primary">
          <Link className="nav-link" to="/">
            Home
          </Link>
          <Link className="nav-link" to="/directories">
            Directories
          </Link>
          <Link className="nav-link" to="/search">
            Search
          </Link>
          <Link className="nav-link" to="/monitor">
            Monitor
          </Link>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
