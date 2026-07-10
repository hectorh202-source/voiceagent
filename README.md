# Voice Agent Platform

An inbound AI receptionist for a ServiceTitan-using home services business. Calls are answered by an [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents) agent; the agent calls back into this server for three things during the conversation: looking up the caller in ServiceTitan, checking rough appointment availability, and creating a ServiceTitan CRM Lead for staff to confirm. No live schedule changes are made — leads are always confirmed by a human.

See [docs/](docs/README.md) for deeper technical write-ups on specific subsystems (e.g. how the SQLite-backed settings/credentials store works).

## How it fits together

```
Caller ──> Twilio number ──> ElevenLabs Conversational AI (native Twilio integration)
                                   │
                                   │  webhook "tool" calls (JSON over HTTPS)
                                   ▼
                         this server (Express, local + ngrok tunnel)
                                   │
                                   ▼
                            ServiceTitan API (CRM + Dispatch)
```

This server never touches call audio or Twilio directly — ElevenLabs' native Twilio integration owns the phone call. This server only receives clean JSON tool-call requests mid-conversation.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the env file (infra config only — no secrets go here):
   ```
   cp .env.example .env
   ```
3. Start the server:
   ```
   npm run dev
   ```
4. Open **http://localhost:3000/settings** in a browser:
   - First visit: create an admin password (protects this page once it's tunneled publicly).
   - Log in, then fill in:
     - **ElevenLabs**: API key, Agent ID (create the agent in the ElevenLabs dashboard first — see below).
     - **ServiceTitan**: environment (Integration/Sandbox to start), Client ID, Client Secret, App Key, Tenant ID, and the default Business Unit / Campaign / Call Reason / Job Type IDs used to categorize leads (found in your ServiceTitan admin UI under Settings).
     - **Operational**: the emergency transfer phone number, and a tool webhook shared secret (use the "Generate a new random tool webhook secret" button — copy the value shown immediately, it's masked afterward).
   - All of this is stored **encrypted** in the local SQLite database (`data/app.db`), using a key auto-generated on first run (`data/.encryption.key`) — nothing is ever written to `.env` or committed to source control.

5. In a second terminal, tunnel the server so ElevenLabs' cloud can reach it:
   ```
   ngrok http 3000
   ```
   Copy the `https://xxxx.ngrok-free.app` URL.

   **Note**: because ngrok makes your whole local server briefly public, keep your admin password private — `/settings` is the only thing standing between the internet and your credentials while the tunnel is up.

## ElevenLabs dashboard configuration

1. **Create the agent** (Conversational AI → Agents → New).
2. **Add three webhook tools**, each pointing at your ngrok URL:
   | Tool name | Method | URL | Body schema |
   |---|---|---|---|
   | `lookup_customer` | POST | `<ngrok>/tools/lookup-customer` | `{ "phone": string }` — default this param to `{{system__caller_id}}` so it runs silently at call start |
   | `check_availability` | POST | `<ngrok>/tools/check-availability` | `{ "startDate": string, "endDate": string, "jobType"?: string }` |
   | `create_lead` | POST | `<ngrok>/tools/create-lead` | `{ "phone": string, "name": string, "address": string, "issueDescription": string, "preferredTiming"?: string, "isEmergency"?: boolean }` |

   For each tool, add a custom header `X-Tool-Secret` whose value is the tool webhook secret from `/settings`.
3. **Enable the built-in "Transfer to Human" (`transfer_to_number`) system tool**, pointed at the emergency number, with a condition like "caller describes an emergency (gas smell, active flooding, no heat in freezing weather, etc.)".
4. **Write the system prompt** along these lines:
   - Greet as the business's receptionist; if `lookup_customer` (run silently via caller ID) found a match, greet by name/address instead of re-asking.
   - On an emergency, transfer immediately — skip lead creation.
   - Otherwise, capture the issue, urgency, and preferred timing; optionally call `check_availability` to set expectations without promising a slot.
   - Call `create_lead` with the gathered details.
   - Close with "a team member will call you back to confirm the exact appointment time" — never claim the job is booked.
   - If `create_lead` fails, apologize, confirm the phone number, and promise human follow-up — never dead-end the call.
5. **Import your Twilio number**: Phone Numbers tab → provide the Twilio number, Account SID, and Auth Token (from the Twilio console) → assign it to the agent. ElevenLabs configures the Twilio voice webhook automatically.

## Deploying to a VPS with Docker

This runs as two containers: the app itself, and [Caddy](https://caddyserver.com/) as a reverse proxy that gets you free, auto-renewing HTTPS (required — both ElevenLabs' tool webhooks and Twilio need HTTPS). The app's port is never published directly to the host or the internet — only Caddy's 80/443 are — so this coexists safely with anything else running on the same VPS (a game server, etc.), as long as those two ports are free.

1. **Get a hostname pointed at your VPS's IP.** You need *some* domain/subdomain for a trusted HTTPS cert — a bare IP won't work. If you don't have a domain yet, the fastest free option is [DuckDNS](https://www.duckdns.org/): sign in, create a subdomain (e.g. `yourname.duckdns.org`), and point it at your VPS's IP address. A real domain's A record works the same way.

2. **Get the code onto the VPS** (any of these work):
   ```
   git clone <your-repo-url> voice-agent
   ```
   or `scp -r` this folder to the VPS, e.g. `scp -r . user@your-vps-ip:~/voice-agent`.

3. **Edit `Caddyfile`** on the VPS, replacing `your-domain-here.example.com` with your actual domain/subdomain from step 1.

4. **Build and start both containers:**
   ```
   cd voice-agent
   docker compose up -d --build
   ```
   First startup takes a minute while Docker builds the app image and Caddy requests its certificate.

5. **Open firewall ports 80 and 443** if you have `ufw` or a cloud firewall enabled:
   ```
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

6. **Visit `https://your-domain/settings`** — same first-run password + credential flow as local dev, just permanently reachable now. Update your ElevenLabs tool webhook URLs and Twilio phone-number import to use this domain instead of the old ngrok URL (no more URL rotation).

**Data persistence**: the encrypted settings DB and its encryption key live in the `app-data` named Docker volume, not in the container itself — they survive `docker compose down` and rebuilds. They're only deleted if you explicitly run `docker compose down -v` (don't do that unless you intend to wipe all saved credentials).

**Updating later**: pull new code, then `docker compose up -d --build` again — the named volume is untouched by rebuilds.

## Testing

- `npm run build` — TypeScript strict-mode compile check.
- Manual tool test before wiring up ElevenLabs:
  ```
  curl -X POST http://localhost:3000/tools/lookup-customer \
    -H "Content-Type: application/json" \
    -H "X-Tool-Secret: <your secret>" \
    -d '{"phone": "+15551234567"}'
  ```
- End-to-end: call the Twilio number, run through a sample conversation, then confirm a row appears in `data/app.db` (`call_log` table) and a new Lead shows up in the ServiceTitan integration-environment UI.

## Scope notes

This is a phase-1 MVP: inbound calls only, sandbox ServiceTitan, leads (not live bookings). Outbound calling, live job scheduling, and richer post-call analytics are deliberately deferred.
