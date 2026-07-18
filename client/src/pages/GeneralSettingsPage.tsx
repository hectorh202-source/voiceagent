import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { GeneralSettings } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SecretRevealModal } from "../components/SecretRevealModal";
import { MASKED_SECRET_PLACEHOLDER } from "../lib/format";

export type GeneralSettingsSectionId = "elevenlabs" | "servicetitan" | "operational" | "google-ads";

// Renders one card at a time (selected by the parent's sub-nav — see
// AdminSettingsPage.tsx's BusinessAdminSettings) rather than the page's own
// heading + all four cards stacked, since this page keeps growing a new
// card with each integration (ServiceTitan, then Twilio-adjacent
// Operational fields, then Google Ads) and turned into the same
// long-scroll problem the Global Admin Settings page had. The Save button,
// its critical-change confirms, and the secret dialogs stay unconditional
// regardless of which card is showing — one combined save still submits
// every field, including ones on a card the user has since navigated away
// from, since all of this component's state lives here regardless of
// which card is currently rendered.
export function GeneralSettingsPage({ activeSection }: { activeSection: GeneralSettingsSectionId }) {
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
  const [dynamicMemoryEnabled, setDynamicMemoryEnabled] = useState(false);
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
    setDynamicMemoryEnabled(data.operational.dynamicMemoryEnabled);
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
        dynamicMemoryEnabled,
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

  // Which (if any) "Generate a new secret" confirm dialog is currently open,
  // and the just-generated secret (if any) waiting to be shown in
  // SecretRevealModal — both replace the old window.confirm()/inline-text
  // flow with in-app modals matching the rest of the design system.
  const [confirmRegenerate, setConfirmRegenerate] = useState<"tool" | "leadIntake" | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ title: string; secret: string; description: string } | null>(null);

  const generateSecretMutation = useMutation({
    mutationFn: () => api.post<{ secret: string }>(`/api/businesses/${businessId}/settings/general/generate-secret`),
    onSuccess: (res) => {
      setRevealedSecret({
        title: "New tool webhook secret",
        secret: res.secret,
        description: "Copy this into ElevenLabs now — it will be masked after you leave this page.",
      });
      queryClient.invalidateQueries({ queryKey: ["general-settings", businessId] });
    },
  });

  const generateLeadIntakeSecretMutation = useMutation({
    mutationFn: () =>
      api.post<{ secret: string }>(`/api/businesses/${businessId}/settings/general/generate-lead-intake-secret`),
    onSuccess: (res) => {
      setRevealedSecret({
        title: "New lead intake secret",
        secret: res.secret,
        description: "Copy this into whatever sends form/chat leads now — it will be masked after you leave this page.",
      });
      queryClient.invalidateQueries({ queryKey: ["general-settings", businessId] });
    },
  });

  if (isLoading || !data) return <div>Loading…</div>;

  return (
    <>
      {activeSection === "elevenlabs" && (
        <div className="card">
          <h2>ElevenLabs</h2>
          <div className="form-row">
            <label>API key {data.elevenLabs.apiKeySet && <span className="muted">(set — leave blank to keep)</span>}</label>
            <input
              type="password"
              value={elevenLabsApiKey}
              onChange={(e) => setElevenLabsApiKey(e.target.value)}
              placeholder={data.elevenLabs.apiKeySet ? MASKED_SECRET_PLACEHOLDER : undefined}
            />
          </div>
          <div className="form-row">
            <label>Agent ID</label>
            <input value={elevenLabsAgentId} onChange={(e) => setElevenLabsAgentId(e.target.value)} />
          </div>
        </div>
      )}

      {activeSection === "servicetitan" && (
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
          <input
            type="password"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={data.serviceTitan.clientIdSet ? MASKED_SECRET_PLACEHOLDER : undefined}
          />
        </div>
        <div className="form-row">
          <label>Client secret {data.serviceTitan.clientSecretSet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={data.serviceTitan.clientSecretSet ? MASKED_SECRET_PLACEHOLDER : undefined}
          />
        </div>
        <div className="form-row">
          <label>App key {data.serviceTitan.appKeySet && <span className="muted">(set — leave blank to keep)</span>}</label>
          <input
            type="password"
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            placeholder={data.serviceTitan.appKeySet ? MASKED_SECRET_PLACEHOLDER : undefined}
          />
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
      )}

      {activeSection === "operational" && (
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
          <input
            type="password"
            value={toolWebhookSecret}
            onChange={(e) => setToolWebhookSecret(e.target.value)}
            placeholder={data.operational.toolWebhookSecretSet ? MASKED_SECRET_PLACEHOLDER : undefined}
          />
          <div className="form-hint">
            <button
              className="link-btn"
              onClick={() => {
                // Same guardrail as confirmCriticalChanges() below — this
                // silently invalidates the secret ElevenLabs' tool webhook is
                // currently configured to sign with the moment it's clicked,
                // with no way to undo it. Only warn if a secret is already
                // set; generating one for the first time has nothing live to
                // break yet.
                if (data.operational.toolWebhookSecretSet) {
                  setConfirmRegenerate("tool");
                } else {
                  generateSecretMutation.mutate();
                }
              }}
            >
              Generate a new secret
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>
            Post-call webhook secret{" "}
            {data.operational.postCallWebhookSecretSet && <span className="muted">(set — leave blank to keep)</span>}
          </label>
          <input
            type="password"
            value={postCallWebhookSecret}
            onChange={(e) => setPostCallWebhookSecret(e.target.value)}
            placeholder={data.operational.postCallWebhookSecretSet ? MASKED_SECRET_PLACEHOLDER : undefined}
          />
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
            placeholder={data.operational.leadIntakeWebhookSecretSet ? MASKED_SECRET_PLACEHOLDER : undefined}
          />
          <div className="form-hint">
            <button
              className="link-btn"
              onClick={() => {
                if (data.operational.leadIntakeWebhookSecretSet) {
                  setConfirmRegenerate("leadIntake");
                } else {
                  generateLeadIntakeSecretMutation.mutate();
                }
              }}
            >
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
        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={dynamicMemoryEnabled}
              onChange={(e) => setDynamicMemoryEnabled(e.target.checked)}
            />
            Enable cross-call memory
          </label>
          <div className="form-hint">
            When enabled, the existing "lookup customer" tool call at the start of every call also returns a short
            summary of what a returning caller discussed last time — no separate webhook or ElevenLabs dashboard
            setup needed beyond a small prompt tweak telling the agent to use it. See docs/dynamic-memory.md.
            Off by default; disabling this here always takes effect immediately on the very next call.
          </div>
        </div>
      </div>
      )}

      {activeSection === "google-ads" && (
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
            placeholder={data.googleAds.refreshTokenSet ? MASKED_SECRET_PLACEHOLDER : undefined}
            autoComplete="off"
          />
          <div className="form-hint">
            Manually obtained per business for now (no in-app "Connect with Google" flow yet) — see
            docs/google-lsa-leads.md for how this is generated.
          </div>
        </div>
      </div>
      )}

      <button
        className="btn btn-primary"
        onClick={() => confirmCriticalChanges() && saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        Save
      </button>
      {message && <div className="muted" style={{ marginTop: 8 }}>{message}</div>}

      {confirmRegenerate === "tool" && (
        <ConfirmDialog
          title="Replace the tool webhook secret?"
          message="ElevenLabs is currently signing tool calls with the existing secret. Replacing it now will immediately invalidate that secret — every tool call (lookup_customer, check_availability, create_lead) will start failing with a 401 until you update ElevenLabs with the new one."
          confirmLabel="Generate new secret"
          onCancel={() => setConfirmRegenerate(null)}
          onConfirm={() => {
            setConfirmRegenerate(null);
            generateSecretMutation.mutate();
          }}
        />
      )}
      {confirmRegenerate === "leadIntake" && (
        <ConfirmDialog
          title="Replace the lead intake secret?"
          message="Whatever website form, chat widget, or Zapier/Make integration is currently configured to send leads here is using the existing secret. Replacing it now will immediately invalidate that secret — those submissions will start failing until you update it there too."
          confirmLabel="Generate new secret"
          onCancel={() => setConfirmRegenerate(null)}
          onConfirm={() => {
            setConfirmRegenerate(null);
            generateLeadIntakeSecretMutation.mutate();
          }}
        />
      )}
      {revealedSecret && (
        <SecretRevealModal
          title={revealedSecret.title}
          secret={revealedSecret.secret}
          description={revealedSecret.description}
          onClose={() => setRevealedSecret(null)}
        />
      )}
    </>
  );
}
