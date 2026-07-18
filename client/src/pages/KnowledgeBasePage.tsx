import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { KnowledgeBaseDependentAgent, KnowledgeBaseDocument, KnowledgeBaseListResponse } from "../api/types";
import { KnowledgeBaseUploadModal } from "../components/KnowledgeBaseUploadModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

const TYPE_LABEL: Record<KnowledgeBaseDocument["type"], string> = {
  text: "Text",
  url: "URL",
  file: "File",
  folder: "Folder",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(unixSecs: number | null): string {
  if (unixSecs === null) return "—";
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// This business's own document library — manages ElevenLabs' native
// Knowledge Base feature (account-wide documents, attached per-agent) via
// src/elevenlabs/knowledgeBase.ts, rather than a competing document
// store/RAG system. Gets its own top-level nav item (like Voices) rather
// than living in Admin Settings — see docs/knowledge-base.md — since this
// is an ongoing content library non-admin staff would plausibly manage
// regularly, not a rarely-touched config field.
export function KnowledgeBasePage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ doc: KnowledgeBaseDocument; dependentAgents: KnowledgeBaseDependentAgent[] } | null>(null);

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["knowledge-base", businessId, search],
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (pageParam) params.set("cursor", pageParam);
      return api.get<KnowledgeBaseListResponse>(`/api/businesses/${businessId}/settings/knowledge-base?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });

  const documents = useMemo(() => data?.pages.flatMap((page) => page.documents) ?? [], [data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["knowledge-base", businessId] });
  }

  const attachMutation = useMutation({
    mutationFn: (doc: KnowledgeBaseDocument) =>
      api.put(`/api/businesses/${businessId}/settings/knowledge-base/${doc.id}/attach`, { name: doc.name, type: doc.type }),
    onSuccess: invalidate,
  });

  const detachMutation = useMutation({
    mutationFn: (doc: KnowledgeBaseDocument) => api.delete(`/api/businesses/${businessId}/settings/knowledge-base/${doc.id}/attach`),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (doc: KnowledgeBaseDocument) => api.delete(`/api/businesses/${businessId}/settings/knowledge-base/${doc.id}?force=1`),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  async function requestDelete(doc: KnowledgeBaseDocument) {
    const result = await api.get<{ dependentAgents: KnowledgeBaseDependentAgent[] }>(
      `/api/businesses/${businessId}/settings/knowledge-base/${doc.id}/dependent-agents`,
    );
    setPendingDelete({ doc, dependentAgents: result.dependentAgents });
  }

  return (
    <div>
      <h1>Knowledge Base</h1>
      <p className="form-hint" style={{ marginBottom: 16 }}>
        Documents the AI agent can reference during calls — managed via ElevenLabs' own Knowledge Base, attached to
        this business's agent below. Documents live on this business's ElevenLabs account, not just this one agent,
        so the same document could in principle be attached to more than one agent there.
      </p>

      <div className="form-row" style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: 600 }}>
        <div style={{ flex: 1 }}>
          <label>Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents…" />
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setIsUploadOpen(true)}>
          Add document
        </button>
      </div>

      {isLoading && <div className="muted">Loading…</div>}
      {isError && <div className="card"><p className="form-hint">{(error as Error).message}</p></div>}

      {!isLoading && !isError && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Updated</th>
              <th>Attached to agent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No documents yet — add one above.</td>
              </tr>
            )}
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.name}</td>
                <td>{TYPE_LABEL[doc.type]}</td>
                <td>{formatBytes(doc.sizeBytes)}</td>
                <td>{formatDate(doc.updatedAtUnixSecs)}</td>
                <td>
                  {doc.attached ? (
                    <span className="badge badge-success">Attached</span>
                  ) : (
                    <span className="badge badge-neutral">Not attached</span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {doc.attached ? (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => detachMutation.mutate(doc)}
                      disabled={detachMutation.isPending}
                    >
                      Detach
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => attachMutation.mutate(doc)}
                      disabled={attachMutation.isPending}
                    >
                      Attach
                    </button>
                  )}
                  {" · "}
                  <button type="button" className="link-btn" onClick={() => requestDelete(doc)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasNextPage && (
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {isUploadOpen && <KnowledgeBaseUploadModal businessId={businessId} onClose={() => setIsUploadOpen(false)} />}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.doc.name}"?`}
          message={
            pendingDelete.dependentAgents.length > 0
              ? `This document is currently used by ${pendingDelete.dependentAgents.length} agent(s), including this one if attached above. Deleting it removes it from all of them immediately, not just this business.`
              : "This permanently removes the document from ElevenLabs. This can't be undone."
          }
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete.doc)}
        />
      )}
    </div>
  );
}
