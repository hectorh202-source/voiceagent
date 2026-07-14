import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser, Business } from "../api/types";
import { useAuthedUser } from "../auth/AuthGate";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

function PlatformAdminRow({ user, currentUserId }: { user: AdminUser; currentUserId: number }) {
  const queryClient = useQueryClient();
  const [isAdmin, setIsAdmin] = useState(user.isPlatformAdmin);
  const isSelf = user.id === currentUserId;
  const isLocked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();

  const saveMutation = useMutation({
    // businessIds is always [] from this page — business assignment now
    // happens entirely on each business's own admin console.
    mutationFn: () => api.post(`/api/admin/users/${user.id}/access`, { isPlatformAdmin: isAdmin, businessIds: [] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/admin/users/${user.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <strong>{user.email}</strong>
          {isSelf && <span className="muted"> (you)</span>}
          {isLocked && (
            <span className="badge badge-danger" style={{ marginLeft: 8 }}>
              Locked
            </span>
          )}
        </div>
        {!isSelf && (
          <button
            className="btn"
            onClick={() => {
              if (confirm(`Remove ${user.email}? They will be logged out immediately.`)) deleteMutation.mutate();
            }}
          >
            Remove
          </button>
        )}
      </div>

      <div className="form-row" style={{ marginTop: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
          <input type="checkbox" checked={isAdmin} disabled={isSelf} onChange={(e) => setIsAdmin(e.target.checked)} />
          Platform admin (full access to every business)
        </label>
        {isSelf && <div className="form-hint">You can't remove your own admin access — have another admin do it.</div>}
      </div>
      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isSelf}>
        Save
      </button>
      {saveMutation.isError && <span className="muted" style={{ marginLeft: 8 }}>{(saveMutation.error as Error).message}</span>}
    </div>
  );
}

function BusinessUserRow({ user, businessId }: { user: AdminUser; businessId: number }) {
  const queryClient = useQueryClient();
  const isLocked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/api/admin/businesses/${businessId}/users/${user.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <div className="details-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
      <span>
        {user.email}
        {isLocked && (
          <span className="badge badge-danger" style={{ marginLeft: 8 }}>
            Locked
          </span>
        )}
      </span>
      <button
        className="btn"
        onClick={() => {
          if (confirm(`Remove ${user.email}'s access to this business? Their account (and access to any other business) stays intact.`)) {
            removeMutation.mutate();
          }
        }}
      >
        Remove
      </button>
    </div>
  );
}

function BusinessAdminSettings({ businessId, businesses }: { businessId: number; businesses: Business[] }) {
  const queryClient = useQueryClient();
  const { data: userData } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const users = userData?.users ?? [];
  const business = businesses.find((b) => b.id === businessId);
  const businessUsers = users.filter((u) => !u.isPlatformAdmin && u.businessIds.includes(businessId));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const addUserMutation = useMutation({
    mutationFn: () => api.post<{ success?: boolean }>(`/api/admin/businesses/${businessId}/users`, { email, password }),
    onSuccess: () => {
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      <h1>Admin Settings — {business?.name ?? `Business ${businessId}`}</h1>

      <div className="card">
        <h2>Users</h2>
        {businessUsers.length === 0 ? (
          <p className="muted">No users assigned to this business yet — add one below.</p>
        ) : (
          businessUsers.map((u) => <BusinessUserRow key={u.id} user={u} businessId={businessId} />)
        )}
        <div className="form-row" style={{ marginTop: 12 }}>
          <label>Add a user — email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </div>
        <div className="form-row">
          <label>Confirm password</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="off" />
        </div>
        <button
          className="btn btn-primary"
          disabled={!email || password.length < 8 || password !== confirmPassword || addUserMutation.isPending}
          onClick={() => addUserMutation.mutate()}
        >
          Add user
        </button>
        {error && <div className="muted" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <GeneralSettingsPage />
    </div>
  );
}

function GlobalAdminSettings({ businesses }: { businesses: Business[] }) {
  const currentUser = useAuthedUser();
  const queryClient = useQueryClient();
  const { data: userData } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const users = userData?.users ?? [];
  const admins = users.filter((u) => u.isPlatformAdmin);

  const [businessName, setBusinessName] = useState("");
  const addBusinessMutation = useMutation({
    mutationFn: () => api.post("/api/admin/businesses", { name: businessName }),
    onSuccess: () => {
      setBusinessName("");
      queryClient.invalidateQueries({ queryKey: ["admin-businesses"] });
    },
  });

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmPassword, setNewConfirmPassword] = useState("");
  const [addAdminError, setAddAdminError] = useState("");
  const addAdminMutation = useMutation({
    mutationFn: () =>
      api.post<{ success?: boolean }>("/api/admin/users", {
        email: newEmail,
        password: newPassword,
        isPlatformAdmin: true,
        businessIds: [],
      }),
    onSuccess: () => {
      setNewEmail("");
      setNewPassword("");
      setNewConfirmPassword("");
      setAddAdminError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => setAddAdminError(err.message),
  });

  return (
    <div>
      <h1>Admin Settings</h1>

      <div className="card">
        <h2>Businesses</h2>
        {businesses.length === 0 ? (
          <p className="muted">No businesses yet — add one below.</p>
        ) : (
          businesses.map((b) => <div key={b.id} className="details-row">{b.name}</div>)
        )}
        <div className="form-row" style={{ marginTop: 12 }}>
          <label>Add a business — name</label>
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        </div>
        <button className="btn" onClick={() => addBusinessMutation.mutate()} disabled={!businessName.trim()}>
          Add business
        </button>
        <div className="form-hint" style={{ marginTop: 8 }}>
          Pick a business from the switcher above to manage its users and general settings.
        </div>
      </div>

      <h2>Platform Admins</h2>
      {admins.map((u) => (
        <PlatformAdminRow key={u.id} user={u} currentUserId={currentUser.id} />
      ))}

      <div className="card">
        <h2>Add a platform admin</h2>
        <div className="form-row">
          <label>Email</label>
          <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Password</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="off" />
        </div>
        <div className="form-row">
          <label>Confirm password</label>
          <input
            type="password"
            value={newConfirmPassword}
            onChange={(e) => setNewConfirmPassword(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="form-hint">
          To give a user access to a specific business instead of full platform-admin access, pick that business
          from the switcher above and add them there.
        </div>
        <button
          className="btn btn-primary"
          disabled={!newEmail || newPassword.length < 8 || newPassword !== newConfirmPassword || addAdminMutation.isPending}
          onClick={() => addAdminMutation.mutate()}
        >
          Add platform admin
        </button>
        {addAdminError && <div className="muted" style={{ marginTop: 8 }}>{addAdminError}</div>}
      </div>
    </div>
  );
}

export function AdminSettingsPage() {
  const currentUser = useAuthedUser();
  const { businessId: businessIdParam } = useParams();

  const { data: businessData } = useQuery({
    queryKey: ["admin-businesses"],
    queryFn: () => api.get<{ businesses: Business[] }>("/api/admin/businesses"),
    enabled: currentUser.isPlatformAdmin,
  });

  if (!currentUser.isPlatformAdmin) {
    // Bounce silently rather than rendering any "admin" chrome for a
    // non-admin — a bfcache-restored /app/admin document (e.g. after
    // logging out and back in as a different user) should land them
    // somewhere real, not on a page that even names what it's blocking.
    return <Navigate to="/" replace />;
  }

  const businesses = businessData?.businesses ?? [];
  const businessId = businessIdParam ? Number(businessIdParam) : undefined;

  if (businessId !== undefined) {
    return <BusinessAdminSettings businessId={businessId} businesses={businesses} />;
  }
  return <GlobalAdminSettings businesses={businesses} />;
}
