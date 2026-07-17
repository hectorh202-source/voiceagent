import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { GeneralSettings } from "../api/types";

export function GeneralSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["general-settings", businessId],
    queryFn: () => api.get<GeneralSettings>(`/api/businesses/${businessId}/settings/general`),
  });

  const [elevenLabsApiKey, setElevenLabsApiKey] = useState("");
  const [elevenLabsAgentId, setElevenLabsAgentId] = useState("");
  const [environment, setEnvironment] = useState<"integration" | "production">("integration");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [appKey, setAppKey] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [callReasonId, setCallReasonId] = useState("");
  const [tagName, setTagName] = useState("");
  const [bookingMode, setBookingMode] = useState<"lead" | "job">("lead");
  const [timezone, setTimezone] = useState("America/New_York");
  const [dashboardBaseUrl, setDashboardBaseUrl] = useState("");
  const [toolWebhookSecret, setToolWebhookSecret] = useState("");
  const [postCallWebhookSecret, setPostCallWebhookSecret] = useState("");
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [leadIntakeWebhookSecret, setLeadIntakeWebhookSecret] = useState("");
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState("");
  const [googleAdsRefreshToken, setGoogleAdsRefreshToken] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setElevenLabsAgentId(data.elevenLabs.agentId);
    setEnvironment(data.serviceTitan.environment);
    setTenantId(data.serviceTitan.tenantId);
    setCallReasonId(data.serviceTitan.callReasonId);
    setTagName(data.serviceTitan.tagName);
    setBookingMode(data.serviceTitan.bookingMode);
    setTimezone(data.operational.timezone);
    setDashboardBaseUrl(data.operational.dashboardBaseUrl);
    setTwilioPhoneNumber(data.operational.twilioPhoneNumber);
    setGoogleAdsCustomerId(data.googleAds.customerId);
  }, [data]);

  // A stray click on one of these silently breaks the integration rather
  // than erroring anywhere — points the whole app at a different ElevenLabs
  // agent, a different ServiceTitan tenant, an untagged/mistagged lead
  // pipeline, or a booking mode the agent's prompt isn't set up for. Same
  // guardrail the old server-rendered form had (unlock-then-confirm); this
  // is the equivalent for the React form, gating the whole save rather than
  // per-field unlock buttons.
  function confirmCriticalChanges(): boolean {
    if (!data) return true;
    if (elevenLabsAgentId !== data.elevenLabs.agentId) {
      if (!confirm("You are changing the ElevenLabs Agent ID. This points the whole app at a different agent — make sure its tools and webhooks are already configured to match, or calls will stop working correctly. Continue?")) {
        return false;
      }
    }
    if (tenantId !== data.serviceTitan.tenantId) {
      if (!confirm("You are changing the ServiceTitan Tenant ID. This points the whole app at a different ServiceTitan tenant — leads, customer lookups, and everything else will start hitting the wrong account. Continue?")) {
        return false;
      }
    }
    if (tagName !== data.serviceTitan.tagName) {
      if (!confirm("You are changing the ServiceTitan lead tag name. Make sure a tag with this exact name already exists in ServiceTitan (Settings → Tags), or new leads will be created without a tag. Continue?")) {
        return false;
      }
    }
    if (bookingMode !== data.serviceTitan.bookingMode) {
      if (!confirm("You are changing what calls produce in ServiceTitan (Lead vs. booked Job). Make sure the ElevenLabs agent's tools/prompt are already set up to match this mode, or calls will behave incorrectly. Continue?")) {
        return false;
      }
    }
    return true;
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/general`, {
        elevenLabsApiKey: elevenLabsApiKey || undefined,
        elevenLabsAgentId,
        serviceTitanEnvironment: environment,
        serviceTitanClientId: clientId || undefined,
        serviceTitanClientSecret: clientSecret || undefined,
        serviceTitanAppKey: appKey || undefined,
        serviceTitanTenantId: tenantId,
        serviceTitanCallReasonId: callReasonId,
        serviceTitanTagName: tagName,
        serviceTitanBookingMode: bookingMode,
        timezone,
        dashboardBaseUrl,
        toolWebhookSecret: toolWebhookSecret || undefined,
        postCallWebhookSecret: postCallWebhookSecret || undefined,
        twilioPhoneNumber: twilioPhoneNumber || undefined,
        leadIntakeWebhookSecret: leadIntakeWebhookSecret || undefined,
        googleAdsCustomerId: googleAdsCustomerId || undefined,
        googleAdsRefreshToken: googleAdsRefreshToken || undefined,
      }),
    onSuccess: () => {
      setMessage("Settings saved.");
      setElevenLabsApiKey("");
      setClientId("");
      setClientSecret("");
      setAppKey("");
      setToolWebhookSecret("");
      setPostCallWebhookSecret("");
      setLeadIntakeWebhookSecret("");
      setGoogleAdsRefreshToken("");
      queryClient.invalidateQueries({ queryKey: ["general-settings", businessId] });
    },
  });

  const generateSecretMutation = useMutation({
    mutationFn: () => api.post<{ secret: string }>(`/api/businesses/${businessId}/settings/general/generate-secret`),
    onSuccess: (res) => {
      setMessage(`New tool webhook secret: ${res.secret} — copy it into ElevenLabs now, it will be masked after you leave this page.`);
      queryClient.invalidateQueries({ queryKey: ["general-settings", businessId] });
    },
  });

  const generateLeadIntakeSecretMutation = useMutation({
    mutationFn: () =>
      api.post<{ secret: string }>(`/api/businesses/${businessId}/settings/general/generate-lead-intake-secret`),
    onSuccess: (res) => {
      setMessage(`New lead intake secret: ${res.secret} — copy it into whatever sends form/chat leads now, it will be masked after you leave this page.`);
      queryClient.invalidateQueries({ queryKey: ["general-settings", businessId] });
    },
  });

  if (isLoading || !data) return <div>Loading…</div>;

  return (
    <div>
      <h1>General Settings</h1>

      <div className="card">
        <h2>ElevenLabs</h2>
        <div className="form-row">
          <label>API key {data.elevenLabs.apiKeySet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={elevenLabsApiKey} onChange={(e) => setElevenLabsApiKey(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Agent ID</label>
          <input value={elevenLabsAgentId} onChange={(e) => setElevenLabsAgentId(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h2>ServiceTitan</h2>
        <div className="form-row">
          <label>Environment</label>
          <select value={environment} onChange={(e) => setEnvironment(e.target.value as never)}>
            <option value="integration">Integration (sandbox)</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div className="form-row">
          <label>Client ID {data.serviceTitan.clientIdSet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Client secret {data.serviceTitan.clientSecretSet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
        </div>
        <div className="form-row">
          <label>App key {data.serviceTitan.appKeySet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={appKey} onChange={(e) => setAppKey(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Tenant ID</label>
          <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Call reason ID</label>
          <input value={callReasonId} onChange={(e) => setCallReasonId(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Lead/Job tag name</label>
          <input value={tagName} onChange={(e) => setTagName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>What calls produce in ServiceTitan</label>
          <select value={bookingMode} onChange={(e) => setBookingMode(e.target.value as never)}>
            <option value="lead">Lead</option>
            <option value="job">Job</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Operational</h2>
        <div className="form-row">
          <label>Timezone</label>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Dashboard base URL</label>
          <input value={dashboardBaseUrl} onChange={(e) => setDashboardBaseUrl(e.target.value)} />
        </div>
        <div className="form-row">
          <label>
            Tool webhook secret{" "}
            {data.operational.toolWebhookSecretSet && <span className="muted">(set — leave blank to keep)</span>}
          </label>
          <input type="password" value={toolWebhookSecret} onChange={(e) => setToolWebhookSecret(e.target.value)} />
          <div className="form-hint">
            <button className="link-btn" onClick={() => generateSecretMutation.mutate()}>
              Generate a new secret
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>
            Post-call webhook secret{" "}
            {data.operational.postCallWebhookSecretSet && <span className="muted">(set — leave blank to keep)</span>}
          </label>
          <input type="password" value={postCallWebhookSecret} onChange={(e) => setPostCallWebhookSecret(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Twilio phone number</label>
          <input
            value={twilioPhoneNumber}
            onChange={(e) => setTwilioPhoneNumber(e.target.value)}
            placeholder="+19125551234"
          />
          <div className="form-hint">
            This business's assigned number under the master Twilio account (configured platform-wide under Admin
            Settings). Used to record the human portion of a transferred call — matches this number against calls
            currently in progress so recording can start while the call is still live.
          </div>
        </div>
        <div className="form-row">
          <label>
            Lead intake webhook secret{" "}
            {data.operational.leadIntakeWebhookSecretSet && <span className="muted">(set — leave blank to keep)</span>}
          </label>
          <input
            type="password"
            value={leadIntakeWebhookSecret}
            onChange={(e) => setLeadIntakeWebhookSecret(e.target.value)}
          />
          <div className="form-hint">
            <button className="link-btn" onClick={() => generateLeadIntakeSecretMutation.mutate()}>
              Generate a new secret
            </button>
          </div>
          <div className="form-hint">
            Have this business's website form or chat widget POST leads here. Body (JSON or form-urlencoded, both
            work):{" "}
            <code>{`{ source: "website_form" | "website_chat", name?, phone?, email?, message? }`}</code>
            <br />
            <strong>If the tool supports a custom header</strong> (most webhook/Zapier/Make integrations), POST to:
            <br />
            <code>{`${window.location.origin}/b/${businessId}/webhooks/leads/inbound`}</code>
            <br />
            with header <code>X-Lead-Intake-Secret: &lt;the secret above&gt;</code>.
            <br />
            <strong>If it only accepts a plain URL</strong> (e.g. Elementor Pro Forms' "Webhook" action, which has no
            header field), put the secret in the URL instead:
            <br />
            <code>{`${window.location.origin}/b/${businessId}/webhooks/leads/inbound?secret=<the secret above>`}</code>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Google Ads (Local Services Ads)</h2>
        <p className="form-hint">
          This business's own Google Ads account, used to pull Local Services Ads leads (message and phone-call
          inquiries) into the Leads inbox. The Developer Token/OAuth Client ID/Secret are configured once,
          platform-wide, under the global Admin Settings page — only this business's own Customer ID and refresh
          token go here.
        </p>
        <div className="form-row">
          <label>Customer ID</label>
          <input
            value={googleAdsCustomerId}
            onChange={(e) => setGoogleAdsCustomerId(e.target.value)}
            placeholder="123-456-7890"
          />
          <div className="form-hint">The 10-digit Google Ads account ID for this business's Local Services Ads.</div>
        </div>
        <div className="form-row">
          <label>
            Refresh token{" "}
            {data.googleAds.refreshTokenSet && <span className="muted">(set — leave blank to keep)</span>}
          </label>
          <input
            type="password"
            value={googleAdsRefreshToken}
            onChange={(e) => setGoogleAdsRefreshToken(e.target.value)}
            autoComplete="off"
          />
          <div className="form-hint">
            Manually obtained per business for now (no in-app "Connect with Google" flow yet) — see
            docs/google-lsa-leads.md for how this is generated.
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={() => confirmCriticalChanges() && saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        Save
      </button>
      {message && <div className="muted" style={{ marginTop: 8 }}>{message}</div>}
    </div>
  );
}
