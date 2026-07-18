import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { InboundLeadListRow, LeadListFilters, LeadStatus } from "../api/types";
import { LeadsFiltersPanel } from "../components/LeadsFiltersPanel";
import { LeadsBulkActionBar } from "../components/LeadsBulkActionBar";
import { LeadDetailPage } from "./LeadDetailPage";
import { formatDateTime, getLeadSourceLabel } from "../lib/format";
import { DesktopIcon, MessageIcon, PhoneIcon, MegaphoneIcon } from "../components/icons";
import type { ComponentType, SVGProps } from "react";

// Status is deliberately not shown in the list row anymore — it's set/edited
// in the detail pane's own Status dropdown (LeadDetailPage.tsx), and having
// it here too just competed with the row's more scannable icon+name+type
// hierarchy for attention. The icon is what should carry the "what kind of
// lead is this" signal at a glance instead of a customer-initials avatar,
// which told you nothing until you'd already read the name.
const SOURCE_ICON_STYLE: Record<string, { icon: ComponentType<SVGProps<SVGSVGElement>>; rgb: string }> = {
  website_form: { icon: DesktopIcon, rgb: "37, 99, 235" },
  website_chat: { icon: MessageIcon, rgb: "139, 92, 246" },
  facebook_ads: { icon: MegaphoneIcon, rgb: "245, 158, 11" },
  google_ads: { icon: MegaphoneIcon, rgb: "234, 88, 12" },
};

function getSourceIconStyle(source: string, sourceDetail?: string | null) {
  if (source === "google_lsa") {
    return sourceDetail === "PHONE_CALL"
      ? { icon: PhoneIcon, rgb: "20, 184, 166" }
      : { icon: MessageIcon, rgb: "139, 92, 246" };
  }
  return SOURCE_ICON_STYLE[source] ?? { icon: MessageIcon, rgb: "107, 114, 128" };
}

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

// A persistent two-pane Gmail-style inbox — list always visible on the
// left, selected lead's detail always visible on the right — replacing the
// old table-plus-modal-popup design. Both the "leads" and "leads/:leadId"
// routes point here (see App.tsx); leadId (present or not) just decides
// what the right pane shows. Owns all the list state (filters, pagination,
// selection, bulk actions, CSV export) that used to live in the retired
// LeadsListPage.tsx, largely unchanged.
export function LeadsPage() {
  const { businessId, leadId } = useParams();
  const navigate = useNavigate();
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

  // Gmail-style default: once the first page has loaded and nothing is
  // selected in the URL yet, open the first lead automatically. replace:
  // true so it doesn't add a back-button entry — there's no meaningful
  // "nothing selected" state to navigate back to once a first lead exists.
  useEffect(() => {
    if (!leadId && rows.length > 0) {
      navigate(`/${businessId}/leads/${rows[0].id}`, { replace: true });
    }
  }, [leadId, rows, businessId, navigate]);

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

  // Replaces the old "Load more" button — a narrow, short list pane makes a
  // click-to-load button awkward (you'd have to scroll all the way to a
  // small pane's bottom to see it). A sentinel div at the end of the list
  // triggers the next page fetch once it scrolls into view instead.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: el.parentElement, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="leads-page-root">
      <div className="topbar">
        <h1>Leads</h1>
        <div className="topbar-actions">
          <button className="btn" onClick={exportCsv} disabled={isExporting}>
            {isExporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="leads-layout">
        <div className="leads-list-pane">
          <LeadsFiltersPanel filters={filters} onChange={updateFilters} />
          <LeadsBulkActionBar
            count={selected.size}
            onMarkRead={() => bulkAction({ isRead: true })}
            onMarkUnread={() => bulkAction({ isRead: false })}
            onSetStatus={(status) => bulkAction({ status })}
            onClear={() => setSelected(new Set())}
          />
          {rows.length > 0 && (
            <div className="form-hint" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              Select all
            </div>
          )}
          <div className="leads-list-scroll">
            {isLoading ? (
              <div style={{ padding: 16 }} className="muted">
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 16 }} className="muted">
                No leads match the current filters.
              </div>
            ) : (
              <>
                {rows.map((row) => {
                  const { icon: SourceIcon, rgb } = getSourceIconStyle(row.source, row.sourceDetail);
                  return (
                    <div
                      key={row.id}
                      className={`lead-list-item${!row.isRead ? " unread" : ""}${
                        leadId === String(row.id) ? " selected" : ""
                      }`}
                      onClick={() => navigate(`/${businessId}/leads/${row.id}`)}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="lead-list-item-icon" style={{ background: `rgba(${rgb}, 0.14)`, color: `rgb(${rgb})` }}>
                        {!row.isRead && <span className="lead-list-item-unread-dot" />}
                        <SourceIcon width={18} height={18} />
                      </div>
                      <div className="lead-list-item-body">
                        <div className="lead-list-item-top">
                          <span className="lead-list-item-name">{row.name ?? "Unknown"}</span>
                          <span className="lead-list-item-date">{formatDateTime(row.receivedAt)}</span>
                        </div>
                        <div className="lead-list-item-type" style={{ color: `rgb(${rgb})` }}>
                          {getLeadSourceLabel(row.source, row.sourceDetail)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={sentinelRef} style={{ height: 1 }} />
                {isFetchingNextPage && (
                  <div style={{ padding: 12, textAlign: "center" }} className="muted">
                    Loading more…
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="leads-detail-pane">
          {leadId ? (
            <LeadDetailPage businessId={businessId!} leadId={leadId} />
          ) : (
            <div className="leads-empty-state">
              {isLoading ? "Loading…" : "Select a lead to view its details."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
