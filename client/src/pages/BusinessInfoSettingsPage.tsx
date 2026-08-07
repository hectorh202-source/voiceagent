import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BusinessInfoSettings } from "../api/types";

export function BusinessInfoSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["business-info", businessId],
    queryFn: () => api.get<BusinessInfoSettings>(`/api/businesses/${businessId}/settings/business-info`),
  });

  const [name, setName] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [jobTypeId, setJobTypeId] = useState("");
  const [jobTypeAliasesText, setJobTypeAliasesText] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setBusinessUnitId(data.serviceTitanBusinessUnitId);
    setCampaignId(data.serviceTitanCampaignId);
    setJobTypeId(data.serviceTitanJobTypeId);
    setJobTypeAliasesText(data.serviceTitanJobTypeAliases.map((a) => `${a.alias} | ${a.jobTypeName}`).join("\n"));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/business-info`, {
        name,
        serviceTitanBusinessUnitId: businessUnitId,
        serviceTitanCampaignId: campaignId,
        serviceTitanJobTypeId: jobTypeId,
        serviceTitanJobTypeAliases: jobTypeAliasesText
          .split("\n")
          .map((line) => {
            const [alias, jobTypeName] = line.split("|").map((part) => part.trim());
            return alias && jobTypeName ? { alias, jobTypeName } : null;
          })
          .filter((a): a is { alias: string; jobTypeName: string } => a !== null),
      }),
    onSuccess: () => {
      setSavedMessage("Settings saved.");
      queryClient.invalidateQueries({ queryKey: ["business-info", businessId] });
    },
  });

  if (isLoading) return <div>Loading…</div>;

  return (
    <div>
      <h1>Business Info</h1>
      <div className="card">
        <div className="form-row">
          <label>Business name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Default business unit ID (fallback)</label>
          <input value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)} />
          <div className="form-hint">
            Used only when the AI agent's captured service type doesn't match any of this business's real
            ServiceTitan job types by name — that live lookup is checked first on every call, so this fallback
            never needs updating just because ServiceTitan-side job types changed.
          </div>
        </div>
        <div className="form-row">
          <label>Default campaign ID</label>
          <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
          <div className="form-hint">Required by ServiceTitan on every lead — there's no way to infer which campaign to attribute a call to, so this always applies.</div>
        </div>
        <div className="form-row">
          <label>Default job type ID (fallback)</label>
          <input value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)} />
          <div className="form-hint">Same fallback reasoning as the business unit ID above.</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Service type aliases</h2>
        <div className="form-hint" style={{ marginBottom: 12 }}>
          The AI agent often describes what a caller needs with a general word (e.g. "Plumbing", "HVAC") rather than
          one of this business's exact ServiceTitan job type names. When that happens, the exact-name lookup misses
          and the call falls back to the single default job type above — regardless of what the caller actually
          needs. Add a mapping here to catch those cases: one per line, the phrase the agent might use, then a{" "}
          <code>|</code>, then the exact real ServiceTitan job type name it should resolve to instead.
        </div>
        <textarea
          rows={6}
          style={{ width: "100%", fontFamily: "monospace" }}
          placeholder={"Plumbing | Misc. Plumbing\nHVAC | HVAC Repair"}
          value={jobTypeAliasesText}
          onChange={(e) => setJobTypeAliasesText(e.target.value)}
        />
        <div className="form-hint" style={{ marginTop: 8 }}>
          The target still has to match a real, current ServiceTitan job type name exactly (case-insensitive) — this
          only adds another phrase that can resolve to it, it doesn't create or rename anything in ServiceTitan.
        </div>
      </div>

      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={{ marginTop: 16 }}>
        Save
      </button>
      {savedMessage && <span style={{ marginLeft: 8 }} className="muted">{savedMessage}</span>}
    </div>
  );
}
