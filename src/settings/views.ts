import type { getRawElevenLabsSettings, getRawOperationalSettings, getRawServiceTitanSettings } from "./store";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

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
<body>${body}</body>
</html>`;
}

export function renderSetupPage(error?: string): string {
  return page(
    "Set up admin password",
    `
    <h1>Voice Agent Platform — first-time setup</h1>
    <p>Create an admin password to protect the settings page (it will hold your ElevenLabs and ServiceTitan credentials).</p>
    ${error ? `<div class="flash-error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/settings/setup">
      <label>Admin password</label>
      <input type="password" name="password" minlength="8" required />
      <label>Confirm password</label>
      <input type="password" name="confirmPassword" minlength="8" required />
      <button type="submit">Create password &amp; continue</button>
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
      <label>Admin password</label>
      <input type="password" name="password" required autofocus />
      ${returnTo ? `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />` : ""}
      <button type="submit">Log in</button>
    </form>
  `,
  );
}

interface SettingsPageProps {
  elevenLabs: ReturnType<typeof getRawElevenLabsSettings>;
  serviceTitan: ReturnType<typeof getRawServiceTitanSettings>;
  operational: ReturnType<typeof getRawOperationalSettings>;
  flash?: { type: "success" | "error"; message: string };
}

export function renderSettingsPage(props: SettingsPageProps): string {
  const { elevenLabs, serviceTitan, operational, flash } = props;

  return page(
    "Settings",
    `
    <div class="row">
      <h1>Settings</h1>
      <form class="inline" method="post" action="/settings/logout"><button type="submit">Log out</button></form>
    </div>
    ${flash ? `<div class="flash-${flash.type}">${escapeHtml(flash.message)}</div>` : ""}

    <form method="post" action="/settings">
      <h2>ElevenLabs</h2>
      <label>API key ${elevenLabs.apiKeySet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="elevenLabsApiKey" placeholder="${elevenLabs.apiKeySet ? "•••••••• (unchanged)" : "sk_..."}" autocomplete="off" />

      <label>Agent ID</label>
      <input type="text" name="elevenLabsAgentId" value="${escapeHtml(elevenLabs.agentId)}" />

      <h2>ServiceTitan</h2>
      <label>Environment</label>
      <select name="serviceTitanEnvironment">
        <option value="integration" ${serviceTitan.environment === "integration" ? "selected" : ""}>Integration / Sandbox</option>
        <option value="production" ${serviceTitan.environment === "production" ? "selected" : ""}>Production</option>
      </select>

      <label>Client ID ${serviceTitan.clientIdSet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="serviceTitanClientId" placeholder="${serviceTitan.clientIdSet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />

      <label>Client secret ${serviceTitan.clientSecretSet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="serviceTitanClientSecret" placeholder="${serviceTitan.clientSecretSet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />

      <label>App key ${serviceTitan.appKeySet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="serviceTitanAppKey" placeholder="${serviceTitan.appKeySet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />

      <label>Tenant ID</label>
      <input type="text" name="serviceTitanTenantId" value="${escapeHtml(serviceTitan.tenantId)}" />

      <label>Default business unit ID</label>
      <input type="text" name="serviceTitanBusinessUnitId" value="${escapeHtml(serviceTitan.businessUnitId)}" />

      <label>Default campaign ID</label>
      <input type="text" name="serviceTitanCampaignId" value="${escapeHtml(serviceTitan.campaignId)}" />

      <label>Default call reason ID</label>
      <input type="text" name="serviceTitanCallReasonId" value="${escapeHtml(serviceTitan.callReasonId)}" />

      <label>Default job type ID</label>
      <input type="text" name="serviceTitanJobTypeId" value="${escapeHtml(serviceTitan.jobTypeId)}" />
      <div class="hint">Find these IDs in your ServiceTitan admin UI (Settings). Used to categorize leads created by the agent.</div>

      <label>Lead tag name (optional)</label>
      <input type="text" name="serviceTitanTagName" value="${escapeHtml(serviceTitan.tagName)}" placeholder="e.g. AI Voice Agent" />
      <div class="hint">Enter the exact name of an existing ServiceTitan tag (Settings → Tags) — no ID needed. Every lead this agent creates will be tagged with it, so it's identifiable once it becomes a job.</div>

      <h2>Operational</h2>
      <label>Emergency transfer number (E.164, e.g. +15551234567)</label>
      <input type="text" name="emergencyTransferNumber" value="${escapeHtml(operational.emergencyTransferNumber)}" />

      <label>Dashboard display time zone</label>
      <select name="timezone">
        ${TIMEZONE_OPTIONS.map(
          (tz) => `<option value="${tz}" ${operational.timezone === tz ? "selected" : ""}>${tz}</option>`,
        ).join("")}
      </select>
      <div class="hint">Only affects how call times are formatted on this dashboard. This is separate from the agent's own time zone setting in ElevenLabs, which controls the agent's time-awareness during calls (greetings, business hours, relative dates) — changing one does not change the other.</div>

      <label>Tool webhook shared secret ${operational.toolWebhookSecretSet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="toolWebhookSecret" placeholder="${operational.toolWebhookSecretSet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />
      <div class="hint">This value must match the "X-Tool-Secret" header you configure on each ElevenLabs webhook tool.</div>

      <label>Post-call webhook secret ${operational.postCallWebhookSecretSet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="postCallWebhookSecret" placeholder="${operational.postCallWebhookSecretSet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />
      <div class="hint">This must match the signing secret shown when you create the post-call webhook in ElevenLabs' Workspace Settings → Webhooks.</div>

      <button type="submit">Save settings</button>
    </form>

    <form method="post" action="/settings/generate-secret" onsubmit="return confirm('This will invalidate the current tool webhook secret immediately. The agent\\'s tools will fail until you update the new secret in ElevenLabs. Continue?')">
      <button type="submit">Generate a new random tool webhook secret</button>
    </form>
  `,
  );
}
