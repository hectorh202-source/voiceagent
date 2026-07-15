import type { ReactNode } from "react";

const PHONE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const BRAND_TAGLINE =
  "The AI receptionist for service businesses — booking, dispatch, and follow-up, handled automatically on every call.";

// Straight JSX port of the old server-rendered page()/auth-shell layout
// (src/settings/views.ts, now deleted — see docs/settings-app.md) so the 5
// pre-session pages keep the exact same visual identity now that they're
// React components. The .auth-* classes live in index.css. No per-page
// <title> here — nothing else in this SPA sets one either (index.html's
// static title covers every route).
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="auth-brand-mark">
          <div className="auth-brand-icon">{PHONE_ICON}</div>
          Voice Agent Platform
        </div>
        <div className="auth-brand-tagline">{BRAND_TAGLINE}</div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

const ALERT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export function Flash({ type, message }: { type: "error" | "success"; message: string }) {
  return (
    <div className={`auth-flash auth-flash-${type}`}>
      {type === "error" ? ALERT_ICON : CHECK_ICON}
      <span>{message}</span>
    </div>
  );
}
