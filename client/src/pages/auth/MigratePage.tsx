import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AuthLayout, Flash } from "../../auth/AuthLayout";

export function MigratePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/migrate", { email, currentPassword });
      await queryClient.invalidateQueries({ queryKey: ["auth-state"] });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect current password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Upgrade your account</h1>
      <p className="auth-subtitle">
        This app now supports individual accounts. Confirm your current password, then choose the email you'd like to use going forward.
      </p>
      {error && <Flash type="error" message={error} />}
      <form onSubmit={handleSubmit}>
        <div className="auth-field">
          <label>Current password</label>
          <input
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="auth-field">
          <label>Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" className="auth-submit" disabled={isSubmitting}>
          {isSubmitting ? "Upgrading…" : "Upgrade & continue"}
        </button>
      </form>
    </AuthLayout>
  );
}
