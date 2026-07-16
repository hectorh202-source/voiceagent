import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AgentVoiceConfig, TtsModelId, VoiceSettingsResponse, VoiceSummary } from "../api/types";
import { VoiceSelectorModal } from "../components/VoiceSelectorModal";
import { ChevronDownIcon, PlayIcon, PauseIcon } from "../components/icons";

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

  const { data, isLoading, isError, error } = useQuery({
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
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [isPlayingTest, setIsPlayingTest] = useState(false);

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

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => {
      const voiceConfig: AgentVoiceConfig = {
        modelId,
        voiceId: selectedVoice!.voiceId,
        stability,
        speed,
        similarityBoost,
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
      setSavedMessage("Voice settings saved.");
      queryClient.invalidateQueries({ queryKey: ["voice-settings", businessId] });
    },
  });

  // Unlike everything else on this page, this is real ElevenLabs speech
  // synthesis — costs actual credits per click — so it's a raw fetch
  // (binary audio/mpeg response, not JSON) rather than the shared `api`
  // helper, and only ever fires on an explicit button press, never
  // automatically as the sliders move.
  const testAudioMutation = useMutation({
    mutationFn: async () => {
      const voiceConfig: AgentVoiceConfig = { modelId, voiceId: selectedVoice!.voiceId, stability, speed, similarityBoost };
      const res = await fetch(`/api/businesses/${businessId}/settings/voice/test-audio`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voiceConfig),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed: ${res.status}`);
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      audio.src = url;
      audio
        .play()
        .then(() => setIsPlayingTest(true))
        .catch((err) => {
          console.error("Test audio playback failed:", err);
          setIsPlayingTest(false);
        });
    },
  });

  function toggleTestAudio() {
    if (isPlayingTest) {
      audioRef.current?.pause();
      setIsPlayingTest(false);
      return;
    }
    testAudioMutation.mutate();
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
        <div className="form-row">
          <label>Voice</label>
          <button type="button" className="voice-current-row" onClick={() => setIsPickerOpen(true)}>
            <span>{selectedVoice?.name ?? "Unknown voice"}</span>
            <ChevronDownIcon width={16} height={16} style={{ transform: "rotate(-90deg)" }} />
          </button>
        </div>

        <div className="form-row">
          <label>TTS model family</label>
          <div className="form-hint">Select the ElevenLabs model family used for text-to-speech generation.</div>
          <div className="select-display-wrap">
            <select className="select-display" value={modelId} onChange={(e) => setModelId(e.target.value as TtsModelId)}>
              {Object.entries(MODEL_INFO).map(([id, info]) => (
                <option key={id} value={id}>
                  {info.label} — {info.costHint}
                </option>
              ))}
            </select>
            <ChevronDownIcon width={14} height={14} />
          </div>
        </div>

        <div className="form-row">
          <label>Stability ({stability.toFixed(2)})</label>
          <input type="range" min={0} max={1} step={0.05} value={stability} onChange={(e) => setStability(Number(e.target.value))} />
          <div className="form-hint">Lower is more expressive/variable, higher is more consistent.</div>
        </div>

        <div className="form-row">
          <label>Speed ({speed.toFixed(2)})</label>
          <input type="range" min={0.7} max={1.2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          <div className="form-hint">Slower to faster speech.</div>
        </div>

        <div className="form-row">
          <label>Similarity ({similarityBoost.toFixed(2)})</label>
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
          <button type="button" className="btn" onClick={toggleTestAudio} disabled={testAudioMutation.isPending || !selectedVoice}>
            {isPlayingTest ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
            {testAudioMutation.isPending ? "Generating…" : isPlayingTest ? "Stop" : "Test these settings"}
          </button>
          <div className="form-hint">
            Generates a short sample line with the voice/model/settings above — unlike the picker's preview clips, this reflects your
            current stability/speed/similarity, not the voice's defaults. Uses real ElevenLabs credits per click.
          </div>
          {testAudioMutation.isError && <div className="form-hint">{(testAudioMutation.error as Error).message}</div>}
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

      <audio
        ref={audioRef}
        onEnded={() => setIsPlayingTest(false)}
        style={{ display: "none" }}
      />
    </div>
  );
}
