import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { useAuthedUser } from "../auth/AuthGate";
import { api } from "../api/client";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link active" : "nav-link";
}

export function AppShell() {
  const { businessId } = useParams();
  const user = useAuthedUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleLogout() {
    await api.post("/api/auth/logout");
    // Clears the now-stale ["session"]/["businesses"] cache so a subsequent
    // same-tab login doesn't briefly flash the previous user's data before
    // AuthGate's own query refetches.
    queryClient.clear();
    navigate("/login");
  }

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
        {user.isPlatformAdmin && businessId && (
          <nav className="nav-group">
            <div className="nav-group-label">Admin</div>
            <NavLink to={`/${businessId}/admin`} className={navClass}>
              Admin Settings
            </NavLink>
          </nav>
        )}
        <div className="sidebar-footer">
          {user.isPlatformAdmin && (
            <NavLink to="/admin" className={navClass}>
              Global Admin Settings
            </NavLink>
          )}
          <div>{user.email}</div>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
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
