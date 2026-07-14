import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CallListFilters, CallListRow, RecoveryStatus } from "../api/types";
import { CallsTable } from "../components/CallsTable";
import { FiltersPanel } from "../components/FiltersPanel";
import { BulkActionBar } from "../components/BulkActionBar";

function filtersFromParams(params: URLSearchParams): CallListFilters {
  return {
    failedTransfer: params.get("failedTransfer") === "1",
    noBookingCreated: params.get("noBookingCreated") === "1",
    endedEarly: params.get("endedEarly") === "1",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    isRead: params.has("isRead") ? params.get("isRead") === "1" : undefined,
    status: (params.get("status") as never) ?? undefined,
  };
}

function paramsFromFilters(filters: CallListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.failedTransfer) params.set("failedTransfer", "1");
  if (filters.noBookingCreated) params.set("noBookingCreated", "1");
  if (filters.endedEarly) params.set("endedEarly", "1");
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.isRead !== undefined) params.set("isRead", filters.isRead ? "1" : "0");
  if (filters.status) params.set("status", filters.status);
  return params;
}

function toCsv(rows: CallListRow[]): string {
  const header = ["Date", "Status", "Duration (s)", "Customer", "Phone", "Call Handler", "Emergency", "Call Reason", "Lead/Job ID"];
  const lines = rows.map((r) =>
    [
      r.receivedAt,
      r.status,
      r.durationSecs ?? "",
      r.customerName ?? "",
      r.phone ?? "",
      r.callHandler,
      r.isEmergency ? "yes" : "no",
      r.callReason ?? "",
      r.jobId ?? r.leadId ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function CallsListPage() {
  const { businessId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["calls", businessId, searchParams.toString()],
    queryFn: () =>
      api.get<{ calls: CallListRow[] }>(`/api/businesses/${businessId}/calls?${searchParams.toString()}`),
  });

  const patchMutation = useMutation({
    mutationFn: (body: { conversationIds: string[]; isRead?: boolean; recoveryStatus?: RecoveryStatus }) =>
      api.patch(`/api/businesses/${businessId}/calls`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calls", businessId] });
    },
  });

  const rows = data?.calls ?? [];

  function updateFilters(next: CallListFilters) {
    setSearchParams(paramsFromFilters(next));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (rows.every((r) => prev.has(r.conversationId)) && rows.length > 0) return new Set();
      return new Set(rows.map((r) => r.conversationId));
    });
  }

  function toggleRead(id: string, current: boolean) {
    patchMutation.mutate({ conversationIds: [id], isRead: !current });
  }

  function bulkAction(patch: { isRead?: boolean; recoveryStatus?: RecoveryStatus }) {
    patchMutation.mutate({ conversationIds: Array.from(selected), ...patch });
    setSelected(new Set());
  }

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calls-${businessId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="topbar" style={{ padding: 0, border: "none", marginBottom: 16 }}>
        <h1>Calls</h1>
        <div className="topbar-actions">
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
      <FiltersPanel filters={filters} onChange={updateFilters} />
      <BulkActionBar
        count={selected.size}
        onMarkRead={() => bulkAction({ isRead: true })}
        onMarkUnread={() => bulkAction({ isRead: false })}
        onMarkRecovered={() => bulkAction({ recoveryStatus: "recovered" })}
        onMarkNotRecovered={() => bulkAction({ recoveryStatus: "not_recovered" })}
        onClear={() => setSelected(new Set())}
      />
      <div className="card" style={{ padding: 0 }}>
        {isLoading ? (
          <div style={{ padding: 16 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16 }} className="muted">
            No calls match the current filters.
          </div>
        ) : (
          <CallsTable
            businessId={businessId!}
            rows={rows}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onToggleRead={toggleRead}
          />
        )}
      </div>
    </div>
  );
}
