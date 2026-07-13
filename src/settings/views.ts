import type { getRawElevenLabsSettings, getRawOperationalSettings, getRawServiceTitanSettings } from "./store";
import type { User } from "../db/users";
import type { Business } from "../db/businesses";

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
  currentUserId: number;
  flash?: { type: "success" | "error"; message: string };
}

export function renderBusinessListPage(props: BusinessListPageProps): string {
  const { businesses, users, currentUserId, flash } = props;

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
          <a href="/b/${business.id}/settings">${escapeHtml(business.name)}</a>
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
        <div class="details-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0;">
          <span>${escapeHtml(user.email)}${isSelf ? " (you)" : ""}${isLocked ? ' <span class="flash-error" style="padding:2px 6px;">Locked</span>' : ""}</span>
          ${
            isSelf
              ? ""
              : `<form class="inline" method="post" action="/settings/users/${user.id}/delete" onsubmit="return confirm('Remove ${escapeHtml(user.email)}? They will be logged out immediately.')"><button type="submit">Remove</button></form>`
          }
        </div>`;
      })
      .join("")}

    <form method="post" action="/settings/users">
      <label>Add a user — email</label>
      <input type="email" name="email" required />
      <label>Password</label>
      <input type="password" name="password" minlength="8" required autocomplete="off" />
      <label>Confirm password</label>
      <input type="password" name="confirmPassword" minlength="8" required autocomplete="off" />
      <button type="submit">Add user</button>
    </form>
  `,
  );
}

interface SettingsPageProps {
  business: Business;
  elevenLabs: ReturnType<typeof getRawElevenLabsSettings>;
  serviceTitan: ReturnType<typeof getRawServiceTitanSettings>;
  operational: ReturnType<typeof getRawOperationalSettings>;
  flash?: { type: "success" | "error"; message: string };
}

