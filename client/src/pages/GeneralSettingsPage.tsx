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
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
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
        twilioAccountSid: twilioAccountSid || undefined,
        twilioAuthToken: twilioAuthToken || undefined,
      }),
    onSuccess: () => {
      setMessage("Settings saved.");
      setElevenLabsApiKey("");
      setClientId("");
      setClientSecret("");
      setAppKey("");
      setToolWebhookSecret("");
      setPostCallWebhookSecret("");
      setTwilioAccountSid("");
      setTwilioAuthToken("");
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
      </div>

      <div className="card">
        <h2>Twilio</h2>
        <p className="form-hint">
          Used to record the human portion of a call after it's transferred (the AI's own recording ends once
          ElevenLabs hands off to the Conference Twilio manages). Enter this business's own Twilio Account SID and
          Auth Token — found on the Twilio Console dashboard.
        </p>
        <div className="form-row">
          <label>Account SID {data.twilio.accountSidSet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={twilioAccountSid} onChange={(e) => setTwilioAccountSid(e.target.value)} autoComplete="off" />
        </div>
        <div className="form-row">
          <label>Auth Token {data.twilio.authTokenSet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input type="password" value={twilioAuthToken} onChange={(e) => setTwilioAuthToken(e.target.value)} autoComplete="off" />
        </div>
        <div className="form-hint">
          Once saved, set this phone number's <strong>Status Callback URL</strong> (Twilio Console → Phone Numbers →
          this number → Voice Configuration) to:
          <br />
          <code>{`${window.location.origin}/b/${businessId}/webhooks/twilio/call-status`}</code>
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
