import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { InboundLeadListRow, LeadListFilters, LeadStatus } from "../api/types";
import { LeadsTable } from "../components/LeadsTable";
import { LeadsFiltersPanel } from "../components/LeadsFiltersPanel";
import { LeadsBulkActionBar } from "../components/LeadsBulkActionBar";

function filtersFromParams(params: URLSearchParams): LeadListFilters {
  return {
    source: (params.get("source") as never) ?? undefined,
    status: (params.get("status") as never) ?? undefined,
    isRead: params.has("isRead") ? params.get("isRead") === "1" : undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  };
}

function paramsFromFilters(filters: LeadListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.source) params.set("source", filters.source);
  if (filters.status) params.set("status", filters.status);
  if (filters.isRead !== undefined) params.set("isRead", filters.isRead ? "1" : "0");
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

function toCsv(rows: InboundLeadListRow[]): string {
  const header = ["Date", "Status", "Source", "Name", "Phone", "Email", "Message"];
  const lines = rows.map((r) =>
    [r.receivedAt, r.status, r.source, r.name ?? "", r.phone ?? "", r.email ?? "", r.message ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function LeadsListPage() {
  const { businessId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const queryClient = useQueryClient();

  // Same keyset (cursor) pagination as CallsListPage.tsx — every filter is a
  // real SQL predicate server-side (api/businessRouter.ts), so a page can
  // only look short because it truly reached the end of matching rows.
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["leads", businessId, searchParams.toString()],
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      const params = new URLSearchParams(searchParams);
      if (pageParam) params.set("cursor", pageParam);
      return api.get<{ leads: InboundLeadListRow[]; nextCursor: string | null }>(
        `/api/businesses/${businessId}/leads?${params.toString()}`,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const patchMutation = useMutation({
    mutationFn: (body: { ids: number[]; isRead?: boolean; status?: LeadStatus }) =>
      api.patch(`/api/businesses/${businessId}/leads`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads", businessId] });
    },
  });

  const rows = useMemo(() => data?.pages.flatMap((page) => page.leads) ?? [], [data]);

  function updateFilters(next: LeadListFilters) {
    setSearchParams(paramsFromFilters(next));
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (rows.every((r) => prev.has(r.id)) && rows.length > 0) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }

  function bulkAction(patch: { isRead?: boolean; status?: LeadStatus }) {
    patchMutation.mutate({ ids: Array.from(selected), ...patch });
    setSelected(new Set());
  }

  // Same drain-all-remaining-pages export pattern as CallsListPage.tsx —
  // uses each fetchNextPage() call's own returned result rather than the
  // closed-over data/hasNextPage, which won't reflect a page fetched earlier
  // in this same loop until React re-renders.
  async function exportCsv() {
    setIsExporting(true);
    try {
      let pages = data?.pages ?? [];
      let more = hasNextPage;
      while (more) {
        const result = await fetchNextPage();
        pages = result.data?.pages ?? pages;
        more = result.hasNextPage ?? false;
      }
      const allRows = pages.flatMap((page) => page.leads);
      const blob = new Blob([toCsv(allRows)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${businessId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div>
      <div className="topbar" style={{ padding: 0, border: "none", marginBottom: 16 }}>
        <h1>Leads</h1>
        <div className="topbar-actions">
          <button className="btn" onClick={exportCsv} disabled={isExporting}>
            {isExporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>
      <LeadsFiltersPanel filters={filters} onChange={updateFilters} />
      <LeadsBulkActionBar
        count={selected.size}
        onMarkRead={() => bulkAction({ isRead: true })}
        onMarkUnread={() => bulkAction({ isRead: false })}
        onSetStatus={(status) => bulkAction({ status })}
        onClear={() => setSelected(new Set())}
      />
      <div className="card" style={{ padding: 0 }}>
        {isLoading ? (
          <div style={{ padding: 16 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16 }} className="muted">
            No leads match the current filters.
          </div>
        ) : (
          <>
            <LeadsTable
              businessId={businessId!}
              rows={rows}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
            />
            {hasNextPage && (
              <div style={{ padding: 16, textAlign: "center" }}>
                <button className="btn" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
