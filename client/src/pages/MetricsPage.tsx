import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import type { CallMetrics } from "../api/types";
import { DateRangePicker } from "../components/DateRangePicker";
import { formatDurationClock, formatPercent } from "../lib/format";

export function MetricsPage() {
  const { businessId } = useParams();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading } = useQuery({
    queryKey: ["metrics", businessId, from, to],
    queryFn: () => api.get<CallMetrics>(`/api/businesses/${businessId}/metrics?${params.toString()}`),
  });

  return (
    <div>
      <div className="topbar" style={{ padding: 0, border: "none", marginBottom: 16 }}>
        <h1>Call Metrics</h1>
        <div className="topbar-actions">
          <DateRangePicker from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        </div>
      </div>

      {isLoading || !data ? (
        <div>Loading…</div>
      ) : (
        <>
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
