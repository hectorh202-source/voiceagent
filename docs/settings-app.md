# The `/settings` app

This doc covers the web app at `/settings` — routes, auth flow, and how form saves work. For how the data underneath it is actually stored/encrypted, see [sqlite-storage.md](sqlite-storage.md); this doc is about the app layer built on top of that storage.

## Why this exists

The platform needs credentials for ElevenLabs and ServiceTitan, plus a couple of operational values (an emergency transfer number, a shared secret for tool auth). Rather than a `.env` file, these are entered through a small password-protected web UI and stored encrypted in the local database. This was a deliberate project requirement: no credential should live in code or in an env file on disk, since the server is routinely exposed to the public internet (via ngrok in dev, or a real domain in production), and a login-gated UI backed by encrypted storage was judged a better fit than a plaintext `.env` file sitting in the deployed code.

## Routes

Split across two routers — a global one and a per-business one, reflecting the platform's multi-business model (see [architecture-overview.md](architecture-overview.md)).

**Global**, defined in [`src/settings/routes.ts`](../src/settings/routes.ts), mounted at `/settings` in `index.ts`:

| Route | Method | Auth required | Purpose |
|---|---|---|---|
| `/settings/setup` | GET, POST | none (only reachable if zero users exist yet) | First-run: create the first platform account (email + password) |
| `/settings/migrate` | GET, POST | none (only reachable for an upgraded install with a legacy password and zero users) | One-time: convert the old single admin password into the first real account |
| `/settings/login` | GET, POST | none | Log in with email + password |
| `/settings/logout` | POST | admin session | Destroy the session |
| `/settings` | GET | admin session | Render the business list + "Add business" form + Users section |
| `/settings/businesses` | POST | admin session | Create a business, redirect to its own `/b/:id/settings` |
| `/settings/users` | POST | admin session | Add a new platform user (email + password) |
| `/settings/users/:id/delete` | POST | admin session | Remove a platform user (not yourself) |

**Per-business**, defined in [`src/settings/businessRoutes.ts`](../src/settings/businessRoutes.ts), mounted at `/b/:businessId/settings` under the shared `/b/:businessId` prefix in `index.ts` (see below):

| Route | Method | Auth required | Purpose |
|---|---|---|---|
| `/b/:businessId/settings` | GET | admin session + valid business | Render that business's ElevenLabs/ServiceTitan/Operational credentials form |
| `/b/:businessId/settings` | POST | admin session + valid business | Save that business's credential fields |
| `/b/:businessId/settings/generate-secret` | POST | admin session + valid business | Generate + save a new random tool webhook secret for that business |

Every `/b/:businessId/*` route (this settings form, the ElevenLabs tool webhooks, the post-call webhook, and the public call-detail dashboard) sits behind [`src/middleware/resolveBusiness.ts`](../src/middleware/resolveBusiness.ts), mounted once in `index.ts` ahead of all four sub-routers. It parses `:businessId`, looks up the business, and 404s immediately if it's not a valid positive integer or doesn't match a real business — before any auth/secret check downstream even runs, so an invalid business ID never leaks a confusing 401/503 for something that doesn't exist. One easy-to-miss Express detail that bit this during development: the child `Router()` mounted at `/b/:businessId` **must** be created with `Router({ mergeParams: true })`, or it gets its own empty `req.params` scope and `resolveBusiness` never sees `:businessId` at all.

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

### No admin role — every user is equally privileged, across every business

There's no permission tier: any row in `users` can do everything the platform allows — edit any business's credentials, add/remove other platform users, view any business's call dashboard. This was already true in the single-business days and remains the deliberate scope decision now that there can be many businesses: there's no per-business user or role, just one shared login pool with full access to everything. Worth a caveat if this platform's login pool ever includes anyone outside your own team (e.g. a client's own staff) — at that point "every user can edit every other business's live ServiceTitan credentials" becomes a real operational risk worth revisiting, though it isn't one today.

### Removing a user

**Normal path**: log into `/settings`, find the user in the **Users** section, click **Remove**. You can't remove your own currently-logged-in account this way (`POST /settings/users/:id/delete` rejects it) — log in as a different user to remove one.

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

