# The `/settings` app

This doc covers the web app at `/settings` — routes, auth flow, and how form saves work. For how the data underneath it is actually stored/encrypted, see [sqlite-storage.md](sqlite-storage.md); this doc is about the app layer built on top of that storage.

## Why this exists

The platform needs credentials for ElevenLabs and ServiceTitan, plus a couple of operational values (an emergency transfer number, a shared secret for tool auth). Rather than a `.env` file, these are entered through a small password-protected web UI and stored encrypted in the local database. This was a deliberate project requirement: no credential should live in code or in an env file on disk, since the server is routinely exposed to the public internet (via ngrok in dev, or a real domain in production), and a login-gated UI backed by encrypted storage was judged a better fit than a plaintext `.env` file sitting in the deployed code.

## Routes

Split across two routers — a global one and a per-business one, reflecting the platform's multi-business model (see [architecture-overview.md](architecture-overview.md)).

**Global**, defined in [`src/settings/routes.ts`](../src/settings/routes.ts), mounted at `/settings` in `index.ts`:

| Route | Method | Auth required | Purpose |
|---|---|---|---|
| `/settings/setup` | GET, POST | none (only reachable if zero users exist yet) | First-run: create the first platform account (email + password) — always created as a platform admin |
| `/settings/migrate` | GET, POST | none (only reachable for an upgraded install with a legacy password and zero users) | One-time: convert the old single admin password into the first real account — always created as a platform admin |
| `/settings/login` | GET, POST | none | Log in with email + password |
| `/settings/logout` | POST | admin session | Destroy the session |
| `/settings` | GET | admin session + **platform admin** | Redirects straight into the SPA's admin console at `/app/admin` (a non-admin is redirected to `/app` instead) |

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

`src/api/businessRouter.ts` is gated by `requireApiSession` (`src/api/requireApiSession.ts`) — the same session check as `requireAdminSession` below, just responding `401` JSON instead of redirecting, since the caller is the SPA's `fetch()`, not a browser navigation. `src/api/adminRouter.ts` is additionally gated by `requireApiPlatformAdmin` (`src/api/requireApiPlatformAdmin.ts`), the JSON equivalent of `requirePlatformAdmin` — as are the two `GET`/`PUT`/`POST` `/settings/general*` routes on `businessRouter.ts` specifically (unlike `business-info`, which stays open to any business-access user).

Every `/b/:businessId/*` route (the ElevenLabs tool webhooks, the post-call webhook, and the public call-detail dashboard) and every `/api/businesses/:businessId/*` route sits behind [`src/middleware/resolveBusiness.ts`](../src/middleware/resolveBusiness.ts). It parses `:businessId`, looks up the business, and 404s immediately if it's not a valid positive integer or doesn't match a real business — before any auth/secret check downstream even runs, so an invalid business ID never leaks a confusing 401/503 for something that doesn't exist. One easy-to-miss Express detail that bit this during development: a child `Router()` mounted at a path containing `:businessId` **must** be created with `Router({ mergeParams: true })`, or it gets its own empty `req.params` scope and `resolveBusiness` never sees `:businessId` at all.

### First-run vs. migration vs. normal flow

`getAuthState()` in `auth.ts` is the single source of truth every entry point branches on:

```
getAuthState():
  users table has any rows?      → "ready"
  else: legacy admin.passwordHash setting exists?  → "needs_migration"
  else                                              → "fresh"

GET /settings (and every other gated route)
  → "fresh"           → redirect to /settings/setup     (create first account)
  → "needs_migration" → redirect to /settings/migrate    (upgrade old password into an account)
  → "ready"           → requireAdminSession → render the settings form
```

`/settings/setup` and `/settings/migrate` are both effectively one-time routes — once `getAuthState()` returns `"ready"`, hitting either one just redirects to `/settings/login` instead of re-running first-run setup.

## Multi-user auth

The app moved from a single shared admin password to real per-user accounts (`src/db/users.ts`, table `users` — email, scrypt password hash/salt, failed-attempt/lockout counters), orchestrated by a thin [`src/settings/auth.ts`](../src/settings/auth.ts) and enforced by [`src/middleware/requireAdminSession.ts`](../src/middleware/requireAdminSession.ts).

