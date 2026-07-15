import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AuthLayout, Flash } from "../../auth/AuthLayout";

function InvalidLink() {
  return (
    <AuthLayout>
      <h1>This link is invalid or expired</h1>
      <p className="auth-subtitle">Password reset links expire after 1 hour and can only be used once.</p>
      <div className="auth-links">
        <Link to="/forgot-password">Request a new link</Link>
      </div>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Read-only check — mirrors the old GET /reset-password behavior of
  // deciding which view to show without consuming the token just for having
  // been looked at. The real, single-use consumption only happens on submit.
  const { data, isLoading } = useQuery({
    queryKey: ["reset-password-token", token],
    queryFn: () => api.get<{ valid: boolean }>(`/api/auth/reset-password?token=${encodeURIComponent(token)}`),
    enabled: !!token,
  });

  if (!token) return <InvalidLink />;
  if (isLoading || !data) {
    return (
      <AuthLayout>
        <div className="centered-spinner">Loading…</div>
      </AuthLayout>
    );
  }
  if (!data.valid) return <InvalidLink />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/reset-password", { token, password, confirmPassword });
      await queryClient.invalidateQueries({ queryKey: ["auth-state"] });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Set a new password</h1>
      <p className="auth-subtitle">Choose a new password for your account.</p>
      {error && <Flash type="error" message={error} />}
      <form onSubmit={handleSubmit}>
        <div className="auth-field">
          <label>New password</label>
          <input
            type="password"
            minLength={8}
            required
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="auth-field">
          <label>Confirm new password</label>
          <input
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="auth-submit" disabled={isSubmitting}>
          {isSubmitting ? "Resetting…" : "Reset password"}
        </button>
      </form>
    </AuthLayout>
  );
}
