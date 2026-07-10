# The `/settings` app

This doc covers the web app at `/settings` — routes, auth flow, and how form saves work. For how the data underneath it is actually stored/encrypted, see [sqlite-storage.md](sqlite-storage.md); this doc is about the app layer built on top of that storage.

## Why this exists

The platform needs credentials for ElevenLabs and ServiceTitan, plus a couple of operational values (an emergency transfer number, a shared secret for tool auth). Rather than a `.env` file, these are entered through a small password-protected web UI and stored encrypted in the local database. This was a deliberate project requirement: no credential should live in code or in an env file on disk, since the server is routinely exposed to the public internet (via ngrok in dev, or a real domain in production), and a login-gated UI backed by encrypted storage was judged a better fit than a plaintext `.env` file sitting in the deployed code.

## Routes

All defined in [`src/settings/routes.ts`](../src/settings/routes.ts), mounted at `/settings` in `index.ts`:

| Route | Method | Auth required | Purpose |
|---|---|---|---|
| `/settings/setup` | GET, POST | none (only reachable if no admin password exists yet) | First-run: create the admin password |
| `/settings/login` | GET, POST | none | Log in with the admin password |
| `/settings/logout` | POST | admin session | Destroy the session |
| `/settings` | GET | admin session | Render the credentials form |
| `/settings` | POST | admin session | Save submitted credential fields |
| `/settings/generate-secret` | POST | admin session | Generate + save a new random tool webhook secret |

### First-run vs. normal flow

```
GET /settings
  → is there an admin.passwordHash setting yet?
      no  → redirect to /settings/setup  (create-password form)
      yes → is req.session.isAdmin true?
              no  → requireAdminSession middleware redirects to /settings/login
              yes → render the full settings form
```

This means `/settings/setup` is effectively a one-time route — once a password exists, hitting `/settings/setup` again just redirects to `/settings/login` instead of letting someone create a second password.

## Admin auth

Two small pieces work together, both in [`src/settings/auth.ts`](../src/settings/auth.ts) and [`src/middleware/requireAdminSession.ts`](../src/middleware/requireAdminSession.ts):

- **Password check**: `setAdminPassword()` / `verifyAdminPassword()` hash with Node's built-in `scrypt` (random salt, timing-safe comparison on verify). See [sqlite-storage.md](sqlite-storage.md#admin-password-hashed-not-encrypted) for the exact hashing steps.
- **Session check**: `requireAdminSession` middleware just checks `req.session.isAdmin === true`, redirecting to `/settings/login` if not. The session itself is backed by SQLite (not the default in-memory store) — see [sqlite-storage.md](sqlite-storage.md#sessions-why-they-needed-their-own-table) for why that mattered.

Note that `/tools/*` (the ElevenLabs webhook endpoints) are a **completely separate auth mechanism** — a shared secret header, not a login session, since ElevenLabs' servers obviously can't fill out a login form. See [elevenlabs-tools.md](elevenlabs-tools.md).

## How saving the form works

The form (rendered by [`src/settings/views.ts`](../src/settings/views.ts)) posts every field to `POST /settings` in one request. The handler in `routes.ts` uses one small helper:

```ts
function maybeSet(key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    setSetting(key, trimmed);
  }
}
```

Every field goes through this: **if you left it blank, it's left alone in the database — not cleared.** This is why secret fields (API keys, client secret, tool webhook secret) can be shown as empty password inputs with a placeholder like "•••••••• (unchanged)" rather than ever re-displaying the actual secret — you only need to type a new value when you actually want to change it.

The one exception is `servicetitan.environment` (the Integration/Sandbox vs. Production dropdown), which is always written on every save, since a `<select>` always submits *some* value — there's no "blank" state to distinguish from "user didn't touch this."

### The bug this design fixes

Earlier, the settings page read fields in groups through combined getters (e.g. one function that returned all ElevenLabs settings, or `null` if *any* of them was missing). That caused two real problems:
1. If you'd saved just one field in a group, the page would render the *whole group* as blank, because the combined getter refused to return anything unless every field in the group was present.
2. Saving a different field in the same group — with the actually-saved field's input left blank as "unchanged" — would go through the old combined *setter*, which used the (now-`null`) combined getter as its fallback for "keep the current value," silently writing an empty string over a real, already-saved secret.

The fix was moving to **per-field reads and writes** everywhere in the settings app (`getRawElevenLabsSettings()`, `getRawServiceTitanSettings()`, `getRawOperationalSettings()` in `store.ts`), so no field's fate depends on any other field's presence. The one place a strict "all-or-nothing" check still exists is `getServiceTitanConfig()` — but that's used only by the actual ServiceTitan API client, which genuinely can't function without every required credential, so gating there is correct rather than accidental. Full detail in [sqlite-storage.md](sqlite-storage.md#why-key-value-instead-of-typed-columns).

## Flash messages

`req.session.flash` carries a one-time success/error message across the redirect after a POST (e.g. "Settings saved.", or the newly-generated secret after clicking "Generate a new random tool webhook secret"). `takeFlash()` in `routes.ts` reads it and immediately clears it, so it only ever displays once, right after the action that set it.

## The rendered page itself

`views.ts` has no client-side JavaScript and no templating engine — it's plain template-literal functions returning full HTML strings (`renderSetupPage`, `renderLoginPage`, `renderSettingsPage`). This was a deliberate "keep it simple" choice for a form with a couple dozen fields; if the settings UI grows meaningfully more complex, revisit that decision, but there was no need for a frontend framework at this size.

## Fields in the form, grouped

| Group | Fields |
|---|---|
| ElevenLabs | API key, Agent ID |
| ServiceTitan | Environment (Integration/Production), Client ID, Client secret, App key, Tenant ID, default Business Unit ID / Campaign ID / Call Reason ID / Job Type ID |
| Operational | Emergency transfer number, tool webhook shared secret |

See [servicetitan-integration.md](servicetitan-integration.md) for what the ServiceTitan fields are actually used for, and [elevenlabs-tools.md](elevenlabs-tools.md) for the operational fields' role in tool auth.
