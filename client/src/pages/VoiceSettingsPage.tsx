import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AgentVoiceConfig, TtsModelId, VoiceSettingsResponse, VoicesSearchResponse, VoiceSummary } from "../api/types";

// Cost framed qualitatively, not as a precise number — ElevenLabs' exact
// per-model pricing isn't part of their agent-config API and shifts over
// time, but the relative ordering (Turbo/Flash cheaper than Multilingual/v3)
// is stable enough to guide a non-technical user's choice.
const MODEL_INFO: Record<TtsModelId, { label: string; costHint: string }> = {
  eleven_turbo_v2: { label: "Turbo v2", costHint: "Fastest, lowest cost" },
  eleven_turbo_v2_5: { label: "Turbo v2.5", costHint: "Fast, low cost, better quality than v2" },
  eleven_flash_v2: { label: "Flash v2", costHint: "Fastest, lowest cost" },
  eleven_flash_v2_5: { label: "Flash v2.5", costHint: "Fast, low cost, better quality than v2" },
  eleven_multilingual_v2: { label: "Multilingual v2", costHint: "Highest quality, costs more per minute" },
  eleven_v3_conversational: { label: "v3 Conversational", costHint: "Newest, most expressive, costs more per minute" },
};

export function VoiceSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["voice-settings", businessId],
    queryFn: () => api.get<VoiceSettingsResponse>(`/api/businesses/${businessId}/settings/voice`),
    retry: false,
  });

  const [selectedVoice, setSelectedVoice] = useState<VoiceSummary | null>(null);
  const [modelId, setModelId] = useState<TtsModelId>("eleven_flash_v2");
  const [stability, setStability] = useState(0.5);
  const [speed, setSpeed] = useState(1);
  const [similarityBoost, setSimilarityBoost] = useState(0.8);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    if (data.currentVoice) setSelectedVoice(data.currentVoice);
    if (data.voiceConfig) {
      setModelId(data.voiceConfig.modelId);
      setStability(data.voiceConfig.stability);
      setSpeed(data.voiceConfig.speed);
      setSimilarityBoost(data.voiceConfig.similarityBoost);
    }
  }, [data]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ["voice-search", businessId, debouncedSearch],
    queryFn: () =>
      api.get<VoicesSearchResponse>(
        `/api/businesses/${businessId}/settings/voices/search?search=${encodeURIComponent(debouncedSearch)}`,
      ),
    // No point searching a voice library ElevenLabs itself isn't reachable
    // for — wait until the initial config load confirms it's configured.
    enabled: !isError && !!data,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const voiceConfig: AgentVoiceConfig = {
        modelId,
        voiceId: selectedVoice!.voiceId,
        stability,
        speed,
        similarityBoost,
      };
      return api.put(`/api/businesses/${businessId}/settings/voice`, voiceConfig);
    },
    onSuccess: () => {
      setSavedMessage("Voice settings saved.");
      queryClient.invalidateQueries({ queryKey: ["voice-settings", businessId] });
    },
  });

  function togglePreview(voice: VoiceSummary) {
    if (!voice.previewUrl) return;
    if (playingVoiceId === voice.voiceId) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.src = voice.previewUrl;
      audioRef.current.play();
      setPlayingVoiceId(voice.voiceId);
    }
  }

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
        <h2>Current voice</h2>
        {selectedVoice ? (
          <div className="form-row">
            <strong>{selectedVoice.name}</strong>
            {selectedVoice.previewUrl && (
              <button type="button" className="btn" onClick={() => togglePreview(selectedVoice)}>
                {playingVoiceId === selectedVoice.voiceId ? "Stop" : "Preview"}
              </button>
            )}
          </div>
        ) : (
          <p className="form-hint">Unknown voice (it may have been removed from the account).</p>
        )}
      </div>

      <div className="card">
        <h2>Change voice</h2>
        <div className="form-row">
          <label>Search voices</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, accent, gender…" />
        </div>
        {isSearching && <div className="muted">Searching…</div>}
        <table className="data-table">
          <tbody>
            {searchResults?.voices.map((voice) => (
              <tr key={voice.voiceId}>
                <td>
                  <input
                    type="radio"
                    name="voice"
                    checked={selectedVoice?.voiceId === voice.voiceId}
                    onChange={() => setSelectedVoice(voice)}
                  />
                </td>
                <td>{voice.name}</td>
                <td className="muted">{voice.category}</td>
                <td>
                  {voice.previewUrl && (
                    <button type="button" className="btn" onClick={() => togglePreview(voice)}>
                      {playingVoiceId === voice.voiceId ? "Stop" : "Preview"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {searchResults?.hasMore && <p className="form-hint">More results available — refine your search to narrow them down.</p>}
      </div>

      <div className="card">
        <h2>Model</h2>
        <div className="form-row">
          <label>TTS model</label>
          <select value={modelId} onChange={(e) => setModelId(e.target.value as TtsModelId)}>
            {Object.entries(MODEL_INFO).map(([id, info]) => (
              <option key={id} value={id}>
                {info.label} — {info.costHint}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Voice settings</h2>
        <div className="form-row">
          <label>Stability ({stability.toFixed(2)})</label>
          <input type="range" min={0} max={1} step={0.05} value={stability} onChange={(e) => setStability(Number(e.target.value))} />
          <div className="form-hint">Lower is more expressive/variable, higher is more consistent.</div>
        </div>
        <div className="form-row">
          <label>Similarity boost ({similarityBoost.toFixed(2)})</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={similarityBoost}
            onChange={(e) => setSimilarityBoost(Number(e.target.value))}
          />
          <div className="form-hint">How closely the voice matches the original recording.</div>
        </div>
        <div className="form-row">
          <label>Speed ({speed.toFixed(2)})</label>
          <input type="range" min={0.7} max={1.2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
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

      <audio ref={audioRef} onEnded={() => setPlayingVoiceId(null)} style={{ display: "none" }} />
    </div>
  );
}
