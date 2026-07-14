import type { User } from "../db/users";
import type { Business } from "../db/businesses";

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

interface BusinessListPageProps {
  businesses: Business[];
  users: User[];
  // Keyed by user id — which businesses that user is explicitly assigned to
  // (ignored for platform admins, who see every business regardless).
  userBusinessIds: Record<number, number[]>;
  currentUserId: number;
  flash?: { type: "success" | "error"; message: string };
}

// One checkbox per business plus a "platform admin" checkbox, reused by both
// the per-user access-edit form and the "add a user" form. No JS toggling
// (e.g. graying out business checkboxes when admin is checked) — the server
// already ignores businessIds whenever isPlatformAdmin is checked, and
// keeping this plain HTML matches the project's existing "no framework
// needed at this size" stance on these global admin pages.
function businessCheckboxes(businesses: Business[], checkedIds: number[]): string {
  return businesses
    .map(
      (b) => `
      <label style="display:inline-flex; align-items:center; gap:4px; font-weight:400; margin-right:14px;">
        <input type="checkbox" name="businessIds" value="${b.id}" style="width:auto;" ${checkedIds.includes(b.id) ? "checked" : ""} />
        ${escapeHtml(b.name)}
      </label>`,
    )
    .join("");
}

export function renderBusinessListPage(props: BusinessListPageProps): string {
  const { businesses, users, userBusinessIds, currentUserId, flash } = props;

  return page(
    "Businesses",
    `
    <div class="row">
      <h1>Businesses</h1>
      <form class="inline" method="post" action="/settings/logout"><button type="submit">Log out</button></form>
    </div>
    ${flash ? `<div class="flash-${flash.type}">${escapeHtml(flash.message)}</div>` : ""}

    ${
      businesses.length
        ? businesses
            .map(
              (business) => `
        <div class="details-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0;">
          <a href="/app/${business.id}/calls">${escapeHtml(business.name)}</a>
        </div>`,
            )
            .join("")
        : `<p class="hint">No businesses yet — add one below to get started.</p>`
    }

    <form method="post" action="/settings/businesses">
      <label>Add a business — name</label>
      <input type="text" name="name" required autofocus />
      <button type="submit">Add business</button>
    </form>

    <h2>Users</h2>
    ${users
      .map((user) => {
        const isLocked = !!user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
        const isSelf = user.id === currentUserId;
        return `
        <div class="details-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0;">
          <span>${escapeHtml(user.email)}${isSelf ? " (you)" : ""}${user.isPlatformAdmin ? ' <span class="hint">Platform admin</span>' : ""}${isLocked ? ' <span class="flash-error" style="padding:2px 6px;">Locked</span>' : ""}</span>
          ${
            isSelf
              ? ""
              : `<form class="inline" method="post" action="/settings/users/${user.id}/delete" onsubmit="return confirm('Remove ${escapeHtml(user.email)}? They will be logged out immediately.')"><button type="submit">Remove</button></form>`
          }
        </div>
        <form method="post" action="/settings/users/${user.id}/access" style="padding:8px 0 16px; border-bottom:1px solid #f0f0f0;">
          <label style="display:inline-flex; align-items:center; gap:6px; font-weight:400;">
            <input type="checkbox" name="isPlatformAdmin" style="width:auto;" ${user.isPlatformAdmin ? "checked" : ""} ${isSelf && user.isPlatformAdmin ? "disabled" : ""} />
            Platform admin (full access to every business)
          </label>
          ${isSelf && user.isPlatformAdmin ? '<div class="hint">You can\'t remove your own admin access — have another admin do it.</div>' : ""}
          <div class="hint">Businesses (ignored if platform admin is checked):</div>
          ${businessCheckboxes(businesses, userBusinessIds[user.id] ?? [])}
          <div><button type="submit" style="margin-top:8px;">Save access</button></div>
        </form>`;
      })
      .join("")}

    <form method="post" action="/settings/users">
      <label>Add a user — email</label>
      <input type="email" name="email" required />
      <label>Password</label>
      <input type="password" name="password" minlength="8" required autocomplete="off" />
      <label>Confirm password</label>
      <input type="password" name="confirmPassword" minlength="8" required autocomplete="off" />
      <label style="display:inline-flex; align-items:center; gap:6px; font-weight:400; margin-top:12px;">
        <input type="checkbox" name="isPlatformAdmin" style="width:auto;" />
        Platform admin (full access to every business)
      </label>
      <div class="hint">Or assign to specific businesses (ignored if platform admin is checked):</div>
      ${businessCheckboxes(businesses, [])}
      <button type="submit">Add user</button>
    </form>
  `,
  );
}

