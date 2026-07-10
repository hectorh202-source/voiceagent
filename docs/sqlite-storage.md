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

## The three tables

Defined in [`db/schema.ts`](../src/db/schema.ts) and created automatically on first startup (`CREATE TABLE IF NOT EXISTS`, so it's a no-op on every restart after the first):

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,           -- always encrypted, see below
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tool_name TEXT NOT NULL,       -- e.g. "lookup_customer", "create_lead"
  phone TEXT,                    -- caller's number, when known
  request_json TEXT NOT NULL,    -- the tool call's input, as JSON
  response_json TEXT,            -- the tool call's output, as JSON
  success INTEGER NOT NULL,      -- 0 or 1
  error_message TEXT
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,          -- session ID (from the cookie)
  session_json TEXT NOT NULL,    -- serialized express-session data
  expires_at INTEGER NOT NULL    -- unix ms timestamp
);
```

One file, one connection (`db/index.ts` exports a single shared `db` handle), three tables, each owned by one module:

| Table | Owned by | Purpose |
|---|---|---|
| `settings` | [`settings/store.ts`](../src/settings/store.ts) | Every credential + admin password hash + internal secrets |
| `call_log` | [`db/callLog.ts`](../src/db/callLog.ts) | Audit trail of every ElevenLabs tool call |
| `sessions` | [`settings/sessionStore.ts`](../src/settings/sessionStore.ts) | Logged-in admin sessions for the `/settings` page |

## `settings`: a key-value store, not a fixed schema

Rather than one column per credential, `settings` is a generic key-value table. Every credential is namespaced by dot-prefix, e.g.:

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
operational.emergencyTransferNumber
operational.toolWebhookSecret
admin.passwordHash
admin.passwordSalt
internal.sessionSecret
```

Two primitives do all the work (`settings/store.ts`):

```ts
getSetting(key: string): string | null   // null if never set
setSetting(key: string, value: string): void
```

`setSetting` always **encrypts** the value before the `INSERT ... ON CONFLICT DO UPDATE` write; `getSetting` always **decrypts** on the way out. Callers never see ciphertext.

### Why key-value instead of typed columns

This keeps adding a new credential a one-line change (no migrations), and — more importantly — it's what let us fix a real bug: earlier, the settings page read groups of related fields through a single "give me all of these or nothing" getter (e.g. one function for all of ElevenLabs' fields). If you saved just one field in a group, the getter would return `null` for the *whole group*, which blanked already-saved fields on the page and could even overwrite a real secret with an empty string on the next save. The fix was to read/write **every field independently** — see `getRawElevenLabsSettings()` / `getRawServiceTitanSettings()` / `getRawOperationalSettings()` in `store.ts`, each of which calls `getSetting()` once per field rather than gating on all of them at once.

The one place a group *is* still gated is `getServiceTitanConfig()`, used only by the actual ServiceTitan API client (`servicetitan/httpClient.ts`). That's intentional: you genuinely cannot make a ServiceTitan API call with only half the credentials, so that function returns `null` unless client ID, secret, app key, *and* tenant ID are all present — but that strict check is now isolated to the one place that legitimately needs it, instead of leaking into how the settings page displays things.

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

[`settings/encryptionKey.ts`](../src/settings/encryptionKey.ts) is almost the whole story:

```ts
const keyPath = "<same directory as the DB>/.encryption.key";
// on first run: generate 32 random bytes, write them to that file (mode 0600 = owner read/write only)
// on every run after: just read the existing file
```

This key is **never typed by a user and never committed to git** (`.gitignore` excludes the whole `data/` directory). It lives entirely as a local file, generated once. Practically, this means:

- If you delete `data/.encryption.key` but keep `data/app.db`, every encrypted value becomes permanently unreadable garbage (the auth tag check will fail on decrypt) — there is no recovery without the original key.
- If you copy `app.db` to a different machine without also copying `.encryption.key`, same problem.
- Backups need to include **both files together**, not just the `.db` file.

## Admin password: hashed, not encrypted

The admin password (used to log into `/settings`) is handled differently from credentials — it's **hashed**, not encrypted, because we only ever need to check "does this password match," never recover the original password. [`settings/auth.ts`](../src/settings/auth.ts):

```
setAdminPassword(password):
  1. generate a random 16-byte salt
  2. hash = scrypt(password, salt)     -- Node's built-in crypto.scryptSync
  3. store salt and hash as two settings keys (still passed through setSetting,
     so they're additionally encrypted at rest — belt and suspenders)

verifyAdminPassword(password):
  1. re-derive scrypt(password, stored salt)
  2. compare against the stored hash using crypto.timingSafeEqual
     (a fixed-time comparison, so an attacker can't guess the password
     one byte at a time by measuring how long comparisons take)
```

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

**Saving a setting** (`POST /settings`):
```
browser form submit
  → settings/routes.ts: for each field, if a non-blank value was submitted,
    call setSetting(key, value) — otherwise leave that key untouched
  → store.ts: encrypt(value) → INSERT/UPDATE settings table
```

**Authenticating an ElevenLabs tool call** (`POST /tools/lookup-customer`, etc.):
```
ElevenLabs sends request with header X-Tool-Secret
  → middleware/verifyToolSecret.ts: getSetting("operational.toolWebhookSecret")
  → decrypt → timing-safe compare against the header value
  → if it matches, the request proceeds to the actual tool handler
```

**A logged-in admin loading `/settings`**:
```
browser sends cookie
  → express-session reads the cookie, looks up the session ID in SqliteSessionStore.get()
  → SqliteSessionStore: SELECT from sessions table, decode JSON
  → if found and not expired, req.session.isAdmin is available → page renders
```

## Inspecting the database directly

Because `node:sqlite` is built into Node, you can poke at the raw file with a one-off script — useful for debugging without adding a GUI tool. From the project directory:

```js
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./data/app.db');
console.log(db.prepare('SELECT key, updated_at FROM settings').all());
"
```

This shows you **which keys exist and when they were last touched** — not the actual values, since those are encrypted blobs. To decrypt a specific value for debugging, you'd additionally read `data/.encryption.key` and run the same AES-256-GCM unwrap that `store.ts` does (IV = first 12 bytes, auth tag = next 16, rest is ciphertext).

In Docker, run this inside the container instead:
```
docker compose exec app node -e "..."
```

## Security notes / limitations

- Encryption protects settings **at rest** (e.g. if someone got a copy of `app.db` without the key file). It does not protect against someone with an active shell on the server while the app is running — the key is loaded into the running process's memory, and anyone who can query the app's own `/settings` API (with valid admin session or tool secret) sees the plaintext by design, since the app itself needs to use these values.
- There's no key rotation mechanism — changing the encryption key would make all previously-stored values unreadable. Rotating would require decrypting everything with the old key and re-encrypting with a new one, which isn't implemented.
- This is one file, one process — there's no replication or backup automation. Back up `data/app.db` **and** `data/.encryption.key` together if you care about not losing settings.
