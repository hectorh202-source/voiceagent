import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { AuthLayout, Flash } from "../../auth/AuthLayout";

// req.originalUrl server-side (requireAppAccess's returnTo) includes the
// /app prefix (e.g. "/app/5/calls"), but this SPA's BrowserRouter has
// basename="/app" — navigate() must NOT include that prefix, or it'd double
// into "/app/app/5/calls". Also guards against an obviously-broken value
// degrading to a sane fallback (not a security boundary — navigate() can
// never leave the origin no matter what string it's given, unlike
// window.location.href, which is why the old server-side open-redirect
// guard existed in the first place).
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  const withoutAppPrefix = raw.startsWith("/app") ? raw.slice(4) : raw;
  if (!withoutAppPrefix.startsWith("/") || withoutAppPrefix.startsWith("//")) return "/";
  return withoutAppPrefix;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post("/api/auth/login", { email, password });
      // Navigate before invalidating — AuthPageGate watches the same
      // ["auth-state"] query and redirects to "/" the instant it sees
      // authenticated:true, which would otherwise race the returnTo
      // navigation below and always win (since it fires on this same
      // still-mounted page). Navigating away first unmounts AuthPageGate
      // before that invalidation lands, so only this navigate takes effect.
      navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
      queryClient.invalidateQueries({ queryKey: ["auth-state"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="auth-subtitle">Log in to manage your voice agent platform.</p>
      {error && <Flash type="error" message={error} />}
      <form onSubmit={handleSubmit}>
        <div className="auth-field">
          <label>Email</label>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="auth-field">
          <div className="auth-label-row">
            <label>Password</label>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="auth-submit" disabled={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthLayout>
  );
}
