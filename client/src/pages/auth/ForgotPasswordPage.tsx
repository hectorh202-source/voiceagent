import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { AuthLayout, Flash } from "../../auth/AuthLayout";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Local state, not a separate route — the server's response is
  // deliberately identical whether or not the email matches a real account
  // (anti-enumeration), so there's nothing route-worthy to distinguish here.
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post<{ message: string }>("/api/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <h1>Check your email</h1>
        <Flash type="success" message="If an account exists for that email, we've sent a link to reset your password. It expires in 1 hour." />
        <div className="auth-links">
          <Link to="/login">Back to log in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Forgot your password?</h1>
      <p className="auth-subtitle">Enter your email and we'll send you a link to reset it.</p>
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
        <button type="submit" className="auth-submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/login">Back to log in</Link>
      </div>
    </AuthLayout>
  );
}
