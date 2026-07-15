function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Same design tokens as client/src/index.css, duplicated here rather than
// shared — this is plain server-rendered HTML with no build step, so there's
// no module boundary to import across. Keeping the values identical (not
// just similarly-named) is what makes this feel like the same app instead of
// a reskinned one; if the client's palette changes, update both.
const authStyles = `
  :root {
    --bg: #f5f6f8;
    --panel: #ffffff;
    --border: #e2e5ea;
    --text: #1a1d23;
    --text-muted: #6b7280;
    --sidebar-bg: #12151c;
    --accent: #3b6ef6;
    --accent-hover: #2f5bd6;
    --accent-contrast: #ffffff;
    --success-bg: #e6f6ec;
    --success-text: #15803d;
    --danger-bg: #fdeaea;
    --danger-text: #b91c1c;
    --radius: 8px;
    --radius-lg: 16px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a;
      --panel: #1c1f26;
      --border: #2b2f38;
      --text: #e7e9ee;
      --text-muted: #9aa0ab;
      --sidebar-bg: #0d0f14;
      --success-bg: #123420;
      --success-text: #4ade80;
      --danger-bg: #3a1717;
      --danger-text: #f87171;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
  }
  .auth-shell {
    min-height: 100vh;
    display: flex;
  }
  .auth-brand {
    flex: 0 0 42%;
    background: linear-gradient(160deg, var(--sidebar-bg) 0%, #1a2035 100%);
    color: #fff;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 64px;
    position: relative;
    overflow: hidden;
  }
  .auth-brand::before {
    content: "";
    position: absolute;
    width: 480px;
    height: 480px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(59, 110, 246, 0.28) 0%, transparent 70%);
    top: -140px;
    right: -180px;
  }
  .auth-brand-mark {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 18px;
    margin-bottom: 24px;
    position: relative;
    z-index: 1;
  }
  .auth-brand-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .auth-brand-tagline {
    font-size: 15px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.75);
    max-width: 360px;
    position: relative;
    z-index: 1;
  }
  .auth-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .auth-card {
    width: 100%;
    max-width: 400px;
  }
  .auth-card h1 {
    font-size: 22px;
    margin: 0 0 8px;
    font-weight: 700;
  }
  .auth-subtitle {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0 0 28px;
    line-height: 1.5;
  }
  .auth-field { margin-bottom: 18px; }
  .auth-field label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--text);
  }
  .auth-label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .auth-label-row label { margin-bottom: 0; }
  .auth-label-row a {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }
  .auth-label-row a:hover { text-decoration: underline; }
  .auth-field input {
    width: 100%;
    padding: 11px 14px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--text);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .auth-field input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(59, 110, 246, 0.15);
  }
  .auth-submit {
    width: 100%;
    padding: 12px 16px;
    background: var(--accent);
    color: var(--accent-contrast);
    border: none;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    margin-top: 4px;
  }
  .auth-submit:hover { background: var(--accent-hover); }
  .auth-links {
    margin-top: 20px;
    font-size: 13px;
    text-align: center;
    color: var(--text-muted);
  }
  .auth-links a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
  .auth-links a:hover { text-decoration: underline; }
  .auth-flash {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 14px;
    border-radius: var(--radius);
    font-size: 13px;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .auth-flash svg { flex-shrink: 0; margin-top: 1px; }
  .auth-flash-error { background: var(--danger-bg); color: var(--danger-text); }
  .auth-flash-success { background: var(--success-bg); color: var(--success-text); }
  @media (max-width: 860px) {
    .auth-brand { display: none; }
    .auth-main { padding: 24px; }
  }
`;

const BRAND_TAGLINE =
  "The AI receptionist for service businesses — booking, dispatch, and follow-up, handled automatically on every call.";

const ALERT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/></svg>`;
const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
const PHONE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

function flash(message: string, type: "error" | "success"): string {
  const icon = type === "error" ? ALERT_ICON : CHECK_ICON;
  return `<div class="auth-flash auth-flash-${type}">${icon}<span>${escapeHtml(message)}</span></div>`;
}

// Exported (rather than inlined directly in page() below) so
// middleware/securityHeaders.ts can hash this exact string at startup and
// allow-list it in the CSP script-src via 'sha256-<hash>' instead of the
// much weaker 'unsafe-inline' — keeps the hash from ever silently drifting
// out of sync with the actual script text. The leading/trailing newlines
// are part of the constant deliberately: they're what the browser's script
// text node actually contains once embedded below, and the hash must cover
// the exact same bytes.
export const BFCACHE_RELOAD_SCRIPT = `
// Belt-and-suspenders alongside this router's Cache-Control: no-store
// header (see middleware/noStore.ts) — some browsers can still restore a
// page from the back/forward cache despite that header. If this page gets
// resurrected that way after a login/logout, force a real reload so it
// re-renders fresh from the server (current auth state, empty form fields)
// instead of silently showing whatever was on screen for a previous user.
window.addEventListener('pageshow', function (event) {
  if (event.persisted) window.location.reload();
});
`;

// Shared shell: brand panel on the left (hidden below 860px, see authStyles)
// plus the actual page content on the right. Every pre-session page
// (setup/migrate/login/forgot/reset) goes through this so the whole flow
// reads as one designed experience rather than a series of separate forms.
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${authStyles}</style></head>
<body>
<div class="auth-shell">
  <aside class="auth-brand">
    <div class="auth-brand-mark">
      <div class="auth-brand-icon">${PHONE_ICON}</div>
      Voice Agent Platform
    </div>
    <div class="auth-brand-tagline">${BRAND_TAGLINE}</div>
  </aside>
  <main class="auth-main">
    <div class="auth-card">
      ${bodyHtml}
    </div>
  </main>
</div>
<script>${BFCACHE_RELOAD_SCRIPT}</script>
</body>
</html>`;
}

