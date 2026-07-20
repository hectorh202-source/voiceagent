import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { KnowledgeDocumentListResponse, KnowledgeDocumentSummary, VoiceSyncResult } from "../api/types";
import { KnowledgeDocumentModal } from "../components/KnowledgeDocumentModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

const TYPE_LABEL: Record<KnowledgeDocumentSummary["sourceType"], string> = {
  text: "Text",
  url: "URL",
  file: "File",
};

function formatDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// This business's knowledge library, and the single place it's edited. The
// text stored here is the source of truth: the chat widget retrieves from it
// directly, and a copy is pushed to ElevenLabs so the voice agent can use the
// same material. See docs/knowledge-base.md.
export function KnowledgeBasePage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocumentSummary | null>(null);
  const [notice, setNotice] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["knowledge-base", businessId],
    queryFn: () => api.get<KnowledgeDocumentListResponse>(`/api/businesses/${businessId}/settings/knowledge-base`),
    retry: false,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["knowledge-base", businessId] });
  }

  const deleteMutation = useMutation({
    mutationFn: (doc: KnowledgeDocumentSummary) =>
      api.delete(`/api/businesses/${businessId}/settings/knowledge-base/${doc.id}`),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
  });

  const resyncMutation = useMutation({
    mutationFn: (doc: KnowledgeDocumentSummary) =>
      api.post<{ voiceSync: VoiceSyncResult }>(
        `/api/businesses/${businessId}/settings/knowledge-base/${doc.id}/resync`,
      ),
    onSuccess: (res) => {
      setNotice(
        res.voiceSync === "synced"
          ? "Pushed to the voice agent."
          : res.voiceSync === "not_configured"
            ? "Saved. ElevenLabs isn't configured for this business, so there's no voice agent to sync to — the chat widget still uses it."
            : "Couldn't reach ElevenLabs. The document is still live for the chat widget; try resyncing later.",
      );
      invalidate();
    },
  });

  const documents = data?.documents ?? [];

  return (
    <div>
      <h1>Knowledge Base</h1>
      <p className="form-hint" style={{ marginBottom: 16 }}>
        What your AI should know about this business — services, pricing, hours, service area, policies, common
        questions. <strong>Both the chat widget and the voice agent read from here</strong>, so you only maintain it in
        one place. Add typed text, pull a page from the website, or upload a document; whatever the source, you review
        the text before it's saved.
      </p>
      <p className="form-hint" style={{ marginBottom: 16 }}>
        Don't put passwords, API keys, or customer details in here — unlike credentials, this content is stored
        unencrypted so it can be searched, and the assistant may repeat any of it to a visitor.
      </p>

      <div style={{ marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null })}>
          Add document
        </button>
        {notice && <span className="muted" style={{ marginLeft: 10 }}>{notice}</span>}
      </div>

      {isLoading && <div className="muted">Loading…</div>}
      {isError && (
        <div className="card">
          <p className="form-hint">{(error as Error).message}</p>
        </div>
      )}

      {!isLoading && !isError && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Searchable pieces</th>
              <th>Voice agent</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing here yet — add your first document above.
                </td>
              </tr>
            )}
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>
                  {doc.title}
                  {doc.sourceRef && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {doc.sourceRef}
                    </div>
                  )}
                </td>
                <td>{TYPE_LABEL[doc.sourceType] ?? doc.sourceType}</td>
                <td>{doc.chunkCount}</td>
                <td>
                  {doc.syncedToVoice ? (
                    <span className="badge badge-success">Synced</span>
                  ) : (
                    <span className="badge badge-neutral">Not synced</span>
                  )}
                </td>
                <td>{formatDate(doc.updatedAt)}</td>
                <td>
                  <button type="button" className="link-btn" onClick={() => setEditing({ id: doc.id })}>
                    Edit
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => resyncMutation.mutate(doc)}
                    disabled={resyncMutation.isPending}
                  >
                    Resync
                  </button>
                  {" · "}
                  <button type="button" className="link-btn" onClick={() => setPendingDelete(doc)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {documents.length > 0 && (
        <p className="form-hint" style={{ marginTop: 12 }}>
          "Searchable pieces" is how many parts a document was split into for retrieval. "Not synced" means the voice
          agent doesn't have it — normal if this business has no ElevenLabs agent; otherwise use Resync.
        </p>
      )}

      {editing && (
        <KnowledgeDocumentModal businessId={businessId} documentId={editing.id} onClose={() => setEditing(null)} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title}"?`}
          message="This removes it from the chat widget's knowledge and from the voice agent. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
        />
      )}
    </div>
  );
}