export function renderSettingsPage(props: SettingsPageProps): string {
  const { business, elevenLabs, serviceTitan, operational, flash } = props;

  return page(
    `Settings — ${business.name}`,
    `
    <div class="row">
      <h1>Settings — ${escapeHtml(business.name)}</h1>
      <div>
        <a href="/settings">&larr; All businesses</a>
        <a href="/b/${business.id}/calls">View calls</a>
        <form class="inline" method="post" action="/settings/logout"><button type="submit">Log out</button></form>
      </div>
    </div>
    ${flash ? `<div class="flash-${flash.type}">${escapeHtml(flash.message)}</div>` : ""}

    <form method="post" action="/b/${business.id}/settings" onsubmit="return (!window.agentIdChanged || confirm('You are changing the ElevenLabs Agent ID. This points the whole app at a different agent — make sure its tools and webhooks are already configured to match, or calls will stop working correctly. Continue?')) && (!window.tenantIdChanged || confirm('You are changing the ServiceTitan Tenant ID. This points the whole app at a different ServiceTitan tenant — leads, customer lookups, and everything else will start hitting the wrong account. Continue?')) && (!window.tagNameChanged || confirm('You are changing the ServiceTitan lead tag name. Make sure a tag with this exact name already exists in ServiceTitan (Settings → Tags), or new leads will be created without a tag. Continue?'))">
      <h2>ElevenLabs</h2>
      <label>API key ${elevenLabs.apiKeySet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="elevenLabsApiKey" placeholder="${elevenLabs.apiKeySet ? "•••••••• (unchanged)" : "sk_..."}" autocomplete="off" />

      <label>Agent ID</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="agentIdInput" name="elevenLabsAgentId" value="${escapeHtml(elevenLabs.agentId)}" readonly style="background:#eee; color:#666; flex:1;" />
        <button type="button" onclick="const i=document.getElementById('agentIdInput'); i.readOnly=false; i.style.background=''; i.style.color=''; i.focus(); window.agentIdChanged=true; this.disabled=true;">Change</button>
      </div>

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
      <div style="display:flex; gap:8px;">
        <input type="text" id="tenantIdInput" name="serviceTitanTenantId" value="${escapeHtml(serviceTitan.tenantId)}" readonly style="background:#eee; color:#666; flex:1;" />
        <button type="button" onclick="const i=document.getElementById('tenantIdInput'); i.readOnly=false; i.style.background=''; i.style.color=''; i.focus(); window.tenantIdChanged=true; this.disabled=true;">Change</button>
      </div>

      <label>Default business unit ID</label>
      <input type="text" name="serviceTitanBusinessUnitId" value="${escapeHtml(serviceTitan.businessUnitId)}" />

      <label>Default campaign ID (required for lead creation)</label>
      <input type="text" name="serviceTitanCampaignId" value="${escapeHtml(serviceTitan.campaignId)}" />

      <label>Default call reason ID</label>
      <input type="text" name="serviceTitanCallReasonId" value="${escapeHtml(serviceTitan.callReasonId)}" />

      <label>Default job type ID</label>
      <input type="text" name="serviceTitanJobTypeId" value="${escapeHtml(serviceTitan.jobTypeId)}" />
      <div class="hint">Find these IDs in your ServiceTitan admin UI (Settings). Used to categorize leads created by the agent.</div>

      <label>Lead tag name (optional)</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="tagNameInput" name="serviceTitanTagName" value="${escapeHtml(serviceTitan.tagName)}" placeholder="e.g. AI Voice Agent" readonly style="background:#eee; color:#666; flex:1;" onfocus="document.getElementById('tagNameWarning').style.display='block'" />
        <button type="button" onclick="const i=document.getElementById('tagNameInput'); i.readOnly=false; i.style.background=''; i.style.color=''; i.focus(); window.tagNameChanged=true; this.disabled=true;">Change</button>
      </div>
      <div id="tagNameWarning" class="flash-error" style="display:none">This must exactly match a tag that already exists in ServiceTitan (Settings → Tags) — it is not created automatically. If no matching tag exists there, leads will still be created, just without a tag, with no error shown here.</div>
      <div class="hint">Enter the exact name of an existing ServiceTitan tag (Settings → Tags) — no ID needed. Every lead this agent creates will be tagged with it, so it's identifiable once it becomes a job.</div>

      <h2>Operational</h2>
      <label>Dashboard display time zone</label>
      <select name="timezone">
        ${TIMEZONE_OPTIONS.map(
          (tz) => `<option value="${tz}" ${operational.timezone === tz ? "selected" : ""}>${tz}</option>`,
        ).join("")}
      </select>
      <div class="hint">Only affects how call times are formatted on this dashboard. This is separate from the agent's own time zone setting in ElevenLabs, which controls the agent's time-awareness during calls (greetings, business hours, relative dates) — changing one does not change the other.</div>

      <label>Public dashboard base URL (optional override)</label>
      <input type="text" name="dashboardBaseUrl" value="${escapeHtml(operational.dashboardBaseUrl)}" placeholder="https://dashboard.laughslapper.com (default)" />
      <div class="hint">Used to build the "Call Details" link included in every ServiceTitan lead's summary. Already defaults to this deployment's dashboard domain — only set this if the dashboard is ever hosted at a different one. No trailing slash.</div>

      <label>Tool webhook shared secret ${operational.toolWebhookSecretSet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="toolWebhookSecret" placeholder="${operational.toolWebhookSecretSet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />
      <div class="hint">This value must match the "X-Tool-Secret" header you configure on each ElevenLabs webhook tool.</div>

      <label>Post-call webhook secret ${operational.postCallWebhookSecretSet ? "(saved — leave blank to keep current)" : ""}</label>
      <input type="password" name="postCallWebhookSecret" placeholder="${operational.postCallWebhookSecretSet ? "•••••••• (unchanged)" : ""}" autocomplete="off" />
      <div class="hint">This must match the signing secret shown when you create the post-call webhook in ElevenLabs' Workspace Settings → Webhooks.</div>

      <button type="submit">Save settings</button>
    </form>

    <form method="post" action="/b/${business.id}/settings/generate-secret" onsubmit="return confirm('This will invalidate the current tool webhook secret immediately. The agent\\'s tools will fail until you update the new secret in ElevenLabs. Continue?')">
      <button type="submit">Generate a new random tool webhook secret</button>
    </form>
  `,
  );
}