export function renderSetupPage(error?: string): string {
  return page(
    "Set up your account",
    `
    <h1>Create your account</h1>
    <p class="auth-subtitle">Set up the first admin account to get started. You'll be able to add teammates later.</p>
    ${error ? flash(error, "error") : ""}
    <form method="post" action="/settings/setup">
      <div class="auth-field">
        <label>Email</label>
        <input type="email" name="email" required autofocus autocomplete="email" />
      </div>
      <div class="auth-field">
        <label>Password</label>
        <input type="password" name="password" minlength="8" required autocomplete="new-password" />
      </div>
      <div class="auth-field">
        <label>Confirm password</label>
        <input type="password" name="confirmPassword" minlength="8" required autocomplete="new-password" />
      </div>
      <button type="submit" class="auth-submit">Create account &amp; continue</button>
    </form>
  `,
  );
}

export function renderMigratePage(error?: string): string {
  return page(
    "Upgrade your account",
    `
    <h1>Upgrade your account</h1>
    <p class="auth-subtitle">This app now supports individual accounts. Confirm your current password, then choose the email you'd like to use going forward.</p>
    ${error ? flash(error, "error") : ""}
    <form method="post" action="/settings/migrate">
      <div class="auth-field">
        <label>Current password</label>
        <input type="password" name="currentPassword" required autofocus autocomplete="current-password" />
      </div>
      <div class="auth-field">
        <label>Email</label>
        <input type="email" name="email" required autocomplete="email" />
      </div>
      <button type="submit" class="auth-submit">Upgrade &amp; continue</button>
    </form>
  `,
  );
}

export function renderLoginPage(error?: string, returnTo?: string): string {
  return page(
    "Log in",
    `
    <h1>Welcome back</h1>
    <p class="auth-subtitle">Log in to manage your voice agent platform.</p>
    ${error ? flash(error, "error") : ""}
    <form method="post" action="/settings/login">
      <div class="auth-field">
        <label>Email</label>
        <input type="email" name="email" required autofocus autocomplete="email" />
      </div>
      <div class="auth-field">
        <div class="auth-label-row">
          <label>Password</label>
          <a href="/settings/forgot-password">Forgot password?</a>
        </div>
        <input type="password" name="password" required autocomplete="current-password" />
      </div>
      ${returnTo ? `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />` : ""}
      <button type="submit" class="auth-submit">Log in</button>
    </form>
  `,
  );
}

export function renderForgotPasswordPage(error?: string): string {
  return page(
    "Forgot password",
    `
    <h1>Forgot your password?</h1>
    <p class="auth-subtitle">Enter your email and we'll send you a link to reset it.</p>
    ${error ? flash(error, "error") : ""}
    <form method="post" action="/settings/forgot-password">
      <div class="auth-field">
        <label>Email</label>
        <input type="email" name="email" required autofocus autocomplete="email" />
      </div>
      <button type="submit" class="auth-submit">Send reset link</button>
    </form>
    <div class="auth-links"><a href="/settings/login">Back to log in</a></div>
  `,
  );
}

export function renderForgotPasswordSentPage(): string {
  return page(
    "Check your email",
    `
    <h1>Check your email</h1>
    ${flash("If an account exists for that email, we've sent a link to reset your password. It expires in 1 hour.", "success")}
    <div class="auth-links"><a href="/settings/login">Back to log in</a></div>
  `,
  );
}

export function renderResetPasswordPage(token: string, error?: string): string {
  return page(
    "Reset your password",
    `
    <h1>Set a new password</h1>
    <p class="auth-subtitle">Choose a new password for your account.</p>
    ${error ? flash(error, "error") : ""}
    <form method="post" action="/settings/reset-password">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <div class="auth-field">
        <label>New password</label>
        <input type="password" name="password" minlength="8" required autofocus autocomplete="new-password" />
      </div>
      <div class="auth-field">
        <label>Confirm new password</label>
        <input type="password" name="confirmPassword" minlength="8" required autocomplete="new-password" />
      </div>
      <button type="submit" class="auth-submit">Reset password</button>
    </form>
  `,
  );
}

export function renderResetPasswordInvalidPage(): string {
  return page(
    "Link expired",
    `
    <h1>This link is invalid or expired</h1>
    <p class="auth-subtitle">Password reset links expire after 1 hour and can only be used once.</p>
    <div class="auth-links"><a href="/settings/forgot-password">Request a new link</a></div>
  `,
  );
}
