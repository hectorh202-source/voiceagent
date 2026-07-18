import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { CloseIcon } from "./icons";

type Tab = "text" | "url" | "file";

// Three add-methods matching the three ElevenLabs Knowledge Base creation
// endpoints 1:1 (POST .../text, .../url, .../file) — see
// src/elevenlabs/knowledgeBase.ts. The file tab is a raw fetch with
// FormData, not the shared `api` helper (which always JSON-encodes), same
// reasoning as VoiceSettingsPage.tsx's test-audio call needing a raw fetch
// for a non-JSON body/response.
export function KnowledgeBaseUploadModal({ businessId, onClose }: { businessId: string | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("text");

  const [text, setText] = useState("");
  const [textName, setTextName] = useState("");
  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onCreated() {
    queryClient.invalidateQueries({ queryKey: ["knowledge-base", businessId] });
    onClose();
  }

  const textMutation = useMutation({
    mutationFn: () => api.post(`/api/businesses/${businessId}/settings/knowledge-base/text`, { text, name: textName || undefined }),
    onSuccess: onCreated,
  });

  const urlMutation = useMutation({
    mutationFn: () => api.post(`/api/businesses/${businessId}/settings/knowledge-base/url`, { url, name: urlName || undefined }),
    onSuccess: onCreated,
  });

  const fileMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("file", file!);
      if (fileName) formData.append("name", fileName);
      const res = await fetch(`/api/businesses/${businessId}/settings/knowledge-base/file`, {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: onCreated,
  });

  const activeMutation = tab === "text" ? textMutation : tab === "url" ? urlMutation : fileMutation;
  const canSubmit = tab === "text" ? text.trim().length > 0 : tab === "url" ? url.trim().length > 0 : !!file;

  function submit() {
    if (tab === "text") textMutation.mutate();
    else if (tab === "url") urlMutation.mutate();
    else fileMutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add document</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className="modal-tabs">
          <button type="button" className={tab === "text" ? "modal-tab active" : "modal-tab"} onClick={() => setTab("text")}>
            Text
          </button>
          <button type="button" className={tab === "url" ? "modal-tab active" : "modal-tab"} onClick={() => setTab("url")}>
            URL
          </button>
          <button type="button" className={tab === "file" ? "modal-tab active" : "modal-tab"} onClick={() => setTab("file")}>
            File
          </button>
        </div>

        <div className="modal-body">
          {tab === "text" && (
            <>
              <div className="form-row">
                <label>Name (optional)</label>
                <input value={textName} onChange={(e) => setTextName(e.target.value)} placeholder="e.g. Pricing overview" />
              </div>
              <div className="form-row">
                <label>Text</label>
                <textarea
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the content the agent should be able to reference…"
                />
              </div>
            </>
          )}

          {tab === "url" && (
            <>
              <div className="form-row">
                <label>Name (optional)</label>
                <input value={urlName} onChange={(e) => setUrlName(e.target.value)} placeholder="e.g. Service area page" />
              </div>
              <div className="form-row">
                <label>URL</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/pricing" />
              </div>
            </>
          )}

          {tab === "file" && (
            <>
              <div className="form-row">
                <label>Name (optional)</label>
                <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="Defaults to the file name" />
              </div>
              <div className="form-row">
                <label>File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <div className="form-hint">Non-enterprise ElevenLabs accounts have a 20MB / 300k character limit account-wide.</div>
              </div>
            </>
          )}

          {activeMutation.isError && <div className="form-hint">{(activeMutation.error as Error).message}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSubmit || activeMutation.isPending}>
            {activeMutation.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
