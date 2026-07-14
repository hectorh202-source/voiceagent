import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import type { CallMetrics } from "../api/types";
import { DateRangePicker } from "../components/DateRangePicker";
import { formatDurationClock, formatPercent, formatTotalMinutes } from "../lib/format";

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type Preset = "thisMonth" | "lastMonth" | "last7" | "last30" | "custom";

// Computed in the browser's local time — good enough for "which preset am I
// looking at" convenience buttons. The backend's own date-range filtering is
// UTC-calendar-day-based (see call-dashboard.md), a separate, already-
// accepted coarse-filter tradeoff this doesn't change.
function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (preset) {
    case "thisMonth":
      return { from: toYMD(new Date(year, month, 1)), to: toYMD(now) };
    case "lastMonth":
      return { from: toYMD(new Date(year, month - 1, 1)), to: toYMD(new Date(year, month, 0)) };
    case "last7":
      return { from: toYMD(new Date(now.getTime() - 6 * 86400000)), to: toYMD(now) };
    case "last30":
      return { from: toYMD(new Date(now.getTime() - 29 * 86400000)), to: toYMD(now) };
  }
}

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
];

export function MetricsPage() {
  const { businessId } = useParams();
  // Defaults to the current calendar month — the primary use case here is
  // "how many minutes have we used this month," for anticipating the bill.
  const [{ from, to }, setRange] = useState(() => presetRange("thisMonth"));
  const [activePreset, setActivePreset] = useState<Preset>("thisMonth");

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading } = useQuery({
    queryKey: ["metrics", businessId, from, to],
    queryFn: () => api.get<CallMetrics>(`/api/businesses/${businessId}/metrics?${params.toString()}`),
  });

  function applyPreset(preset: Exclude<Preset, "custom">) {
    setActivePreset(preset);
    setRange(presetRange(preset));
  }

  function applyCustomRange(newFrom: string, newTo: string) {
    setActivePreset("custom");
    setRange({ from: newFrom, to: newTo });
  }

  return (
    <div>
      <div className="topbar" style={{ padding: 0, border: "none", marginBottom: 16 }}>
        <h1>Call Metrics</h1>
      </div>

      <div className="filters-panel">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className="btn"
            style={activePreset === p.key ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => applyPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
        <DateRangePicker from={from} to={to} onChange={applyCustomRange} />
      </div>

      {isLoading || !data ? (
        <div>Loading…</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="label">Total Minutes Used</div>
              <div className="value">{formatTotalMinutes(data.totalDurationSecs)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Forwarded (Human) Minutes</div>
              <div className="value">{formatTotalMinutes(data.forwardedDurationSecs)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">AI-Only Minutes</div>
              <div className="value">{formatTotalMinutes(data.aiOnlyDurationSecs)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Forwarded Calls</div>
              <div className="value">{data.forwardedCallCount}</div>
            </div>
          </div>

          <div className="stat-grid">
            <div className="stat-tile">
              <div className="label">Total Calls</div>
              <div className="value">{data.totalCalls}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Booked Rate</div>
              <div className="value">{formatPercent(data.bookedRate)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Avg. Call Duration</div>
              <div className="value">{formatDurationClock(data.avgDurationSecs)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Emergency Transfer Rate</div>
              <div className="value">{formatPercent(data.emergencyTransferRate)}</div>
            </div>
          </div>

          <div className="card">
            <h2>Minutes used per day</h2>
            {data.durationSecsPerDay.length === 0 ? (
              <p className="muted">No calls in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.durationSecsPerDay.map((d) => ({ date: d.date, minutes: Math.round(d.durationSecs / 60) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`${value} min`, "Minutes"]} />
                  <Bar dataKey="minutes" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h2>Calls per day</h2>
            {data.callsPerDay.length === 0 ? (
              <p className="muted">No calls in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.callsPerDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
