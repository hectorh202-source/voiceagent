import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ChatWidgetSettings } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MASKED_SECRET_PLACEHOLDER } from "../lib/format";

const MODEL_OPTIONS = [
  { id: "claude-opus-4-8", label: "Opus 4.8 — best quality" },
  { id: "claude-sonnet-5", label: "Sonnet 5 — balanced" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — fastest / cheapest" },
];

// Per-business Chat Widget settings, rendered as one section of the business
// admin console (see AdminSettingsPage.tsx). Admin-gated like General Settings
// because it holds the Anthropic API key.
export function ChatWidgetSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["chat-widget-settings", businessId],
    queryFn: () => api.get<ChatWidgetSettings>(`/api/businesses/${businessId}/settings/chat-widget`),
  });

  const [enabled, setEnabled] = useState(false);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [model, setModel] = useState("claude-opus-4-8");
  const [agentName, setAgentName] = useState("");
  const [accentColor, setAccentColor] = useState("#2563eb");
  const [greeting, setGreeting] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [quickPrompts, setQuickPrompts] = useState("");
  const [allowedOrigins, setAllowedOrigins] = useState("");
  const [systemPromptExtras, setSystemPromptExtras] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setModel(data.model);
    setAgentName(data.agentName);
    setAccentColor(data.accentColor);
    setGreeting(data.greeting);
    setLogoUrl(data.logoUrl);
    setTagline(data.tagline);
    setQuickPrompts(data.quickPrompts.join("\n"));
    setAllowedOrigins(data.allowedOrigins.join("\n"));
    setSystemPromptExtras(data.systemPromptExtras);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/chat-widget`, {
        enabled,
        anthropicApiKey: anthropicApiKey || undefined,
        model,
        agentName,
        accentColor,
        greeting,
        logoUrl,
        tagline,
        quickPrompts: quickPrompts
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        systemPromptExtras,
        allowedOrigins: allowedOrigins
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setMessage("Settings saved.");
      setAnthropicApiKey("");
      queryClient.invalidateQueries({ queryKey: ["chat-widget-settings", businessId] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.post<{ embedKey: string }>(`/api/businesses/${businessId}/settings/chat-widget/rotate-embed-key`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-widget-settings", businessId] }),
  });

  if (isLoading || !data) return <div>Loading…</div>;

  const serviceBase = data.widgetServiceBaseUrl;
  const snippet = `<script src="${serviceBase || "<WIDGET_SERVICE_URL>"}/b/${businessId}/widget/embed.js" data-key="${data.embedKey}" async></script>`;

  return (
    <>
      <div className="card">
        <h2>Chat Widget</h2>
        <p className="form-hint">
          An AI chat bubble your clients embed on their website. It engages visitors, looks up their history in
          ServiceTitan, qualifies them, and books a job or forwards a lead into this Leads inbox. Install via the
          snippet below or the WordPress plugin.
        </p>

        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable the chat widget
          </label>
          <div className="form-hint">The widget won't load until this is on and an Anthropic API key is set below.</div>
        </div>

        <div className="form-row">
          <label>
            Anthropic API key {data.anthropicApiKeySet && <span className="muted">(set — leave blank to keep)</span>}
          </label>
          <input
            type="password"
            value={anthropicApiKey}
            onChange={(e) => setAnthropicApiKey(e.target.value)}
            placeholder={data.anthropicApiKeySet ? MASKED_SECRET_PLACEHOLDER : "sk-ant-…"}
            autoComplete="off"
          />
          <div className="form-hint">Powers the chat conversation. Billed to your Anthropic account.</div>
        </div>

        <div className="form-row">
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="form-hint">Higher quality costs more per conversation. Opus is the default.</div>
        </div>
      </div>

      <div className="card">
        <h2>Appearance</h2>
        <div className="form-row">
          <label>Assistant name</label>
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Assistant" />
        </div>
        <div className="form-row">
          <label>Accent color</label>
          <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ width: 60, height: 34, padding: 2 }} />
        </div>
        <div className="form-row">
          <label>Tagline</label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Typically replies in a few minutes"
          />
          <div className="form-hint">Small line under the name in the widget header.</div>
        </div>
        <div className="form-row">
          <label>Logo URL</label>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://clientsite.com/logo.png" />
          <div className="form-hint">
            Shown in the widget header and as the assistant's avatar. Use a direct link to an image (PNG/SVG, square or
            wide both work). Leave blank to show the assistant's initial instead.
          </div>
          {logoUrl.trim() && (
            <div style={{ marginTop: 8 }}>
              <img
                src={logoUrl}
                alt="Logo preview"
                style={{ maxHeight: 40, maxWidth: 180, objectFit: "contain", background: "#fff", borderRadius: 6 }}
              />
            </div>
          )}
        </div>
        <div className="form-row">
          <label>Greeting</label>
          <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} placeholder="Hi! How can I help?" />
        </div>
        <div className="form-row">
          <label>Quick prompts</label>
          <textarea
            value={quickPrompts}
            onChange={(e) => setQuickPrompts(e.target.value)}
            rows={4}
            placeholder={"Book a service\nGet a quote\nEmergency help\nAsk a question"}
          />
          <div className="form-hint">
            Clickable buttons shown under the greeting so visitors don't face a blank box. One per line, keep them
            short. Clicking one sends it as their first message. Max 6.
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Business context</h2>
        <div className="form-row">
          <label>Extra instructions for the assistant</label>
          <textarea
            value={systemPromptExtras}
            onChange={(e) => setSystemPromptExtras(e.target.value)}
            rows={6}
            placeholder="Services offered, service area, hours, tone, anything the assistant should know or say…"
          />
          <div className="form-hint">Added to the assistant's system prompt. Don't put secrets here.</div>
        </div>
      </div>

      <div className="card">
        <h2>Allowed website domains</h2>
        <p className="form-hint">
          The widget only loads on domains listed here (one per line, e.g. <code>https://acme.com</code>). This is what
          stops other sites from embedding it. Leave blank to disable everywhere.
        </p>
        <div className="form-row">
          <textarea
            value={allowedOrigins}
            onChange={(e) => setAllowedOrigins(e.target.value)}
            rows={4}
            placeholder={"https://acme.com\nhttps://www.acme.com"}
          />
        </div>
      </div>

      <div className="card">
        <h2>Install snippet</h2>
        {!serviceBase && (
          <p className="form-hint" style={{ color: "#b45309" }}>
            Set the <strong>Chat Widget Service URL</strong> in the global Admin Settings first — the snippet points at
            that service.
          </p>
        )}
        <p className="form-hint">Paste this just before the closing &lt;/body&gt; tag on the client's site:</p>
        <pre
          style={{
            background: "var(--code-bg, #f4f4f5)",
            padding: 12,
            borderRadius: 8,
            overflowX: "auto",
            fontSize: 13,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {snippet}
        </pre>
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard.writeText(snippet).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied!" : "Copy snippet"}
        </button>
        <div className="form-hint" style={{ marginTop: 12 }}>
          Embed key: <code>{data.embedKey}</code> (public).{" "}
          <button className="link-btn" onClick={() => setConfirmRotate(true)}>
            Rotate key
          </button>{" "}
          — invalidates every snippet already deployed.
        </div>
      </div>

      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Save
      </button>
      {message && <span className="muted" style={{ marginLeft: 8 }}>{message}</span>}

      {confirmRotate && (
        <ConfirmDialog
          title="Rotate the embed key?"
          message="Every install snippet already on a client's site uses the current key. Rotating it now will immediately stop those widgets from loading until each snippet is updated with the new key."
          confirmLabel="Rotate key"
          onCancel={() => setConfirmRotate(false)}
          onConfirm={() => {
            setConfirmRotate(false);
            rotateMutation.mutate();
          }}
        />
      )}
    </>
  );
}
