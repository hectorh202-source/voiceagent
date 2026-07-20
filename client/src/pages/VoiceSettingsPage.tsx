import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AgentVoiceConfig, VoiceSettingsResponse, VoiceSummary } from "../api/types";
import { VoiceSelectorModal } from "../components/VoiceSelectorModal";
import { ChevronDownIcon } from "../components/icons";

// Voice selection only (2026-07-20) — stability/speed/similarity/style/
// speaker-boost controls and the Test Audio preview were removed entirely:
// even with settings synced exactly, Test Audio never sounded the same as
// ElevenLabs' own dashboard playground, so the app no longer adjusts any of
// these. The agent's own existing tuning (set directly in ElevenLabs'
// dashboard, if at all) is left untouched.
export function VoiceSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["voice-settings", businessId],
    queryFn: () => api.get<VoiceSettingsResponse>(`/api/businesses/${businessId}/settings/voice`),
    retry: false,
  });

  const [selectedVoice, setSelectedVoice] = useState<VoiceSummary | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (data.currentVoice) setSelectedVoice(data.currentVoice);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const voiceConfig: AgentVoiceConfig = {
        voiceId: selectedVoice!.voiceId,
        // Only a shared-library (Explore) pick carries a publicOwnerId —
        // the server adds it to this account's own voices before setting
        // it on the agent, since ElevenLabs rejects an unowned voice_id.
        addFromExplore: selectedVoice!.publicOwnerId
          ? { publicOwnerId: selectedVoice!.publicOwnerId, name: selectedVoice!.name }
          : undefined,
      };
      return api.put(`/api/businesses/${businessId}/settings/voice`, voiceConfig);
    },
    onSuccess: () => {
      setSavedMessage("Voice saved.");
      queryClient.invalidateQueries({ queryKey: ["voice-settings", businessId] });
    },
  });

  if (isLoading) return <div>Loading…</div>;

  if (isError || (data && !data.voiceConfig)) {
    return (
      <div>
        <h1>Voices</h1>
        <div className="card">
          <p className="form-hint">
            {isError ? (error as Error).message : "ElevenLabs isn't configured for this business yet — add an API key and Agent ID under Admin Settings first."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Voices</h1>

      <div className="card">
        <div className="form-row">
          <label>Voice</label>
          <button type="button" className="voice-current-row" onClick={() => setIsPickerOpen(true)}>
            <span>{selectedVoice?.name ?? "Unknown voice"}</span>
            <ChevronDownIcon width={16} height={16} style={{ transform: "rotate(-90deg)" }} />
          </button>
        </div>
      </div>

      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !selectedVoice}>
        Save
      </button>
      {savedMessage && (
        <span style={{ marginLeft: 8 }} className="muted">
          {savedMessage}
        </span>
      )}
      {saveMutation.isError && (
        <span className="muted" style={{ marginLeft: 8 }}>
          {(saveMutation.error as Error).message}
        </span>
      )}

      {isPickerOpen && (
        <VoiceSelectorModal
          businessId={businessId}
          selectedVoiceId={selectedVoice?.voiceId ?? ""}
          onSelect={(voice) => {
            setSelectedVoice(voice);
            setIsPickerOpen(false);
          }}
          onClose={() => setIsPickerOpen(false)}
        />
      )}
    </div>
  );
}
