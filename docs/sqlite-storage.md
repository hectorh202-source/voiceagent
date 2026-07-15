# SQLite storage system

This document explains how this app stores data — credentials, admin login, call/tool history, and web sessions — all in one local SQLite file. No external database is used.

## Why SQLite, and why `node:sqlite`

The app needs a small amount of persistent state (settings, logs, sessions) and runs as a single process, so a full database server would be overkill. SQLite is a single file on disk that does the job with zero extra infrastructure.

Node.js ships a built-in SQLite driver as of Node 22.5+ (`node:sqlite`, the `DatabaseSync` class). This project uses that instead of the popular `better-sqlite3` package specifically because `better-sqlite3` is a native (C++) module — it has to be compiled for the exact OS/architecture it runs on, which requires a full C++ build toolchain (Visual Studio Build Tools on Windows, `build-essential` on Linux). `node:sqlite` ships inside Node itself, so `npm install` never needs to compile anything, on any machine or Docker image. This is why the [Dockerfile](../Dockerfile) can use a plain `node:24-slim` image with no extra build dependencies.

## Where the file lives

```
DATABASE_PATH env var (default: ./data/app.db locally, /data/app.db in Docker)
  → data/app.db              the SQLite database file
  → data/app.db-wal          write-ahead log (see "WAL mode" below)
  → data/app.db-shm          shared memory index for the WAL
  → data/.encryption.key     32-byte AES key, generated on first run (see below)
```

In Docker, all of `data/` lives inside the named volume `app-data` (see [docker-compose.yml](../docker-compose.yml)), so it survives container rebuilds — it's only lost if someone explicitly runs `docker compose down -v`.

**WAL mode**: [`db/index.ts`](../src/db/index.ts) turns on `PRAGMA journal_mode = WAL` on startup. In plain SQLite, every write locks the whole file; WAL mode instead appends writes to a separate `-wal` file and lets reads continue concurrently, which is friendlier for a web server handling multiple requests at once.

## The tables

Defined in [`db/schema.ts`](../src/db/schema.ts) and created automatically on first startup (`CREATE TABLE IF NOT EXISTS`, so it's a no-op on every restart after the first):

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,           -- always encrypted, see below
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE business_settings (
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,           -- always encrypted, same as settings
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (business_id, key)
);

CREATE TABLE call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tool_name TEXT NOT NULL,       -- e.g. "lookup_customer", "create_lead"
  phone TEXT,                    -- caller's number, when known
  request_json TEXT NOT NULL,    -- the tool call's input, as JSON
  response_json TEXT,            -- the tool call's output, as JSON
  success INTEGER NOT NULL,      -- 0 or 1
  error_message TEXT
);

