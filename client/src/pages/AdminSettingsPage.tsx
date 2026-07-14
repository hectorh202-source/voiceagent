import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser, Business } from "../api/types";
import { useAuthedUser } from "../auth/AuthGate";

function BusinessCheckboxes({
  businesses,
  checkedIds,
  onChange,
}: {
  businesses: Business[];
  checkedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  function toggle(id: number) {
    onChange(checkedIds.includes(id) ? checkedIds.filter((x) => x !== id) : [...checkedIds, id]);
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6 }}>
      {businesses.map((b) => (
        <label key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 400, fontSize: 13 }}>
          <input type="checkbox" checked={checkedIds.includes(b.id)} onChange={() => toggle(b.id)} />
          {b.name}
        </label>
      ))}
    </div>
  );
}

function UserAccessRow({ user, businesses, currentUserId }: { user: AdminUser; businesses: Business[]; currentUserId: number }) {
  const queryClient = useQueryClient();
  const [isAdmin, setIsAdmin] = useState(user.isPlatformAdmin);
  const [businessIds, setBusinessIds] = useState<number[]>(user.businessIds);
  const isSelf = user.id === currentUserId;
  const isLocked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${user.id}/access`, { isPlatformAdmin: isAdmin, businessIds }),
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
          <input
            type="checkbox"
            checked={isAdmin}
            disabled={isSelf && user.isPlatformAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          Platform admin (full access to every business)
        </label>
        {isSelf && user.isPlatformAdmin && (
          <div className="form-hint">You can't remove your own admin access — have another admin do it.</div>
        )}
        <div className="form-hint">Businesses (ignored if platform admin is checked):</div>
        <BusinessCheckboxes businesses={businesses} checkedIds={businessIds} onChange={setBusinessIds} />
      </div>
      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Save access
      </button>
      {saveMutation.isError && <span className="muted" style={{ marginLeft: 8 }}>{(saveMutation.error as Error).message}</span>}
    </div>
  );
}

export function AdminSettingsPage() {
  const currentUser = useAuthedUser();
  const queryClient = useQueryClient();

  const { data: businessData } = useQuery({
    queryKey: ["admin-businesses"],
    queryFn: () => api.get<{ businesses: Business[] }>("/api/admin/businesses"),
    enabled: currentUser.isPlatformAdmin,
  });
  const { data: userData } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
    enabled: currentUser.isPlatformAdmin,
  });

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
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newBusinessIds, setNewBusinessIds] = useState<number[]>([]);
  const [addUserError, setAddUserError] = useState("");
  const addUserMutation = useMutation({
    mutationFn: () =>
      api.post<{ success?: boolean; error?: string }>("/api/admin/users", {
        email: newEmail,
        password: newPassword,
        isPlatformAdmin: newIsAdmin,
        businessIds: newBusinessIds,
      }),
    onSuccess: () => {
      setNewEmail("");
      setNewPassword("");
      setNewConfirmPassword("");
      setNewIsAdmin(false);
      setNewBusinessIds([]);
      setAddUserError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => setAddUserError(err.message),
  });

  if (!currentUser.isPlatformAdmin) {
    // Bounce silently rather than rendering any "admin" chrome for a
    // non-admin — a bfcache-restored /app/admin document (e.g. after
    // logging out and back in as a different user) should land them
    // somewhere real, not on a page that even names what it's blocking.
    return <Navigate to="/" replace />;
  }

  const businesses = businessData?.businesses ?? [];
  const users = userData?.users ?? [];

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
      </div>

      <h2>Users</h2>
      {users.map((u) => (
        <UserAccessRow key={u.id} user={u} businesses={businesses} currentUserId={currentUser.id} />
      ))}

      <div className="card">
        <h2>Add a user</h2>
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
        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
            Platform admin (full access to every business)
          </label>
          <div className="form-hint">Or assign to specific businesses (ignored if platform admin is checked):</div>
          <BusinessCheckboxes businesses={businesses} checkedIds={newBusinessIds} onChange={setNewBusinessIds} />
        </div>
        <button
          className="btn btn-primary"
          disabled={!newEmail || newPassword.length < 8 || newPassword !== newConfirmPassword || addUserMutation.isPending}
          onClick={() => addUserMutation.mutate()}
        >
          Add user
        </button>
        {addUserError && <div className="muted" style={{ marginTop: 8 }}>{addUserError}</div>}
      </div>
    </div>
  );
}
