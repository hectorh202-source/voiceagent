# The `/settings` app

This doc covers credentials/settings management and the auth flow that gates it — routes, auth flow, and how form saves work. The name is a holdover: `/settings` itself is now just a redirect, and every page it once served (the admin console, the auth screens) lives in the React SPA at `/app/*`. For how the data underneath it is actually stored/encrypted, see [sqlite-storage.md](sqlite-storage.md); this doc is about the app layer built on top of that storage.

## Why this exists

The platform needs credentials for ElevenLabs and ServiceTitan, plus a couple of operational values (an emergency transfer number, a shared secret for tool auth). Rather than a `.env` file, these are entered through a small password-protected web UI and stored encrypted in the local database. This was a deliberate project requirement: no credential should live in code or in an env file on disk, since the server is routinely exposed to the public internet (via ngrok in dev, or a real domain in production), and a login-gated UI backed by encrypted storage was judged a better fit than a plaintext `.env` file sitting in the deployed code.

## Routes

The pre-session auth flow (first-run setup, legacy-password migration, login, forgot-password, reset-password) is now part of the React SPA, not server-rendered HTML — the last piece of the app to make that move, after the business/user admin console did the same earlier. It's backed by a JSON API, [`src/api/authRouter.ts`](../src/api/authRouter.ts), mounted at `/api/auth` with no session requirement (every route here is meant to work without an existing session, including logout):