CREATE TABLE elevenlabs_calls (
  conversation_id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL DEFAULT 1,
  agent_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  transcript_json TEXT,
  summary TEXT,
  termination_reason TEXT,
  raw_payload_json TEXT NOT NULL,
  audio_path TEXT
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,          -- session ID (from the cookie)
  session_json TEXT NOT NULL,    -- serialized express-session data
  expires_at INTEGER NOT NULL    -- unix ms timestamp
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
```

One file, one connection (`db/index.ts` exports a single shared `db` handle), each table owned by one module:

| Table | Owned by | Purpose |
|---|---|---|
| `settings` | [`settings/store.ts`](../src/settings/store.ts) | Only the handful of genuinely **global** keys: the session secret, and the dormant legacy admin password |
| `businesses` | [`db/businesses.ts`](../src/db/businesses.ts) | One row per business — `id` (used everywhere in URLs), `name` (shown publicly on that business's call-detail dashboard) |
| `business_settings` | [`settings/store.ts`](../src/settings/store.ts) | Every credential (ElevenLabs/ServiceTitan/Operational), scoped by `business_id` — encrypted at rest, same as `settings` |
| `users` | [`db/users.ts`](../src/db/users.ts) | Platform-wide login accounts — email, hashed password, brute-force lockout state. **Not** business-scoped: one shared login pool manages every business |
| `call_log` | [`db/callLog.ts`](../src/db/callLog.ts) | Audit trail of every ElevenLabs tool call, tagged by `business_id` |
| `elevenlabs_calls` | [`db/callRecords.ts`](../src/db/callRecords.ts) | Post-call webhook data (transcript/summary/recording path), tagged by `business_id` |
| `sessions` | [`settings/sessionStore.ts`](../src/settings/sessionStore.ts) | Logged-in sessions for the `/settings` login — global, same as `users` |

## Global settings vs. per-business settings — two parallel key-value tables

Rather than one column per credential, both `settings` and `business_settings` are generic key-value tables. Every credential is namespaced by dot-prefix, e.g.:

```
elevenlabs.apiKey
elevenlabs.agentId
servicetitan.environment
servicetitan.clientId
servicetitan.clientSecret
servicetitan.appKey
servicetitan.tenantId
servicetitan.businessUnitId
servicetitan.campaignId
servicetitan.callReasonId
servicetitan.jobTypeId
operational.toolWebhookSecret
operational.postCallWebhookSecret
operational.timezone
operational.dashboardBaseUrl
```

Every key above lives in `business_settings`, keyed by `(business_id, key)` — a business's credentials are only ever readable/writable by passing that business's ID. `settings` itself keeps only:

```
internal.sessionSecret
```

`admin.passwordHash`/`admin.passwordSalt` used to live in `settings` too, back when there was a single shared admin password. They only exist now on an install that hasn't yet gone through the one-time `/settings/migrate` upgrade to per-user accounts (see [settings-app.md](settings-app.md#upgrading-an-existing-deployment)) — migrating deletes both keys.

Why two tables instead of one with a sentinel "global" business ID: `internal.sessionSecret` and the legacy admin password genuinely aren't associated with any business — inventing a fake business ID (e.g. `0`) to hold them would mean every business-scoped function needs a special case for "unless it's the sentinel ID," exactly the kind of implicit special-casing this codebase has deliberately avoided elsewhere (see the combined-getter bug below). Two separate, narrowly-scoped tables is simpler than one table with an escape hatch.

Four primitives do all the work (`settings/store.ts`):

```ts
getSetting(key: string): string | null                              // the 3 global keys only
setSetting(key: string, value: string): void
getBusinessSetting(businessId: number, key: string): string | null   // everything else
setBusinessSetting(businessId: number, key: string, value: string): void
```

`setSetting`/`setBusinessSetting` always **encrypt** the value before the `INSERT ... ON CONFLICT DO UPDATE` write; the getters always **decrypt** on the way out. Callers never see ciphertext.

### Why key-value instead of typed columns

This keeps adding a new credential a one-line change (no migrations), and — more importantly — it's what let us fix a real bug: earlier, the settings page read groups of related fields through a single "give me all of these or nothing" getter (e.g. one function for all of ElevenLabs' fields). If you saved just one field in a group, the getter would return `null` for the *whole group*, which blanked already-saved fields on the page and could even overwrite a real secret with an empty string on the next save. The fix was to read/write **every field independently** — see `getRawElevenLabsSettings(businessId)` / `getRawServiceTitanSettings(businessId)` / `getRawOperationalSettings(businessId)` in `store.ts`, each of which calls `getBusinessSetting()` once per field rather than gating on all of them at once.

The one place a group *is* still gated is `getServiceTitanConfig(businessId)`, used only by the actual ServiceTitan API client (`servicetitan/httpClient.ts`). That's intentional: you genuinely cannot make a ServiceTitan API call with only half the credentials, so that function returns `null` unless client ID, secret, app key, *and* tenant ID are all present — but that strict check is now isolated to the one place that legitimately needs it, instead of leaking into how the settings page displays things.

## Encryption: how a value actually gets protected

`settings/store.ts` implements AES-256-GCM encryption around every value:

```
setSetting(key, plaintext):
  1. generate a random 12-byte IV (initialization vector)
  2. encrypt plaintext with AES-256-GCM using the app's encryption key + IV
  3. get the 16-byte GCM auth tag (detects tampering)
  4. store as base64( IV || authTag || ciphertext )   -- one string, three parts glued together

getSetting(key):
  1. base64-decode the stored string
  2. split it back into IV (first 12 bytes), authTag (next 16 bytes), ciphertext (rest)
  3. decrypt with AES-256-GCM using the app's encryption key + IV + authTag
  4. return the original plaintext string
```

A fresh random IV per value means encrypting the same string twice produces different ciphertext both times — this is standard practice and prevents an attacker from spotting repeated values just by comparing ciphertext.

### The encryption key itself

[`settings/encryptionKey.ts`](../src/settings/encryptionKey.ts) loads the key from one of two places:

```ts
if (env.ENCRYPTION_KEY) {
  // preferred: a 64-char hex string (32 bytes) injected as an environment
  // variable at deploy time — never written into the data/ volume that
  // gets backed up alongside app.db
  return Buffer.from(env.ENCRYPTION_KEY, "hex");
}
// fallback for an unmigrated deployment, with a loud console.warn():
const keyPath = "<same directory as the DB>/.encryption.key";
// on first run: generate 32 random bytes, write them to that file (mode 0600 = owner read/write only)
// on every run after: just read the existing file
```

The `ENCRYPTION_KEY` env var is a deliberate, documented exception to this project's usual "no credentials in env files" rule (see `.env.example`) — it's the deployment's own master key, not a business credential, and it structurally can't live inside the encrypted store it protects. Set via `docker-compose.yml`'s `- ENCRYPTION_KEY=${ENCRYPTION_KEY:-}`, sourced from a gitignored `.env` file next to `docker-compose.yml` on the VPS — never committed, never placed in the `data/` volume.

The old file-based key (`data/.encryption.key`, co-located with `app.db` in the same Docker volume) still works as a fallback for any deployment that hasn't migrated yet, but it's a real security gap: a backup or volume snapshot of `data/` hands over both the encrypted credentials *and* the key to decrypt them together. Migrating is a one-time, zero-data-loss move of the **existing** key value (never generate a new one — a new key can't decrypt anything already encrypted with the old one):

1. Print the existing key's hex value: `docker compose exec app node -e "console.log(require('fs').readFileSync('/data/.encryption.key').toString('hex'))"`
2. Add `ENCRYPTION_KEY=<that exact value>` to a `.env` file next to `docker-compose.yml` on the VPS (gitignored, VPS-only — never committed).
3. Redeploy: `git pull && docker compose up -d --build`.
4. Verify existing ServiceTitan/ElevenLabs/SMTP settings still display correctly in the app — this proves the same key is in use. If anything looks broken or throws decryption errors, do **not** delete the old key file — the app is still falling back to it, or something is misconfigured.
5. Once confirmed working, delete `data/.encryption.key` from the volume (`docker compose exec app rm /data/.encryption.key`) to complete the fix — from then on there's no key sitting in the backed-up volume at all.

Practically, this means:

- If you lose the key (whichever source it comes from) but keep `data/app.db`, every encrypted value becomes permanently unreadable garbage (the auth tag check will fail on decrypt) — there is no recovery without the original key.
- If you copy `app.db` to a different machine without also carrying over the same key (env var or file), same problem.
- Once migrated to `ENCRYPTION_KEY`, back up the `.env` file (or wherever the key is recorded) separately from `data/app.db` — that separation is the entire point of the migration.

## User passwords: hashed, not encrypted

Login passwords (used to log into `/settings`) are handled differently from credentials — they're **hashed**, not encrypted, because we only ever need to check "does this password match," never recover the original password. Each row in the `users` table ([`db/users.ts`](../src/db/users.ts)) carries its own salt and hash:

```
createUser(email, password):
  1. generate a random 16-byte salt
  2. hash = scrypt(password, salt)     -- Node's built-in crypto.scryptSync
  3. INSERT INTO users (email, password_salt, password_hash, ...)
     (unlike the settings table, users isn't routed through setSetting/encrypt —
     a salted hash is already unrecoverable, so there's nothing extra to protect)

attemptLogin(email, password):
  1. look up the user by (normalized, lowercased) email
  2. re-derive scrypt(password, stored salt) — even if no user was found, using
     a fixed dummy salt, so a nonexistent email costs the same time as a real one
  3. compare against the stored hash using crypto.timingSafeEqual
     (a fixed-time comparison, so an attacker can't guess the password
     one byte at a time by measuring how long comparisons take)
  4. on failure, bump failed_login_count; at 5 failures, set locked_until
     15 minutes out instead. On success, reset both and stamp last_login_at.
```

This also owns the brute-force lockout state (`failed_login_count`/`locked_until` columns) — persisted here rather than in memory specifically so a lockout survives a server restart, same reasoning as the sessions table below. A separate, non-persisted per-IP throttle lives in [`middleware/loginRateLimiter.ts`](../src/middleware/loginRateLimiter.ts). Full auth-flow detail (setup/migrate/login routing, the legacy-password upgrade path) is in [settings-app.md](settings-app.md).

## Sessions: why they needed their own table

`express-session` (the library that keeps you logged into `/settings` via a cookie) needs somewhere to store session data server-side — by default it uses an in-memory `MemoryStore`, which has two problems: it leaks memory over time, and every session vanishes the moment the process restarts (which happens on every deploy). [`settings/sessionStore.ts`](../src/settings/sessionStore.ts) replaces that with a small class backed by the `sessions` table:

```ts
class SqliteSessionStore extends session.Store {
  get(sid, callback)      // SELECT ... WHERE sid = ? AND expires_at > ? (also prunes expired rows first)
  set(sid, data, callback) // INSERT ... ON CONFLICT DO UPDATE  (upsert)
  destroy(sid, callback)   // DELETE ... WHERE sid = ?           (used on logout)
}
```

This alone isn't enough, though — `express-session` also signs the session cookie with a secret string, and if that secret changes, every existing cookie stops validating even if the session data is still sitting in the database. So the secret itself is generated once and persisted the same way as any other setting: `getOrCreateSessionSecret()` in `store.ts` checks for `internal.sessionSecret`, and only generates+saves a new random one if it's never been set before. Between the persistent store *and* the persistent secret, logging into `/settings` now survives container restarts/redeploys — previously both of these were regenerated fresh on every process start, so every restart force-logged everyone out.

## Request-time data flow

**Saving a business's settings** (`POST /b/:businessId/settings`):
```
browser form submit
  → middleware/resolveBusiness.ts: parse :businessId, look up the business, 404 if invalid
  → settings/businessRoutes.ts: for each field, if a non-blank value was submitted,
    call setBusinessSetting(businessId, key, value) — otherwise leave that key untouched
  → store.ts: encrypt(value) → INSERT/UPDATE business_settings table
```

**Authenticating an ElevenLabs tool call** (`POST /b/:businessId/tools/lookup-customer`, etc.):
```
ElevenLabs sends request with header X-Tool-Secret
  → middleware/resolveBusiness.ts: parse :businessId, look up the business, 404 if invalid
  → middleware/verifyToolSecret.ts: getBusinessSetting(businessId, "operational.toolWebhookSecret")
  → decrypt → timing-safe compare against the header value
  → if it matches, the request proceeds to the actual tool handler
  → a secret that's valid for a DIFFERENT business's businessId always fails here,
    since the lookup is scoped to the businessId resolved from this request's own URL
```

**A logged-in admin loading `/settings`**:
```
browser sends cookie
  → express-session reads the cookie, looks up the session ID in SqliteSessionStore.get()
  → SqliteSessionStore: SELECT from sessions table, decode JSON
  → if found and not expired, req.session.userId is available
  → requireAdminSession re-checks that user id still exists in the users
    table on every request (a deleted user's live session is rejected
    immediately) → page renders
```

## Inspecting the database directly

Because `node:sqlite` is built into Node, you can poke at the raw file with a one-off script — useful for debugging without adding a GUI tool. From the project directory:

```js
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./data/app.db');
console.log(db.prepare('SELECT key, updated_at FROM settings').all());
console.log(db.prepare('SELECT * FROM businesses').all());
console.log(db.prepare('SELECT business_id, key, updated_at FROM business_settings WHERE business_id = ?').all(1));
"
```

This shows you **which keys exist and when they were last touched** — not the actual values, since those are encrypted blobs. To decrypt a specific value for debugging, you'd additionally read `data/.encryption.key` and run the same AES-256-GCM unwrap that `store.ts` does (IV = first 12 bytes, auth tag = next 16, rest is ciphertext).

In Docker, run this inside the container instead:
```
docker compose exec app node -e "..."
```

## Security notes / limitations

- Encryption protects settings **at rest** (e.g. if someone got a copy of `app.db` without the key). It does not protect against someone with an active shell on the server while the app is running — the key is loaded into the running process's memory, and anyone who can query the app's own `/settings` API (with valid admin session or tool secret) sees the plaintext by design, since the app itself needs to use these values.
- There's no key rotation mechanism — changing the encryption key would make all previously-stored values unreadable. Rotating would require decrypting everything with the old key and re-encrypting with a new one, which isn't implemented.
- This is one file, one process — there's no replication or backup automation. On an `ENCRYPTION_KEY`-migrated deployment, back up `data/app.db` and the `.env` file holding the key **separately** — the whole point of the migration is that a leak of one alone isn't enough to decrypt anything. On an unmigrated deployment still using the fallback file, back up `data/app.db` **and** `data/.encryption.key` together (they're both in the same volume regardless).