- **Password check**: same primitive as before — Node's built-in `scrypt` (random salt, `timingSafeEqual` comparison) — now scoped per user row instead of one global setting. See [sqlite-storage.md](sqlite-storage.md#admin-password-hashed-not-encrypted) for the hashing detail (still accurate, just applied per-user now).
- **Session check**: `requireAdminSession` stores `req.session.userId` (not a boolean) and re-validates it against the `users` table on *every* request — so deleting a user immediately kills their live session rather than waiting for their next login attempt.
- **Brute-force protection**, entirely in `db/users.ts`'s `attemptLogin()`:
  - Per-account lockout: 5 wrong passwords locks that account for 15 minutes (`locked_until`, persisted in SQLite — survives a restart, same as sessions).
  - A dummy `scrypt` hash is computed even when the submitted email doesn't match any user, so a nonexistent-email attempt costs the same time as a real one — avoids leaking account existence via response timing.
  - Login failures always render the identical message, `"Invalid email or password."`, whether the email doesn't exist, the password is wrong, or the account is currently locked — a locked-out admin isn't told why (see [Removing a user](#removing-a-user) below for how to clear a lockout directly).
  - Separately, [`src/middleware/loginRateLimiter.ts`](../src/middleware/loginRateLimiter.ts) throttles by IP (20 failed attempts / 15 min, in-memory — intentionally not persisted, since only the per-account lockout needs to survive a restart). Requires `app.set("trust proxy", 1)` in `index.ts` so `req.ip` reflects the real client through Caddy rather than its internal address.

### Upgrading an existing deployment

An already-running instance has a legacy `admin.passwordHash`/`admin.passwordSalt` in the `settings` table and no `users` rows yet. After deploying this change, the admin is redirected to `/settings/migrate`: entering the *current* password plus an email creates the first real user account (re-hashed fresh, not copying the old hash bytes) and deletes the legacy settings keys. The old password keeps working right up through that one migration step — there's no lockout risk during the upgrade.

Note that `/tools/*` (the ElevenLabs webhook endpoints) are a **completely separate auth mechanism** — a shared secret header, not a login session, since ElevenLabs' servers obviously can't fill out a login form. See [elevenlabs-tools.md](elevenlabs-tools.md).

### Server-side auth checks aren't enough on their own — the browser's back/forward cache

Found via real testing: logging out and back in as a different user in the *same browser tab*, then pressing the browser's **back** button, could show a previously-rendered authenticated page (e.g. the platform-admin `/settings` console) even though the current session belongs to a different, non-admin user. The cause isn't a bug in `requireAdminSession`/`requirePlatformAdmin` — those still run correctly on every real request. It's the browser's **back/forward cache (bfcache)**: modern browsers can restore a previously-rendered page (the full DOM, sometimes the whole JS heap) straight from memory when you navigate back, without ever asking the server again — so a per-request auth check simply never gets the chance to run.

Fixed in two layers:
1. **`src/middleware/noStore.ts`** — sets `Cache-Control: no-store, no-cache, must-revalidate, private` + `Pragma: no-cache` on every authenticated response: all of `/settings/*`, `/api/*`, and the React SPA's HTML shell under `/app/*`. `no-store` is the one directive that reliably disqualifies a response from both the regular HTTP cache and bfcache in current browsers, forcing a real round-trip to the server (and therefore a fresh auth check) on every back/forward navigation. **A real gotcha hit while wiring this up**: `express.static(clientDistPath)` was serving `index.html` directly for a bare `GET /app` (its default directory-index behavior) — bypassing the `noStore`-guarded catch-all entirely, confirmed via a real request coming back `Cache-Control: public, max-age=0` instead of `no-store`. Fixed by mounting the static middleware with `{ index: false }`, forcing every request for the HTML shell through the catch-all that actually sets the header.
2. **A `pageshow` listener** (in `client/src/main.tsx` for the SPA, and inline in `settings/views.ts`'s shared `page()` wrapper for the server-rendered auth pages) that calls `window.location.reload()` whenever `event.persisted` is true. This is the belt-and-suspenders layer for browsers that might still bfcache a page despite `no-store` (Safari has historically been more permissive here than Chrome/Firefox) — a persisted-page restore forces an immediate real reload instead of silently continuing to show frozen, possibly stale-user state.

**What this doesn't fix, because it isn't a caching bug**: a browser's own saved-password autofill can still offer to fill a previously-used email/password into the login form — that's the browser's password manager working as designed (and deliberately hard for a site to suppress; `autocomplete="off"` is widely ignored by browsers on login forms for exactly this reason). Verified via a real repro of the reported scenario that the *page content itself* (the actual security concern — a stale authenticated console rendering for the wrong user) is fixed: after this change, repeatedly pressing back as a freshly-logged-in non-admin user always re-renders fresh from the server and correctly redirects away from `/settings`, rather than showing the previous session's cached page.

### A currently-logged-in user landing on the login page

A related but separate gap, also found via real back-button testing: `noStore` + the `pageshow` reload guarantee that pressing back always gets a **fresh** server response rather than a bfcache-frozen one — but a fresh response isn't automatically the *right* one. `GET /settings/login`'s only gate was `getAuthState()`, which answers "does any account exist anywhere in this system?", not "is the browser making this particular request already holding a valid session?" So enough back-presses could land a real, live-session user on a genuine, freshly-rendered login form — not stale/cached content, just the wrong page for someone who's already authenticated. Real enterprise apps don't let an authenticated user see a login screen at all.

Fixed by adding a session check to the front of the `GET /settings/login` handler in `src/settings/routes.ts`: if `req.session.userId` resolves to a real user via `getUserById()`, redirect straight to `/app` instead of rendering the form — mirroring how `requirePlatformAdmin` already redirects a non-admin away from `/settings` rather than rendering something that doesn't apply to them. A logged-out visitor (no session, or a stale session for a deleted user) still sees the real login form exactly as before.

### Per-business access control — platform admins vs. scoped users

Every user is either a **platform admin** (`users.is_platform_admin`) or scoped to specific businesses via a `user_businesses` join table (`user_id, business_id`, simple membership — no per-business role tiers, just "has access" or doesn't). Platform admins bypass the membership table entirely and see/edit every business, exactly like every user did before this existed; a scoped (non-admin) user can only see and act on the businesses they're explicitly assigned to.

**Enforcement is deliberately narrow** — added in exactly two places, since most of this app's surfaces have their own unrelated auth already:
- **`src/middleware/requireBusinessAccess.ts`**, mounted on `src/api/businessRouter.ts` right after `resolveBusiness`/`requireApiSession` — every `/api/businesses/:businessId/*` call (calls, metrics, settings) 403s for a business the current user isn't assigned to. `GET /api/businesses` (the SPA's business switcher and `FirstBusinessRedirect`) is scoped the same way via `listBusinessesForUser()` — a scoped user simply never sees a business they don't have access to, no client-side filtering needed.
- **`src/middleware/requirePlatformAdmin.ts`**, on the global `/settings` console (business list, add/remove users, business/admin assignment) — a scoped user has no reason to see every business/user in the system, so hitting `/settings` redirects them straight to `/app` (which resolves to their own first assigned business).

`/b/:businessId/tools/*` and `/webhooks/*` (shared-secret auth, unrelated to user sessions) and the public `/b/:businessId/calls/:conversationId` page (deliberately unauthenticated) are untouched by any of this.

**Migration**: `src/db/migrateUserBusinessAccess.ts` marks every *existing* user a platform admin on deploy — zero surprise/lockout, matching the full access they already had. Only users created *after* this shipped default to scoped/non-admin. The very first account (via `/settings/setup` or `/settings/migrate`) is always created as a platform admin, since there's no one else yet to grant them access.

**Admin Settings is split into a global page and a per-business page, both `client/src/pages/AdminSettingsPage.tsx`** (one component, branching on whether `useParams().businessId` is present):

- **`/app/admin`** (business-agnostic, no `:businessId`) — Businesses list + "Add a business" form, and a **Platform Admins** list (every user with `isPlatformAdmin: true`): each row can flip that flag off (`POST /api/admin/users/:id/access`, always sending `businessIds: []` from this page — business assignment doesn't happen here anymore) or delete the account entirely (`DELETE /api/admin/users/:id`). "Add a platform admin" only takes an email + password — there's no business-checkbox grid on this page at all; the form always creates the user with `isPlatformAdmin: true`.
- **`/app/:businessId/admin`** (nested, reached by picking a business from the switcher while anywhere in the Admin section) — that one business's **Users**: every non-admin user currently assigned to it, each with a **Remove** button that unassigns *only this business* (`DELETE /api/admin/businesses/:businessId/users/:userId` — the account and any other business's access stays untouched, confirmed via a real test: removing a user this way left their row intact with `businessIds: []`, not deleted). Below that, an "Add a user" form creates a **brand-new** account scoped only to this business (`POST /api/admin/businesses/:businessId/users`) — there's no way to grant an *existing* user (one already working at a different business) access to a second business from this UI; that's a deliberate scope cut, not an oversight. Below the Users section, the page embeds `GeneralSettingsPage` directly (the same component previously reached via its own nav link — see below) — this business's ElevenLabs/ServiceTitan credentials and operational settings, now only reachable from here.

The **motivation** for this split (moved from the earlier all-in-one design, where a global checkbox-grid assigned any user to any set of businesses): user management now happens where it's actually relevant — go to the business, manage its users there — rather than scrolling a global roster checking boxes across every business at once. The only thing that stays global is *who's a platform admin*, since that's inherently a system-wide concern, not a per-business one.

A user can't revoke their own platform-admin flag from the global page (mirrors the existing "can't delete your own account" guard) — the checkbox renders disabled for your own row, and the server rejects it too, to avoid a self-lockout with no one else able to restore access.

**Routing**: `/app/admin` and `/app/:businessId/admin` are two separate `<Route>`s in `client/src/App.tsx` (one top-level, one nested under `/:businessId` alongside `calls`/`metrics`/`settings/business-info`), both rendering the same `AdminSettingsPage`. `AppShell`'s sidebar "Admin Settings" link always points at the global `/app/admin` (shown only when `currentUser.isPlatformAdmin`, so a scoped user never sees it); `BusinessSwitcher.tsx` has one special case for navigating *out* of the business-agnostic `/admin` page — picking a business there navigates to `/app/:businessId/admin` (staying in the admin section) rather than the generic "swap the businessId segment" logic, which would otherwise send you to that business's Calls page. Switching businesses while already on `/app/:businessId/admin` uses the generic logic normally, landing on the new business's `/admin` page directly.

Two layers of enforcement, not one:
1. **Server-side, structural, in `src/index.ts`'s `requireAppAccess`** — a single gate ahead of the `GET /app/*` catch-all that every `/app/*` HTML request passes through before the shell is ever sent, so a page added later inherits the right check automatically just by living at `/app/admin`, `/app/:businessId/admin`, or `/app/:businessId/...`, with no per-route code to remember. It checks, in order: (1) is there a valid session at all (`req.session.userId` resolving via `getUserById()`) — if not, redirect to `/settings/login`, closing a gap where previously *any* `/app/*` URL, admin or not, returned a real `200` shell to a fully anonymous visitor and only bounced them after the SPA's JS loaded and `/api/session` came back `401`; (2) is the path exactly `/app/admin` — if so, require `isPlatformAdmin`; (3) does the path start with `/app/:businessId/...` — if so, require `userHasBusinessAccess()` for that specific business (the exact same check `requireBusinessAccess` already enforces on the JSON API, just applied to the shell too), **and**, if the segment right after the business ID is `admin`, *additionally* require `isPlatformAdmin` — business access alone isn't enough for a business's own admin console, a scoped user with legitimate access to that business still can't reach `/app/:businessId/admin`. Any of these failing redirects to `/app` (or `/settings/login` for no session) before any HTML is sent.
2. **Client-side, in `AdminSettingsPage.tsx`** — a defense-in-depth check that redirects to `/` (via `<Navigate to="/" replace />`) if `currentUser.isPlatformAdmin` is somehow false anyway, for both the global and per-business modes. This is what actually fires for the one case the server-side gate can't see: a bfcache-restored admin document (e.g. right after logging out and back in as a different, non-admin user and hitting the browser's back button) reloading fresh and re-fetching the session client-side, without a fresh server request for the server-side gate to intercept.

Before `requireAppAccess` existed, every business-scoped page (`/app/:businessId/calls`, `/metrics`, `/settings/business-info`) had the same shape of gap as `/app/admin` did: the shell was served for *any* `businessId`, and only the underlying `/api/businesses/:businessId/*` data calls were actually protected (by `requireBusinessAccess`). Each page degrades gracefully on a `403` (empty list, blank form) rather than leaking another business's data, so this was never a data leak — but the URL itself resolved to real (if empty) content instead of never loading, for a business a user didn't own. `requireAppAccess` closes that the same way it closes the admin case, for every `:businessId` route at once, not just the ones that exist today.

`src/settings/routes.ts`'s `GET /settings` handler is now nothing more than an auth-gated redirect to `/app/admin` — the old server-rendered business/user console (`renderBusinessListPage` and its four POST handlers) was deleted once this became the SPA's job, matching the same "delete fully-superseded code" pattern used earlier when `renderCallListPage`/`businessRoutes.ts` were deleted during the original React dashboard rebuild.

**A real bug caught during live testing**: `node:sqlite` enforces foreign keys by default, so `deleteUser()` on a scoped user with rows in `user_businesses` used to throw an unhandled `FOREIGN KEY constraint failed` instead of removing them (the existing "Remove" button would have 500'd for any non-admin user). Fixed by having `deleteUser()` delete that user's `user_businesses` rows in the same transaction before deleting the user row itself.

### Removing a user

**Normal path**: log in as a platform admin, visit `/app/admin` (or `/settings`, which redirects there), find the user in the **Users** section, click **Remove**. You can't remove your own currently-logged-in account this way (`DELETE /api/admin/users/:id` rejects it) — log in as a different user to remove one.

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

`src/settings/store.ts` has two parallel families of functions: `getSetting`/`setSetting`/`hasSetting`/`deleteSetting` operate on the `settings` table (only three keys ever live here: the session secret and the dormant legacy admin password), while `getBusinessSetting`/`setBusinessSetting`/`hasBusinessSetting`/`deleteBusinessSetting` operate on `business_settings`, keyed by `(business_id, key)`. Every ElevenLabs/ServiceTitan/Operational credential goes through the business-scoped versions — see [sqlite-storage.md](sqlite-storage.md) for the table shapes and why the split exists rather than one table with a sentinel "global" business ID.

## The rendered page itself

`src/settings/views.ts` only covers the pre-session auth flow now — plain template-literal functions returning full HTML strings (`renderSetupPage`, `renderLoginPage`, `renderMigratePage`). Both the business/user console (previously `renderBusinessListPage`) and the per-business credentials form (previously `renderSettingsPage()`) were deleted from this file — they're `client/src/pages/AdminSettingsPage.tsx` and `BusinessInfoSettingsPage.tsx`/`GeneralSettingsPage.tsx` respectively, real React components, part of the SPA described in [call-dashboard.md](call-dashboard.md#calls-section-react-spa) and [architecture-overview.md](architecture-overview.md). With no more forms left in `views.ts` that carry a one-time success/error message across a redirect, the `req.session.flash`/`takeFlash()` mechanism was deleted along with them — every remaining page in `views.ts` (setup/migrate/login) already renders its error inline on the same response, no redirect involved.

## Guardrails against accidental edits

A few fields break things silently if changed by mistake (a stray click, a misplaced keystroke), with no server-side error to catch it — so the UI adds friction before it happens rather than relying on being careful. The mechanism changed with the SPA rewrite, but the same fields are guarded and the same reasoning applies:

- **`GeneralSettingsPage.tsx`'s `confirmCriticalChanges()`** runs before every save, comparing the current form values against what was loaded from the API — if **Agent ID**, **Tenant ID**, **Lead tag name**, or **Booking Mode** differ from their loaded value, a `window.confirm()` fires with the same wording the old server-rendered form used, one prompt per changed field. Declining any one aborts the save entirely (the mutation never fires). Unlike the old form, there's no separate "unlock" step before editing — the field is always editable, and the confirmation only fires at save time based on what actually changed.
- **"Generate a new secret"** (a link-styled button next to the Tool webhook secret field) still has no separate confirm of its own — clicking it immediately invalidates that business's current secret via `POST /api/businesses/:businessId/settings/general/generate-secret`, and every tool call for that business fails until the new one is copied into its ElevenLabs agent. Regenerating one business's secret has no effect on any other business's.

None of this is server-enforced; it's UI-only friction on top of the same `PUT /api/businesses/:businessId/settings/general` endpoint described above (which does independently enforce `requireApiPlatformAdmin` server-side — that part isn't just UI friction).

## Fields in the form, grouped

Split across the SPA's two settings pages (was one combined form before the rebuild) — every business configures these independently, with zero shared state between businesses:

| Page | Fields |
|---|---|
| **Business Info** (`/app/:businessId/settings/business-info`, any business-access user) | Business name, default ServiceTitan Business Unit ID / Campaign ID / Job Type ID, the 10-row service categories grid |
| **General** (embedded in `/app/:businessId/admin`, **platform admins only**) | ElevenLabs API key + Agent ID; ServiceTitan Environment, Client ID, Client secret, App key, Tenant ID, Call reason ID, Lead tag name, Booking mode; Operational timezone, Dashboard base URL, tool webhook secret, post-call webhook secret |

The split follows what each field is *for*: Business Info holds the values that map a call to the right ServiceTitan business unit/job type (the things a client themselves might reasonably tweak), while General holds credentials and lower-level operational config — admin-only, and no longer a separate nav item under Settings; it moved into that business's own admin console (`GeneralSettingsPage.tsx` is unchanged internally, just rendered as a section of `AdminSettingsPage.tsx` instead of its own routed page).

`operational.timezone` only affects how call times are formatted on that business's call-detail dashboard — it's deliberately unrelated to ElevenLabs' own per-agent time zone setting, which governs the agent's time-awareness *during* a call (greetings, business hours, relative dates). Changing one has no effect on the other; see [call-dashboard.md](call-dashboard.md) for detail.

See [servicetitan-integration.md](servicetitan-integration.md) for what the ServiceTitan fields are actually used for, and [elevenlabs-tools.md](elevenlabs-tools.md) for the operational fields' role in tool auth.

## Businesses

Every business is one row in the `businesses` table (`src/db/businesses.ts` — `id`, `name`, `created_at`; see [sqlite-storage.md](sqlite-storage.md)). `id` is the value used everywhere in URLs (`/b/:businessId/...`, `/app/:businessId/...`) — there's no separate slug, so renaming a business (`renameBusiness()`) never breaks a URL or a link already pasted into ServiceTitan. The business's `name` is shown publicly on its call-detail dashboard (see [call-dashboard.md](call-dashboard.md)) and in the SPA's sidebar business switcher, so a typo made when adding one is worth fixing rather than living with — **renaming is now possible directly through the UI**: the "Business name" field on the Business Info settings page (`/app/:businessId/settings/business-info`) saves via `PUT /api/businesses/:businessId/settings/business-info`, calling `renameBusiness()` under the hood. (No `docker compose exec` needed for this anymore — that direct-DB pattern is still the way to fix anything not exposed in either settings page.)

**Deleting a business is not built** — it would cascade across that business's `business_settings`, `call_log`, `elevenlabs_calls` rows, and its on-disk call recordings, and a half-finished cascade is a worse failure mode than just not offering the button yet. If one ever needs decommissioning, do it by hand via the same direct-DB pattern, deleting from each table in turn.