The per-business credentials form (rendered by [`src/settings/views.ts`](../src/settings/views.ts)'s `renderSettingsPage()`) posts every field to `POST /b/:businessId/settings` in one request. The handler in `businessRoutes.ts` uses one small helper:

```ts
function maybeSet(businessId: number, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setBusinessSetting(businessId, key, trimmed);
  }
}
```

Every field goes through this: **if you left it blank, it's left alone in the database — not cleared.** This is why secret fields (API keys, client secret, tool webhook secret) can be shown as empty password inputs with a placeholder like "•••••••• (unchanged)" rather than ever re-displaying the actual secret — you only need to type a new value when you actually want to change it.

The one exception is `servicetitan.environment` (the Integration/Sandbox vs. Production dropdown), which is always written on every save, since a `<select>` always submits *some* value — there's no "blank" state to distinguish from "user didn't touch this."

### The bug this design fixes

Earlier, the settings page read fields in groups through combined getters (e.g. one function that returned all ElevenLabs settings, or `null` if *any* of them was missing). That caused two real problems:
1. If you'd saved just one field in a group, the page would render the *whole group* as blank, because the combined getter refused to return anything unless every field in the group was present.
2. Saving a different field in the same group — with the actually-saved field's input left blank as "unchanged" — would go through the old combined *setter*, which used the (now-`null`) combined getter as its fallback for "keep the current value," silently writing an empty string over a real, already-saved secret.

The fix was moving to **per-field reads and writes** everywhere in the settings app (`getRawElevenLabsSettings(businessId)`, `getRawServiceTitanSettings(businessId)`, `getRawOperationalSettings(businessId)` in `store.ts`), so no field's fate depends on any other field's presence. The one place a strict "all-or-nothing" check still exists is `getServiceTitanConfig(businessId)` — but that's used only by the actual ServiceTitan API client, which genuinely can't function without every required credential, so gating there is correct rather than accidental. Full detail in [sqlite-storage.md](sqlite-storage.md#why-key-value-instead-of-typed-columns).

### Global settings vs. business settings

`src/settings/store.ts` has two parallel families of functions: `getSetting`/`setSetting`/`hasSetting`/`deleteSetting` operate on the `settings` table (only three keys ever live here: the session secret and the dormant legacy admin password), while `getBusinessSetting`/`setBusinessSetting`/`hasBusinessSetting`/`deleteBusinessSetting` operate on `business_settings`, keyed by `(business_id, key)`. Every ElevenLabs/ServiceTitan/Operational credential goes through the business-scoped versions — see [sqlite-storage.md](sqlite-storage.md) for the table shapes and why the split exists rather than one table with a sentinel "global" business ID.

## Flash messages

`req.session.flash` carries a one-time success/error message across the redirect after a POST (e.g. "Settings saved.", or the newly-generated secret after clicking "Generate a new random tool webhook secret"). `takeFlash()` in `routes.ts` reads it and immediately clears it, so it only ever displays once, right after the action that set it.

## The rendered page itself

`views.ts` has no templating engine — it's plain template-literal functions returning full HTML strings (`renderSetupPage`, `renderLoginPage`, `renderSettingsPage`). This was a deliberate "keep it simple" choice for a form with a couple dozen fields; if the settings UI grows meaningfully more complex, revisit that decision, but there was no need for a frontend framework at this size. It does now carry a small amount of inline vanilla JS (`onclick`/`onsubmit` attributes, no separate script file) — see below.

## Guardrails against accidental edits

A few fields break things silently if changed by mistake (a stray click, a misplaced keystroke), with no server-side error to catch it — so the UI adds friction before it happens rather than relying on being careful:

- **Agent ID**, **Tenant ID**, and **Lead tag name** are rendered `readonly` and grayed out, each with its own **Change** button that unlocks that one field via a tiny inline `onclick` (removes `readonly`, refocuses, disables the button so it can't be "un-locked" twice). Saving the form runs a combined `onsubmit` on the outer `<form>` that only prompts a `confirm()` for the field(s) actually unlocked (tracked via `window.agentIdChanged` / `window.tenantIdChanged` / `window.tagNameChanged`) — editing other fields and saving is unaffected. Reasoning: pointing the app at the wrong ElevenLabs agent, the wrong ServiceTitan tenant, or a tag name that doesn't exist, doesn't error anywhere — it just quietly breaks calls, hits the wrong account, or leaves leads untagged, so each gets a deliberate "are you sure" step before submit.
- **Lead tag name** additionally shows a warning box (`#tagNameWarning`) on focus, explaining that the name must exactly match an existing ServiceTitan tag (Settings → Tags) — ServiceTitan doesn't create the tag for you, and a mismatch fails silently (lead created, just untagged).
- **"Generate a new random tool webhook secret"** (its own separate form, `POST /b/:businessId/settings/generate-secret`) has a `confirm()` on submit, since clicking it immediately invalidates that business's current secret — every tool call for that business fails until the new one is copied into its ElevenLabs agent. Regenerating one business's secret has no effect on any other business's.

None of this is server-enforced; it's UI-only friction on top of the same `POST /b/:businessId/settings` handler described above.

## Fields in the form, grouped

All scoped to one business — every business configures these independently, with zero shared state between businesses:

| Group | Fields |
|---|---|
| ElevenLabs | API key, Agent ID (locked behind Change) |
| ServiceTitan | Environment (Integration/Production), Client ID, Client secret, App key, Tenant ID (locked behind Change), default Business Unit ID / Campaign ID / Call Reason ID / Job Type ID, Lead tag name (locked behind Change) |
| Operational | Emergency transfer number, Dashboard display time zone, tool webhook shared secret, post-call webhook secret |

`operational.timezone` only affects how call times are formatted on that business's call-detail dashboard (`dashboard/views.ts`'s `formatCallTime()`) — it's deliberately unrelated to ElevenLabs' own per-agent time zone setting, which governs the agent's time-awareness *during* a call (greetings, business hours, relative dates). Changing one has no effect on the other; see [call-dashboard.md](call-dashboard.md) for detail.

See [servicetitan-integration.md](servicetitan-integration.md) for what the ServiceTitan fields are actually used for, and [elevenlabs-tools.md](elevenlabs-tools.md) for the operational fields' role in tool auth.

## Businesses

Every business is one row in the `businesses` table (`src/db/businesses.ts` — `id`, `name`, `created_at`; see [sqlite-storage.md](sqlite-storage.md)). `id` is the value used everywhere in URLs (`/b/:businessId/...`) — there's no separate slug, so renaming a business (`renameBusiness()`) never breaks a URL or a link already pasted into ServiceTitan. The business's `name` is shown publicly on its call-detail dashboard (see [call-dashboard.md](call-dashboard.md)), so a typo made when adding one is worth fixing rather than living with — there's no "rename" button in the UI yet, so do it directly: `docker compose exec app node -e "..."` calling `renameBusiness(id, 'Corrected Name')`, same pattern as the [Removing a user](#removing-a-user) escape hatch above.

**Deleting a business is not built** — it would cascade across that business's `business_settings`, `call_log`, `elevenlabs_calls` rows, and its on-disk call recordings, and a half-finished cascade is a worse failure mode than just not offering the button yet. If one ever needs decommissioning, do it by hand via the same direct-DB pattern, deleting from each table in turn.
