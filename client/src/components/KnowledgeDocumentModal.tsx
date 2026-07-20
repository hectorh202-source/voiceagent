import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ExtractedContent, KnowledgeDocumentDetail, KnowledgeSourceType, VoiceSyncResult } from "../api/types";
import { CloseIcon } from "./icons";

type Tab = KnowledgeSourceType;

// Add or edit one knowledge document. The defining idea: a URL or a file is
// *extracted to text first* and shown for review, and nothing is stored until
// the operator saves it. That's what lets imperfect PDF/page extraction be
// cleaned up by hand instead of silently indexing page nav and boilerplate.
export function KnowledgeDocumentModal({
  businessId,
  documentId,
  onClose,
}: {
  businessId: string | undefined;
  documentId: number | null; // null = create
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = documentId !== null;

  const [tab, setTab] = useState<Tab>("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceRef, setSourceRef] = useState<string | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: existing } = useQuery({
    queryKey: ["knowledge-doc", businessId, documentId],
    queryFn: () => api.get<KnowledgeDocumentDetail>(`/api/businesses/${businessId}/settings/knowledge-base/${documentId}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title);
    setContent(existing.content);
    setTab(existing.sourceType);
  }, [existing]);

  function applyExtracted(res: ExtractedContent) {
    setTitle((t) => t || res.title);
    setContent(res.content);
    setSourceRef(res.sourceRef);
    setTruncated(res.truncated);
    setError("");
  }

  const extractUrlMutation = useMutation({
    mutationFn: () => api.post<ExtractedContent>(`/api/businesses/${businessId}/settings/knowledge-base/extract-url`, { url }),
    onSuccess: applyExtracted,
    onError: (e: Error) => setError(e.message),
  });

  // Raw fetch rather than the shared `api` helper, which always JSON-encodes —
  // same reasoning as the voice test-audio call.
  const extractFileMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("file", file!);
      const res = await fetch(`/api/businesses/${businessId}/settings/knowledge-base/extract-file`, {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      return body as ExtractedContent;
    },
    onSuccess: applyExtracted,
    onError: (e: Error) => setError(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.put<{ voiceSync: VoiceSyncResult }>(`/api/businesses/${businessId}/settings/knowledge-base/${documentId}`, {
            title,
            content,
          })
        : api.post<{ voiceSync: VoiceSyncResult }>(`/api/businesses/${businessId}/settings/knowledge-base`, {
            title,
            content,
            sourceType: tab,
            sourceRef,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-base", businessId] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const extracting = extractUrlMutation.isPending || extractFileMutation.isPending;
  const canSave = title.trim().length > 0 && content.trim().length > 0 && !saveMutation.isPending;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? "Edit document" : "Add document"}</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {!isEdit && (
          <div className="modal-tabs">
            {(["text", "url", "file"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? "modal-tab active" : "modal-tab"}
                onClick={() => setTab(t)}
              >
                {t === "text" ? "Text" : t === "url" ? "URL" : "File"}
              </button>
            ))}
          </div>
        )}

        <div className="modal-body">
          {!isEdit && tab === "url" && (
            <div className="form-row">
              <label>Page URL</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://theclientsite.com/services"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => extractUrlMutation.mutate()}
                  disabled={!url.trim() || extracting}
                >
                  {extractUrlMutation.isPending ? "Fetching…" : "Fetch"}
                </button>
              </div>
              <div className="form-hint">We'll pull the page text so you can review it below before saving.</div>
            </div>
          )}

          {!isEdit && tab === "file" && (
            <div className="form-row">
              <label>File</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => extractFileMutation.mutate()}
                  disabled={!file || extracting}
                >
                  {extractFileMutation.isPending ? "Reading…" : "Read"}
                </button>
              </div>
              <div className="form-hint">
                PDF, DOCX, TXT, MD or CSV. A scanned PDF holds images rather than text and can't be read.
              </div>
            </div>
          )}

          {truncated && (
            <div className="form-hint" style={{ color: "#b45309" }}>
              That document was very long and has been trimmed. Consider splitting it into a few focused documents.
            </div>
          )}

          <div className="form-row">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Services & Pricing" />
          </div>

          <div className="form-row">
            <label>Content</label>
            <textarea
              rows={14}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                tab === "text"
                  ? "Type or paste what the assistant should know — services, pricing, hours, service area, policies…"
                  : "Extracted text appears here. Edit it freely before saving."
              }
            />
            <div className="form-hint">
              This exact text is what both the chat widget and the voice agent will use. Trim anything irrelevant.
            </div>
          </div>

          {error && <div className="form-hint" style={{ color: "#b91c1c" }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={!canSave}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
