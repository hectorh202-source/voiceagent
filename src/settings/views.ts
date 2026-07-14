function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const layoutStyles = `
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  label { display: block; margin-top: 12px; font-weight: 600; font-size: 0.9rem; }
  input, select { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; font-size: 0.95rem; }
  button { margin-top: 16px; padding: 10px 16px; font-size: 0.95rem; cursor: pointer; }
  .hint { color: #666; font-size: 0.8rem; margin-top: 2px; }
  .flash-success { background: #e6f4ea; border: 1px solid #34a853; padding: 10px; margin-bottom: 16px; border-radius: 4px; }
  .flash-error { background: #fce8e6; border: 1px solid #ea4335; padding: 10px; margin-bottom: 16px; border-radius: 4px; }
  .row { display: flex; justify-content: space-between; align-items: center; }
  form.inline { display: inline; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${layoutStyles}</style></head>
<body>${body}
<script>
// Belt-and-suspenders alongside this router's Cache-Control: no-store
// header (see middleware/noStore.ts) — some browsers can still restore a
// page from the back/forward cache despite that header. If this page gets
// resurrected that way after a login/logout, force a real reload so it
// re-renders fresh from the server (current auth state, empty form fields)
// instead of silently showing whatever was on screen for a previous user.
window.addEventListener('pageshow', function (event) {
  if (event.persisted) window.location.reload();
});
</script>
</body>
</html>`;
}

export function renderSetupPage(error?: string): string {
  return page(
    "Set up your account",
    `
    <h1>Voice Agent Platform — first-time setup</h1>
    <p>Create the first account to protect the settings page (it will hold your ElevenLabs and ServiceTitan credentials). You can add more accounts later from the settings page.</p>
    ${error ? `<div class="flash-error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/settings/setup">
      <label>Email</label>
      <input type="email" name="email" required autofocus />
      <label>Password</label>
      <input type="password" name="password" minlength="8" required />
      <label>Confirm password</label>
      <input type="password" name="confirmPassword" minlength="8" required />
      <button type="submit">Create account &amp; continue</button>
    </form>
  `,
  );
}

export function renderMigratePage(error?: string): string {
  return page(
    "Upgrade your account",
    `
    <h1>Voice Agent Platform — account upgrade</h1>
    <p>This app now supports multiple accounts. Enter your current password to confirm it's you, plus the email you'd like to use going forward.</p>
    ${error ? `<div class="flash-error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/settings/migrate">
      <label>Current password</label>
      <input type="password" name="currentPassword" required autofocus />
      <label>Email</label>
      <input type="email" name="email" required />
      <button type="submit">Upgrade &amp; continue</button>
    </form>
  `,
  );
}

export function renderLoginPage(error?: string, returnTo?: string): string {
  return page(
    "Log in",
    `
    <h1>Voice Agent Platform — settings login</h1>
    ${error ? `<div class="flash-error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/settings/login">
      <label>Email</label>
      <input type="email" name="email" required autofocus />
      <label>Password</label>
      <input type="password" name="password" required />
      ${returnTo ? `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />` : ""}
      <button type="submit">Log in</button>
    </form>
  `,
  );
}


