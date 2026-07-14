import { NavLink, Outlet, useParams } from "react-router-dom";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { useAuthedUser } from "../auth/AuthGate";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link active" : "nav-link";
}

export function AppShell() {
  const { businessId } = useParams();
  const user = useAuthedUser();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Voice Agent Platform</div>
        <BusinessSwitcher />
        {businessId && (
          <>
            <nav className="nav-group">
              <div className="nav-group-label">Channels</div>
              <NavLink to={`/${businessId}/calls`} className={navClass}>
                Calls
              </NavLink>
              <NavLink to={`/${businessId}/metrics`} className={navClass}>
                Call Metrics
              </NavLink>
            </nav>
            <nav className="nav-group">
              <div className="nav-group-label">Settings</div>
              <NavLink to={`/${businessId}/settings/business-info`} className={navClass}>
                Business Info
              </NavLink>
            </nav>
          </>
        )}
        {user.isPlatformAdmin && (
          <nav className="nav-group">
            <div className="nav-group-label">Admin</div>
            <NavLink to="/admin" className={navClass}>
              Admin Settings
            </NavLink>
          </nav>
        )}
        <div className="sidebar-footer">
          <div>{user.email}</div>
          <form method="post" action="/settings/logout">
            <button type="submit">Log out</button>
          </form>
        </div>
      </aside>
      <div className="main">
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
