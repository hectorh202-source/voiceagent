import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BusinessInfoSettings, ServiceCategory } from "../api/types";

const CATEGORY_ROWS = 10;

function emptyCategories(): ServiceCategory[] {
  return Array.from({ length: CATEGORY_ROWS }, () => ({ name: "", businessUnitId: "", jobTypeId: "" }));
}

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
  const [categories, setCategories] = useState<ServiceCategory[]>(emptyCategories());
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setBusinessUnitId(data.serviceTitanBusinessUnitId);
    setCampaignId(data.serviceTitanCampaignId);
    setJobTypeId(data.serviceTitanJobTypeId);
    const rows = emptyCategories();
    data.serviceCategories.forEach((c, i) => {
      if (i < CATEGORY_ROWS) rows[i] = c;
    });
    setCategories(rows);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/business-info`, {
        name,
        serviceTitanBusinessUnitId: businessUnitId,
        serviceTitanCampaignId: campaignId,
        serviceTitanJobTypeId: jobTypeId,
        serviceCategories: categories.filter((c) => c.name.trim()),
      }),
    onSuccess: () => {
      setSavedMessage("Settings saved.");
      queryClient.invalidateQueries({ queryKey: ["business-info", businessId] });
    },
  });

  function updateCategory(index: number, field: keyof ServiceCategory, value: string) {
    setCategories((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

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
          <label>Default business unit ID</label>
          <input value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)} />
          <div className="form-hint">Used if no service category matches.</div>
        </div>
        <div className="form-row">
          <label>Default campaign ID</label>
          <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Default job type ID</label>
          <input value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)} />
          <div className="form-hint">Used if no service category matches.</div>
        </div>
      </div>

      <div className="card">
        <h2>Service categories (optional)</h2>
        <p className="form-hint">Classify calls into a business unit/job type by name (e.g. "Plumbing", "HVAC").</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Business Unit ID</th>
              <th>Job Type ID</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => (
              <tr key={i}>
                <td>
                  <input value={c.name} onChange={(e) => updateCategory(i, "name", e.target.value)} />
                </td>
                <td>
                  <input value={c.businessUnitId} onChange={(e) => updateCategory(i, "businessUnitId", e.target.value)} />
                </td>
                <td>
                  <input value={c.jobTypeId} onChange={(e) => updateCategory(i, "jobTypeId", e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Save
      </button>
      {savedMessage && <span style={{ marginLeft: 8 }} className="muted">{savedMessage}</span>}
    </div>
  );
}
