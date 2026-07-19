import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { useAuthedUser } from "../auth/AuthGate";
import { api } from "../api/client";
import type { UnreadCounts } from "../api/types";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link active" : "nav-link";
}

export function AppShell() {
  const { businessId } = useParams();
  const user = useAuthedUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Gmail-style sidebar unread counts — polled rather than pushed, same
  // "good enough" tradeoff every other list on this dashboard already makes
  // (no websocket/SSE layer exists anywhere in this app). Every isRead-
  // flipping mutation (CallsListPage/CallDetailPage/LeadsPage/LeadDetailPage)
  // also invalidates ["unread-counts", businessId] directly, so the badge
  // updates immediately on this tab without waiting for the next poll.
  const { data: unreadCounts } = useQuery({
    queryKey: ["unread-counts", businessId],
    queryFn: () => api.get<UnreadCounts>(`/api/businesses/${businessId}/unread-counts`),
    enabled: !!businessId,
    refetchInterval: 30_000,
  });

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
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" />
          Voice Agent Platform
        </div>
        <BusinessSwitcher />
        {businessId && (
          <>
            <nav className="nav-group">
              <div className="nav-group-label">Channels</div>
              <NavLink to={`/${businessId}/calls`} className={navClass}>
                <span>Calls</span>
                {!!unreadCounts?.calls && <span className="nav-badge">{unreadCounts.calls}</span>}
              </NavLink>
              <NavLink to={`/${businessId}/metrics`} className={navClass}>
                Call Metrics
              </NavLink>
              <NavLink to={`/${businessId}/leads`} className={navClass}>
                <span>Leads</span>
                {!!unreadCounts?.leads && <span className="nav-badge">{unreadCounts.leads}</span>}
              </NavLink>
            </nav>
            <nav className="nav-group">
              <div className="nav-group-label">Voices</div>
              <NavLink to={`/${businessId}/settings/voices`} className={navClass}>
                Voices
              </NavLink>
            </nav>
            <nav className="nav-group">
              <div className="nav-group-label">Knowledge Base</div>
              <NavLink to={`/${businessId}/settings/knowledge-base`} className={navClass}>
                Knowledge Base
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