| Route | Method | Auth required | Purpose |
|---|---|---|---|
| `/api/auth/state` | GET | none | `{ state: "fresh"\|"needs_migration"\|"ready", authenticated: boolean }` — the SPA's single bootstrap call for every pre-session page, used both to pick the right screen and to detect an already-logged-in visitor |
| `/api/auth/setup` | POST | none (409s if state isn't `"fresh"`) | First-run: create the first platform account (email + password) — always created as a platform admin |
| `/api/auth/migrate` | POST | none (409s if state isn't `"needs_migration"`) | One-time: convert the old single admin password into the first real account — always created as a platform admin |
| `/api/auth/login` | POST | none | Log in with email + password |
| `/api/auth/forgot-password` | POST | none | Request a password-reset email (see [Password reset](#password-reset) below) |
| `/api/auth/reset-password` | GET, POST | none (the token in the URL/form *is* the credential) | GET validates a token without consuming it; POST sets a new password from a valid, unexpired, unused reset token |
| `/api/auth/logout` | POST | none (no-ops harmlessly without a session) | Destroy the session |

Each of the five pre-session screens is a route component in `client/src/pages/auth/` (`LoginPage`, `SetupPage`, `MigratePage`, `ForgotPasswordPage`, `ResetPasswordPage`), served at `/app/login`, `/app/setup`, `/app/migrate`, `/app/forgot-password`, `/app/reset-password`. They're siblings of the authenticated route tree in `client/src/App.tsx`, not children — each wrapped in `client/src/auth/AuthPageGate.tsx`, which calls `/api/auth/state` and redirects to whichever screen actually matches the current state (mirroring the old server-side `getAuthState()` dispatch), or straight to `/` if already authenticated.

The old server-rendered routes at `/settings/{setup,migrate,login,forgot-password,reset-password}` still exist as thin `302` redirects to their `/app/...` equivalent (query string forwarded verbatim) — kept only for the transition window so an already-sent password-reset email (`/settings/reset-password?token=...`) keeps working. New reset emails point at `/app/reset-password` directly. `GET /settings` and the top-level `GET /` both simply redirect to `/app`.

**The business-list/user-management console and the per-business credentials form both now live entirely in the React SPA, not server-rendered forms.** The old server-rendered console (`renderBusinessListPage` plus the `/settings/businesses`, `/settings/users`, `/settings/users/:id/access`, `/settings/users/:id/delete` POST routes) and the old per-business form (`src/settings/businessRoutes.ts`, `GET`/`POST /b/:businessId/settings`) were both deleted once the SPA covered the same functionality:

- Business-scoped credentials: `client/`'s `BusinessInfoSettingsPage`/`GeneralSettingsPage`, served at `/app/:businessId/settings/business-info` and `/app/:businessId/settings/general`.
- Business/user management: `client/src/pages/AdminSettingsPage.tsx`, served at the business-agnostic `/app/admin` (see [Per-business access control](#per-business-access-control--platform-admins-vs-scoped-users) below).

Both talk to a JSON API instead of posting an HTML form:

| Route | Method | Auth required | Purpose |
|---|---|---|---|
| `/api/businesses/:businessId/settings/business-info` | GET, PUT | API session + valid business | Business name, default ServiceTitan business unit/campaign/job type IDs, service categories — visible to any user with access to the business, not just admins |
| `/api/businesses/:businessId/settings/general` | GET, PUT | API session + **platform admin** | ElevenLabs/ServiceTitan credentials & environment, tag name, booking mode, operational settings — credentials, so platform-admin-only regardless of business access |
| `/api/businesses/:businessId/settings/general/generate-secret` | POST | API session + platform admin | Generate + save a new random tool webhook secret for that business |
| `/api/admin/businesses` | GET, POST | API session + platform admin | List/create businesses |
| `/api/admin/users` | GET, POST | API session + platform admin | List every platform user (with each one's `businessIds`) / add a new **platform admin** (email + password — this endpoint no longer accepts a business assignment; see below) |
| `/api/admin/users/:id/access` | POST | API session + platform admin | Update an *existing* user's platform-admin flag (business assignment is ignored here now — see the per-business routes) |
| `/api/admin/users/:id` | DELETE | API session + platform admin | Delete a platform user's account entirely (not yourself) |
| `/api/admin/businesses/:businessId/users` | POST | API session + platform admin | Create a **brand-new**, non-admin user scoped only to this one business |
| `/api/admin/businesses/:businessId/users/:userId` | DELETE | API session + platform admin | Unassign an existing user from just this business — their account (and access to any other business) is untouched |
| `/api/admin/email-settings` | GET, PUT | API session + platform admin | SMTP host/port/secure/username/password/from-address used to send password-reset emails (see [Password reset](#password-reset) below) |
| `/api/admin/email-settings/test-email` | POST | API session + platform admin | Sends a real test email to a given address, using whatever SMTP settings are currently saved — the fastest way to confirm a provider's settings are correct before relying on them |
| `/api/admin/twilio-settings` | GET, PUT | API session + platform admin | The single master Twilio account (Account SID / Auth Token) used for human-portion call recording — global, see [call-dashboard.md](call-dashboard.md) |
| `/api/admin/google-ads-settings` | GET, PUT | API session + platform admin | The Google Ads *platform* identity (Developer Token, OAuth Client ID/Secret, Manager Customer ID) — global, see [google-lsa-leads.md](google-lsa-leads.md) |
| `/api/admin/widget-service-settings` | GET, PUT | API session + platform admin | Global chat widget service config: its base URL, and the operator's "Powered by" name/link shown in every widget footer |
| `/api/admin/widget-service-settings/generate-secret` | POST | API session + platform admin | Generate + save the shared secret the chat widget service authenticates with (confirm-gated — rotating it takes every client's widget offline) |
| `/api/businesses/:businessId/settings/chat-widget` | GET, PUT | API session + **platform admin** | That business's chat widget config (enable, Anthropic key, model, branding, logo, quick prompts, allowed domains, extra instructions) — see [chat-widget.md](chat-widget.md) |
| `/api/businesses/:businessId/settings/chat-widget/rotate-embed-key` | POST | API session + platform admin | Rotate that business's public embed key, invalidating every install snippet already deployed |
| `/api/widget-service/businesses/:businessId/config` | GET | **`X-Widget-Service-Secret`** (no session) | Service-to-service: hands the standalone chat widget service one business's full config, including the tool/lead-intake secrets it calls back with. Deliberately outside the session-gated routers — see [chat-widget.md](chat-widget.md) |

`src/api/businessRouter.ts` is gated by `requireApiSession` (`src/api/requireApiSession.ts`) — the same session check as `requireAdminSession` below, just responding `401` JSON instead of redirecting, since the caller is the SPA's `fetch()`, not a browser navigation. `src/api/adminRouter.ts` is additionally gated by `requireApiPlatformAdmin` (`src/api/requireApiPlatformAdmin.ts`), the JSON equivalent of `requirePlatformAdmin` — as are the two `GET`/`PUT`/`POST` `/settings/general*` routes on `businessRouter.ts` specifically (unlike `business-info`, which stays open to any business-access user).

Every `/b/:businessId/*` route (the ElevenLabs tool webhooks, the post-call webhook, and the public call-detail dashboard) and every `/api/businesses/:businessId/*` route sits behind [`src/middleware/resolveBusiness.ts`](../src/middleware/resolveBusiness.ts). It parses `:businessId`, looks up the business, and 404s immediately if it's not a valid positive integer or doesn't match a real business — before any auth/secret check downstream even runs, so an invalid business ID never leaks a confusing 401/503 for something that doesn't exist. One easy-to-miss Express detail that bit this during development: a child `Router()` mounted at a path containing `:businessId` **must** be created with `Router({ mergeParams: true })`, or it gets its own empty `req.params` scope and `resolveBusiness` never sees `:businessId` at all.

### First-run vs. migration vs. normal flow

`getAuthState()` in `auth.ts` is the single source of truth every entry point branches on:

```
getAuthState():
  users table has any rows?      → "ready"
  else: legacy admin.passwordHash setting exists?  → "needs_migration"
  else                                              → "fresh"

GET /api/auth/state
  → { state, authenticated }   — the client picks the matching /app/{setup,migrate,login} screen
```

`/app/setup` and `/app/migrate` are both effectively one-time routes — once `getAuthState()` returns `"ready"`, `AuthPageGate` redirects either one to `/app/login` instead of re-running first-run setup.

## Multi-user auth

The app moved from a single shared admin password to real per-user accounts (`src/db/users.ts`, table `users` — email, scrypt password hash/salt, failed-attempt/lockout counters), orchestrated by a thin [`src/settings/auth.ts`](../src/settings/auth.ts). There's no standalone admin-session middleware anymore — since every authenticated page now lives in the SPA behind one structural gate (`requireAppAccess` in `src/index.ts`, covered under [Per-business access control](#per-business-access-control--platform-admins-vs-scoped-users) below), the plain (non-JSON) `requireAdminSession`/`requirePlatformAdmin` middleware were deleted once their one remaining caller (the old server-rendered `/settings` console) was gone; the JSON API equivalents, `requireApiSession`/`requireApiPlatformAdmin`, are untouched.

- **Password check**: same primitive as before — Node's built-in `scrypt` (random salt, `timingSafeEqual` comparison) — now scoped per user row instead of one global setting. See [sqlite-storage.md](sqlite-storage.md#admin-password-hashed-not-encrypted) for the hashing detail (still accurate, just applied per-user now).
- **Session check**: `req.session.userId` (not a boolean) is re-validated against the `users` table on *every* request — so deleting a user immediately kills their live session rather than waiting for their next login attempt.
- **Brute-force protection**, entirely in `db/users.ts`'s `attemptLogin()`:
  - Per-account lockout: 5 wrong passwords locks that account for 15 minutes (`locked_until`, persisted in SQLite — survives a restart, same as sessions).
  - A dummy `scrypt` hash is computed even when the submitted email doesn't match any user, so a nonexistent-email attempt costs the same time as a real one — avoids leaking account existence via response timing.
  - Login failures always render the identical message, `"Invalid email or password."`, whether the email doesn't exist, the password is wrong, or the account is currently locked — a locked-out admin isn't told why (see [Removing a user](#removing-a-user) below for how to clear a lockout directly).
  - Separately, [`src/middleware/loginRateLimiter.ts`](../src/middleware/loginRateLimiter.ts) throttles by IP (20 failed attempts / 15 min, in-memory — intentionally not persisted, since only the per-account lockout needs to survive a restart). Requires `app.set("trust proxy", 1)` in `index.ts` so `req.ip` reflects the real client through Caddy rather than its internal address.

### Upgrading an existing deployment

An already-running instance has a legacy `admin.passwordHash`/`admin.passwordSalt` in the `settings` table and no `users` rows yet. After deploying this change, the admin is redirected to `/app/migrate`: entering the *current* password plus an email creates the first real user account (re-hashed fresh, not copying the old hash bytes) and deletes the legacy settings keys. The old password keeps working right up through that one migration step — there's no lockout risk during the upgrade.

Note that `/tools/*` (the ElevenLabs webhook endpoints) are a **completely separate auth mechanism** — a shared secret header, not a login session, since ElevenLabs' servers obviously can't fill out a login form. See [elevenlabs-tools.md](elevenlabs-tools.md).

### Server-side auth checks aren't enough on their own — the browser's back/forward cache

Found via real testing: logging out and back in as a different user in the *same browser tab*, then pressing the browser's **back** button, could show a previously-rendered authenticated page (e.g. the platform-admin admin console) even though the current session belongs to a different, non-admin user. The cause isn't a bug in the session/access checks — those still run correctly on every real request. It's the browser's **back/forward cache (bfcache)**: modern browsers can restore a previously-rendered page (the full DOM, sometimes the whole JS heap) straight from memory when you navigate back, without ever asking the server again — so a per-request auth check simply never gets the chance to run.

Fixed in two layers:
1. **`src/middleware/noStore.ts`** — sets `Cache-Control: no-store, no-cache, must-revalidate, private` + `Pragma: no-cache` on every authenticated response: `/api/*` and the React SPA's HTML shell under `/app/*` (which now includes the 5 pre-session auth pages too, all served from the same shell). `no-store` is the one directive that reliably disqualifies a response from both the regular HTTP cache and bfcache in current browsers, forcing a real round-trip to the server (and therefore a fresh auth check) on every back/forward navigation. **A real gotcha hit while wiring this up**: `express.static(clientDistPath)` was serving `index.html` directly for a bare `GET /app` (its default directory-index behavior) — bypassing the `noStore`-guarded catch-all entirely, confirmed via a real request coming back `Cache-Control: public, max-age=0` instead of `no-store`. Fixed by mounting the static middleware with `{ index: false }`, forcing every request for the HTML shell through the catch-all that actually sets the header.
2. **A `pageshow` listener** in `client/src/main.tsx` that calls `window.location.reload()` whenever `event.persisted` is true. This is the belt-and-suspenders layer for browsers that might still bfcache a page despite `no-store` (Safari has historically been more permissive here than Chrome/Firefox) — a persisted-page restore forces an immediate real reload instead of silently continuing to show frozen, possibly stale-user state. Since every page in the app — auth and authenticated alike — is now the same SPA shell, this one app-wide listener covers all of it; there's no separate server-rendered copy of this logic to keep in sync anymore.

**What this doesn't fix, because it isn't a caching bug**: a browser's own saved-password autofill can still offer to fill a previously-used email/password into the login form — that's the browser's password manager working as designed (and deliberately hard for a site to suppress; `autocomplete="off"` is widely ignored by browsers on login forms for exactly this reason). Verified via a real repro of the reported scenario that the *page content itself* (the actual security concern — a stale authenticated console rendering for the wrong user) is fixed: after this change, repeatedly pressing back as a freshly-logged-in non-admin user always re-renders fresh from the server and correctly redirects away from the admin console, rather than showing the previous session's cached page.

### A currently-logged-in user landing on the login page

A related but separate gap, also found via real back-button testing: `noStore` + the `pageshow` reload guarantee that pressing back always gets a **fresh** server response rather than a bfcache-frozen one — but a fresh response isn't automatically the *right* one. Enough back-presses could land a real, live-session user on a genuine, freshly-rendered login form — not stale/cached content, just the wrong page for someone who's already authenticated. Real enterprise apps don't let an authenticated user see a login screen at all.

Fixed at two levels, matching the app's usual server-side-structural-plus-client-side-defense-in-depth pattern: **server-side**, `requireAppAccess` in `src/index.ts` redirects an already-authenticated session straight to `/app` before the shell is even sent for any of the 5 public auth paths; **client-side**, `AuthPageGate` (wrapping each of those 5 pages) calls `/api/auth/state` and redirects to `/` the instant `authenticated: true` comes back — covering the case a stale bfcache-restored auth page reloads and re-checks client-side without a fresh server round-trip. A logged-out visitor (no session, or a stale session for a deleted user) still sees the real login form exactly as before.

### Password reset

`POST /api/auth/forgot-password` and `GET`/`POST /api/auth/reset-password` (`src/api/authRouter.ts`), backed by `src/db/passwordResetTokens.ts` and `src/settings/email.ts`. Requires SMTP settings to be configured first (`/app/admin`'s Email Settings section, or `/api/admin/email-settings` — see the Routes table above); until then, a reset request is silently swallowed (logged server-side, never surfaced to the caller — see below for why).

**Token design**: `createPasswordResetToken(userId)` generates 32 random bytes (`crypto.randomBytes`), stores only its SHA-256 hash plus a 1-hour expiry and a `used_at` column, and returns the raw token exactly once — the only place it ever exists in plaintext is the emailed link and the requesting browser. A DB read alone (a backup, a leaked snapshot) can't be turned into a working reset link, same principle as password hashing. Requesting a new token first invalidates any still-outstanding one for that user, so at most one reset link is ever live. `consumeResetToken()` (the only path that sets `used_at`) is called exclusively from the `POST` handler, so a token is spent the moment it's actually used — the `GET` handler only *peeks* (`isValidResetToken()`) to decide whether the client shows the "set a new password" form or an "invalid or expired" screen, without burning the token just for having been looked at. The emailed link points straight at `/app/reset-password?token=...` — no longer `/settings/reset-password`.

**No account-existence leak**: `POST /api/auth/forgot-password` calls `getUserByEmail()` and, if found, creates a token and sends the email — but returns the exact same JSON response whether or not a match was found, and regardless of whether sending itself succeeded (a misconfigured SMTP provider is logged server-side via `console.error`, never surfaced to the response). Confirmed via a real side-by-side request (and again through the actual UI): a real registered email and a made-up one return byte-identical response bodies.

**Rate limited separately from login**: `isForgotPasswordRateLimited()`/`recordForgotPasswordRequest()` in `middleware/loginRateLimiter.ts` are a second per-IP counter alongside the existing login one (10 requests / 15 min, vs. login's 20) — a burst of reset requests shouldn't consume or be gated by login-attempt budget, since they're different abuse patterns.

**Successful reset auto-logs in**: `setPassword()` (in `db/users.ts` — the only other place besides `createUser()` that ever writes a password) also clears any brute-force lockout, since proving control of the account's email is at least as strong a signal as a correct password. `POST /api/auth/reset-password` sets `req.session.userId` directly and returns `{success:true}`; the client then navigates to `/` — no need to separately log in right after proving ownership of the account.

**A real bug caught while writing the cleanup script for this feature's own testing**: `node:sqlite` enforces foreign keys, so `deleteUser()` on a user with an outstanding (unused) reset token used to throw an unhandled `FOREIGN KEY constraint failed` instead of removing them — the exact same shape of bug already fixed once for `user_businesses`. Fixed by having `deleteUser()` clear that user's `password_reset_tokens` rows in the same transaction, alongside `user_businesses`.

**SMTP settings** (`getSmtpConfig()`/`getRawEmailSettings()` in `settings/store.ts`, keyed `email.smtpHost`/`email.smtpPort`/`email.smtpSecure`/`email.smtpUsername`/`email.smtpPassword`/`email.fromAddress`/`email.fromName`) are global, encrypted `settings` rows — not business-scoped, since login isn't tied to any one business. `getSmtpConfig()` is strict/all-or-nothing (a partial config can't send at all, so it's treated identically to no config), mirroring `getServiceTitanConfig()`'s reasoning. `src/settings/email.ts` wraps `nodemailer`, building one transport per send from whatever's currently saved — `sendPasswordResetEmail()` and `sendTestEmail()` (used by the admin UI's "Send test email" button, `client/src/pages/AdminSettingsPage.tsx`) share the same transport/from-address logic. Verified against a real (if throwaway) SMTP account — [Ethereal](https://ethereal.email), nodemailer's own testing service — confirming the full pipeline (encrypted settings → transport creation → real SMTP send) actually works, not just that the code compiles.

### Per-business access control — platform admins vs. scoped users

Every user is either a **platform admin** (`users.is_platform_admin`) or scoped to specific businesses via a `user_businesses` join table (`user_id, business_id`, simple membership — no per-business role tiers, just "has access" or doesn't). Platform admins bypass the membership table entirely and see/edit every business, exactly like every user did before this existed; a scoped (non-admin) user can only see and act on the businesses they're explicitly assigned to.

**Enforcement is deliberately narrow** — added in exactly two places, since most of this app's surfaces have their own unrelated auth already:
- **`src/middleware/requireBusinessAccess.ts`**, mounted on `src/api/businessRouter.ts` right after `resolveBusiness`/`requireApiSession` — every `/api/businesses/:businessId/*` call (calls, metrics, settings) 403s for a business the current user isn't assigned to. `GET /api/businesses` (the SPA's business switcher and `FirstBusinessRedirect`) is scoped the same way via `listBusinessesForUser()` — a scoped user simply never sees a business they don't have access to, no client-side filtering needed.
- **`requireAppAccess` in `src/index.ts`** enforces the equivalent check for the global admin console's shell (`/app/admin`) — a scoped user has no reason to see every business/user in the system, so hitting it redirects them straight to `/app` (which resolves to their own first assigned business). See the two-layer breakdown below.

`/b/:businessId/tools/*` and `/webhooks/*` (shared-secret auth, unrelated to user sessions) and the public `/b/:businessId/calls/:conversationId` page (deliberately unauthenticated) are untouched by any of this.

**Migration**: `src/db/migrateUserBusinessAccess.ts` marks every *existing* user a platform admin on deploy — zero surprise/lockout, matching the full access they already had. Only users created *after* this shipped default to scoped/non-admin. The very first account (via `/app/setup` or `/app/migrate`) is always created as a platform admin, since there's no one else yet to grant them access.

**Admin Settings is split into a global page and a per-business page, both `client/src/pages/AdminSettingsPage.tsx`** (one component, branching on whether `useParams().businessId` is present):

- **`/app/admin`** (business-agnostic, no `:businessId`) — Businesses list + "Add a business" form, and a **Platform Admins** list (every user with `isPlatformAdmin: true`): each row can flip that flag off (`POST /api/admin/users/:id/access`, always sending `businessIds: []` from this page — business assignment doesn't happen here anymore) or delete the account entirely (`DELETE /api/admin/users/:id`). "Add a platform admin" only takes an email + password — there's no business-checkbox grid on this page at all; the form always creates the user with `isPlatformAdmin: true`.
- **`/app/:businessId/admin`** (nested, reached by picking a business from the switcher while anywhere in the Admin section) — that one business's **Users**: every non-admin user currently assigned to it, each with a **Remove** button that unassigns *only this business* (`DELETE /api/admin/businesses/:businessId/users/:userId` — the account and any other business's access stays untouched, confirmed via a real test: removing a user this way left their row intact with `businessIds: []`, not deleted). Below that, an "Add a user" form creates a **brand-new** account scoped only to this business (`POST /api/admin/businesses/:businessId/users`) — there's no way to grant an *existing* user (one already working at a different business) access to a second business from this UI; that's a deliberate scope cut, not an oversight. Below the Users section, the page embeds `GeneralSettingsPage` directly (the same component previously reached via its own nav link — see below) — this business's ElevenLabs/ServiceTitan credentials and operational settings, now only reachable from here.

The **motivation** for this split (moved from the earlier all-in-one design, where a global checkbox-grid assigned any user to any set of businesses): user management now happens where it's actually relevant — go to the business, manage its users there — rather than scrolling a global roster checking boxes across every business at once. The only thing that stays global is *who's a platform admin*, since that's inherently a system-wide concern, not a per-business one.

A user can't revoke their own platform-admin flag from the global page (mirrors the existing "can't delete your own account" guard) — the checkbox renders disabled for your own row, and the server rejects it too, to avoid a self-lockout with no one else able to restore access.

**Routing**: `/app/admin` and `/app/:businessId/admin` are two separate `<Route>`s in `client/src/App.tsx` (one top-level, one nested under `/:businessId` alongside `calls`/`metrics`/`settings/business-info`), both rendering the same `AdminSettingsPage`. `AppShell`'s sidebar has **two separate admin links**, both shown only when `currentUser.isPlatformAdmin` (so a scoped user never sees either): an "Admin Settings" link in the main nav, next to Channels/Settings, pointing at whichever business is currently selected (`/${businessId}/admin`) — shown only when a business is selected, since there's nothing to link to otherwise — and a "Global Admin Settings" link down in the sidebar footer next to the logged-in email/logout, always pointing at the business-agnostic `/app/admin` regardless of what business (if any) is currently selected. `BusinessSwitcher.tsx` has one special case for navigating *out* of the business-agnostic `/admin` page — picking a business there navigates to `/app/:businessId/admin` (staying in the admin section) rather than the generic "swap the businessId segment" logic, which would otherwise send you to that business's Calls page. Switching businesses while already on `/app/:businessId/admin` uses the generic logic normally, landing on the new business's `/admin` page directly.

Two layers of enforcement, not one:
1. **Server-side, structural, in `src/index.ts`'s `requireAppAccess`** — a single gate ahead of the `GET /app/*` catch-all that every `/app/*` HTML request passes through before the shell is ever sent, so a page added later inherits the right check automatically just by living at `/app/admin`, `/app/:businessId/admin`, or `/app/:businessId/...`, with no per-route code to remember. The first two path segments decide the branch: (1) is the first segment one of the 5 public auth paths (`login`/`setup`/`migrate`/`forgot-password`/`reset-password`) — if so, bounce an already-authenticated session to `/app`, otherwise let the request through unauthenticated (this is what makes those 5 pages reachable without a session at all); (2) otherwise, is there a valid session (`req.session.userId` resolving via `getUserById()`) — if not, redirect to `/app/login?returnTo=...`; (3) is the path exactly `/app/admin` — if so, require `isPlatformAdmin`; (4) does the path start with `/app/:businessId/...` — if so, require `userHasBusinessAccess()` for that specific business (the exact same check `requireBusinessAccess` already enforces on the JSON API, just applied to the shell too), **and**, if the segment right after the business ID is `admin`, *additionally* require `isPlatformAdmin` — business access alone isn't enough for a business's own admin console, a scoped user with legitimate access to that business still can't reach `/app/:businessId/admin`. Any of these failing redirects to `/app` (or `/app/login` for no session) before any HTML is sent.
2. **Client-side, in `AdminSettingsPage.tsx`** — a defense-in-depth check that redirects to `/` (via `<Navigate to="/" replace />`) if `currentUser.isPlatformAdmin` is somehow false anyway, for both the global and per-business modes. This is what actually fires for the one case the server-side gate can't see: a bfcache-restored admin document (e.g. right after logging out and back in as a different, non-admin user and hitting the browser's back button) reloading fresh and re-fetching the session client-side, without a fresh server request for the server-side gate to intercept.

Before `requireAppAccess` existed, every business-scoped page (`/app/:businessId/calls`, `/metrics`, `/settings/business-info`) had the same shape of gap as `/app/admin` did: the shell was served for *any* `businessId`, and only the underlying `/api/businesses/:businessId/*` data calls were actually protected (by `requireBusinessAccess`). Each page degrades gracefully on a `403` (empty list, blank form) rather than leaking another business's data, so this was never a data leak — but the URL itself resolved to real (if empty) content instead of never loading, for a business a user didn't own. `requireAppAccess` closes that the same way it closes the admin case, for every `:businessId` route at once, not just the ones that exist today.

`src/settings/routes.ts`'s `GET /settings` handler is now nothing more than an unconditional redirect to `/app` (`requireAppAccess` itself decides where an admin vs. non-admin visitor actually lands) — the old server-rendered business/user console (`renderBusinessListPage` and its four POST handlers) was deleted once this became the SPA's job, matching the same "delete fully-superseded code" pattern used earlier when `renderCallListPage`/`businessRoutes.ts` were deleted during the original React dashboard rebuild.

**A real bug caught during live testing**: `node:sqlite` enforces foreign keys by default, so `deleteUser()` on a scoped user with rows in `user_businesses` used to throw an unhandled `FOREIGN KEY constraint failed` instead of removing them (the existing "Remove" button would have 500'd for any non-admin user). Fixed by having `deleteUser()` delete that user's `user_businesses` rows in the same transaction before deleting the user row itself.

### Removing a user

**Normal path**: log in as a platform admin, visit `/app/admin` (`/settings` also gets you there — it now redirects unconditionally to `/app`, from which the sidebar's "Global Admin Settings" link goes to `/app/admin`), find the user in the **Users** section, click **Remove**. You can't remove your own currently-logged-in account this way (`DELETE /api/admin/users/:id` rejects it) — log in as a different user to remove one.

**If the UI isn't an option** (e.g. it's the only account, or you're locked out): edit the `users` table directly. On the VPS, following the same `docker compose exec app node -e "..."` one-off-script pattern used elsewhere in this project (e.g. for looking up ServiceTitan campaign/tag IDs):

```bash
docker compose exec app node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/app.db');
  console.log(db.prepare('SELECT id, email, locked_until FROM users').all());
"
# then, to remove one:
docker compose exec app node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/app.db');
  db.prepare('DELETE FROM users WHERE id = ?').run(<id>);
"
```

The same technique clears a brute-force lockout early instead of waiting out the 15 minutes:

```bash
docker compose exec app node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/app.db');
  db.prepare('UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE email = ?').run('someone@example.com');
"
```

## How saving the form works

Both settings forms — `BusinessInfoSettingsPage` and `GeneralSettingsPage` (the latter now embedded in `/app/:businessId/admin` rather than its own routed page) — each `PUT` their whole form to their respective `/api/businesses/:businessId/settings/*` endpoint in one request (see `src/api/businessRouter.ts`). Both handlers share one small helper, now living in `src/settings/store.ts` (moved there from the old `businessRoutes.ts` so both the API and any future caller can reuse it):

```ts
export function maybeSetBusinessSetting(businessId: number, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setBusinessSetting(businessId, key, trimmed);
  }
}
```

Every secret/optional field goes through this: **if you left it blank, it's left alone in the database — not cleared.** This is why secret fields (API keys, client secret, tool webhook secret) show as empty password inputs with a placeholder like "(set — leave blank to keep)" rather than ever re-displaying the actual secret — you only need to type a new value when you actually want to change it.

The exception is `servicetitan.environment` (the Integration/Sandbox vs. Production dropdown) and a few other `<select>`-backed fields (booking mode), which are always written on every save, since a dropdown always submits *some* value — there's no "blank" state to distinguish from "user didn't touch this."

### The bug this design fixes

Earlier, the settings page read fields in groups through combined getters (e.g. one function that returned all ElevenLabs settings, or `null` if *any* of them was missing). That caused two real problems:
1. If you'd saved just one field in a group, the page would render the *whole group* as blank, because the combined getter refused to return anything unless every field in the group was present.
2. Saving a different field in the same group — with the actually-saved field's input left blank as "unchanged" — would go through the old combined *setter*, which used the (now-`null`) combined getter as its fallback for "keep the current value," silently writing an empty string over a real, already-saved secret.

The fix was moving to **per-field reads and writes** everywhere in the settings app (`getRawElevenLabsSettings(businessId)`, `getRawServiceTitanSettings(businessId)`, `getRawOperationalSettings(businessId)` in `store.ts`), so no field's fate depends on any other field's presence. The one place a strict "all-or-nothing" check still exists is `getServiceTitanConfig(businessId)` — but that's used only by the actual ServiceTitan API client, which genuinely can't function without every required credential, so gating there is correct rather than accidental. Full detail in [sqlite-storage.md](sqlite-storage.md#why-key-value-instead-of-typed-columns).

### Global settings vs. business settings

`src/settings/store.ts` has two parallel families of functions: `getSetting`/`setSetting`/`hasSetting`/`deleteSetting` operate on the `settings` table, while `getBusinessSetting`/`setBusinessSetting`/`hasBusinessSetting`/`deleteBusinessSetting` operate on `business_settings`, keyed by `(business_id, key)`. Every ElevenLabs/ServiceTitan/Operational credential goes through the business-scoped versions — see [sqlite-storage.md](sqlite-storage.md) for the table shapes and why the split exists rather than one table with a sentinel "global" business ID.

The split follows one rule: **is this value the same for every business, or genuinely per-business?**

| Table | What lives here |
|---|---|
| `settings` (global) | Session secret + dormant legacy admin password; SMTP (password reset); the single master Twilio account; the Google Ads *platform* identity (Developer Token, OAuth Client ID/Secret, Manager Customer ID); the chat widget service's shared secret, base URL, and the operator's "Powered by" branding |
| `business_settings` (per-business) | ElevenLabs API key + Agent ID; all ServiceTitan credentials and defaults; operational values (timezone, dashboard base URL, tool webhook secret, post-call secret, Twilio number, lead intake secret, dynamic memory); that business's own Google Ads refresh token + Customer ID; every `chatWidget.*` value plus its Anthropic API key |

The recurring pattern for external platforms: one shared *platform identity* the operator registers once goes global, while each business's own account credentials stay per-business. Google Ads is the clearest example — see [google-lsa-leads.md](google-lsa-leads.md).

## The rendered page itself

Every page in the app, including the 5 pre-session auth screens, is now the same React SPA — `src/settings/views.ts` (the old template-literal HTML renderer) and the two now-unused plain session middlewares it depended on (`requireAdminSession.ts`, `requirePlatformAdmin.ts`) were deleted entirely once the auth pages moved to `client/src/pages/auth/`. There's no more server-rendered HTML anywhere in the app outside of Express's own default error pages.

The 5 auth pages (`LoginPage`, `SetupPage`, `MigratePage`, `ForgotPasswordPage`, `ResetPasswordPage`) each render inline via local component state — no full-page redirect-and-flash cycle, since a React component can just re-render with an error after a failed `fetch()`. `client/src/auth/AuthLayout.tsx` is the shared wrapper (ported verbatim from the old `page()`/`authStyles`): a two-panel `.auth-shell` layout — a dark brand panel (logo mark, tagline) on the left, the actual form card on the right, collapsing to just the form below 860px wide — plus a small `Flash` component for the inline success/error banner. Since this is now real CSS in `client/src/index.css` rather than a second copy-pasted stylesheet living in server-rendered HTML, the auth pages and the rest of the app share color tokens by construction — the old risk of the two visually drifting apart (previously called out here as a known gotcha) no longer applies. Both light and dark mode are supported via the same `prefers-color-scheme` media query pattern the rest of the client uses.

**Content Security Policy**: with no inline `<script>` left anywhere in the app (the old bfcache-reload script that lived inline in `views.ts`'s `page()` wrapper is gone along with it — the equivalent listener has always been regular bundled JS in `client/src/main.tsx`), `src/middleware/securityHeaders.ts`'s `script-src` simplified from `'self' 'sha256-<hash>'` down to a clean `'self'`, with no hash exception to maintain.

## Guardrails against accidental edits

A few fields break things silently if changed by mistake (a stray click, a misplaced keystroke), with no server-side error to catch it — so the UI adds friction before it happens rather than relying on being careful. The mechanism changed with the SPA rewrite, but the same fields are guarded and the same reasoning applies:

- **`GeneralSettingsPage.tsx`'s `getCriticalChangeWarnings()`** runs before every save, comparing the current form values against what was loaded from the API — if **Agent ID**, **Tenant ID**, **Lead tag name**, or **Booking Mode** differ from their loaded value, each produces a warning. These are shown one at a time through the app's own styled `ConfirmDialog` (a queue, since a dialog can't block synchronously the way the original `window.confirm()` did); cancelling any one aborts the save entirely and the mutation never fires. There's no separate "unlock" step before editing — the field is always editable, and the confirmation only fires at save time based on what actually changed.
- **Every "Generate a new secret" control is gated by a `ConfirmDialog`** — the tool webhook secret and lead intake secret (`GeneralSettingsPage.tsx`), the per-business chat widget **embed key** rotation, and the global **widget service secret** (`AdminSettingsPage.tsx`). Each warns about its specific blast radius: a tool secret breaks that one business's ElevenLabs tool calls; the embed key stops every already-deployed install snippet for that business; the widget service secret takes **every** client's chat widget offline until the new value is set on the server and restarted. In all four cases the confirm only fires when a secret is **already set** — first-time generation has nothing live to break, so it runs immediately. Regenerating one business's secret never affects another's.
- **A newly generated secret is shown exactly once**, in a `SecretRevealModal` ("copy it now — it will be masked after you leave this page"). The server returns the plaintext only in that one response; afterwards the API reports it as set/unset and nothing more, so a lost secret is rotated rather than recovered.

None of this is server-enforced; it's UI-only friction on top of the same `PUT /api/businesses/:businessId/settings/general` endpoint described above (which does independently enforce `requireApiPlatformAdmin` server-side — that part isn't just UI friction).

## Fields in the form, grouped

Split across the SPA's two settings pages (was one combined form before the rebuild) — every business configures these independently, with zero shared state between businesses:

| Page | Fields |
|---|---|
| **Business Info** (`/app/:businessId/settings/business-info`, any business-access user) | Business name, default ServiceTitan Business Unit ID / Campaign ID / Job Type ID, the 10-row service categories grid |
| **General** (embedded in `/app/:businessId/admin`, **platform admins only**) | ElevenLabs API key + Agent ID; ServiceTitan Environment, Client ID, Client secret, App key, Tenant ID, Call reason ID, Lead tag name, Booking mode; Operational timezone, Dashboard base URL, tool webhook secret, post-call webhook secret, Twilio phone number, lead intake secret, cross-call memory toggle; Google Ads Customer ID + refresh token |
| **Chat Widget** (also embedded in `/app/:businessId/admin`, **platform admins only**) | Enable toggle, Anthropic API key, model; appearance (assistant name, accent colour, tagline, logo URL, greeting, quick prompts); extra assistant instructions; allowed website domains; the install snippet + embed key rotation — see [chat-widget.md](chat-widget.md) |

The split follows what each field is *for*: Business Info holds the values that map a call to the right ServiceTitan business unit/job type (the things a client themselves might reasonably tweak), while General holds credentials and lower-level operational config — admin-only, and no longer a separate nav item under Settings; it moved into that business's own admin console (`GeneralSettingsPage.tsx` is unchanged internally, just rendered as a section of `AdminSettingsPage.tsx` instead of its own routed page).

`operational.timezone` only affects how call times are formatted on that business's call-detail dashboard — it's deliberately unrelated to ElevenLabs' own per-agent time zone setting, which governs the agent's time-awareness *during* a call (greetings, business hours, relative dates). Changing one has no effect on the other; see [call-dashboard.md](call-dashboard.md) for detail.

See [servicetitan-integration.md](servicetitan-integration.md) for what the ServiceTitan fields are actually used for, and [elevenlabs-tools.md](elevenlabs-tools.md) for the operational fields' role in tool auth.

## Businesses

Every business is one row in the `businesses` table (`src/db/businesses.ts` — `id`, `name`, `created_at`; see [sqlite-storage.md](sqlite-storage.md)). `id` is the value used everywhere in URLs (`/b/:businessId/...`, `/app/:businessId/...`) — there's no separate slug, so renaming a business (`renameBusiness()`) never breaks a URL or a link already pasted into ServiceTitan. The business's `name` is shown publicly on its call-detail dashboard (see [call-dashboard.md](call-dashboard.md)) and in the SPA's sidebar business switcher, so a typo made when adding one is worth fixing rather than living with — **renaming is now possible directly through the UI**: the "Business name" field on the Business Info settings page (`/app/:businessId/settings/business-info`) saves via `PUT /api/businesses/:businessId/settings/business-info`, calling `renameBusiness()` under the hood. (No `docker compose exec` needed for this anymore — that direct-DB pattern is still the way to fix anything not exposed in either settings page.)

**Deleting a business is not built** — it would cascade across that business's `business_settings`, `call_log`, `elevenlabs_calls` rows, and its on-disk call recordings, and a half-finished cascade is a worse failure mode than just not offering the button yet. If one ever needs decommissioning, do it by hand via the same direct-DB pattern, deleting from each table in turn.
