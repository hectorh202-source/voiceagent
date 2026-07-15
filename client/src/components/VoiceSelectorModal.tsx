import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { VoiceSummary, VoicesSearchResponse } from "../api/types";
import { CloseIcon, SearchIcon, PlayIcon, PauseIcon, CheckIcon } from "./icons";

interface VoiceSelectorModalProps {
  businessId: string | undefined;
  selectedVoiceId: string;
  onSelect: (voice: VoiceSummary) => void;
  onClose: () => void;
}

// Two genuinely different data sources, not just a client-side filter of
// one list — confirmed against a real account: ElevenLabs' /v2/voices only
// ever returns voices already saved to this account ("My Voices"), while
// /v1/shared-voices is the full public library ("Explore"). See
// src/elevenlabs/voices.ts's searchVoices()/exploreVoices() for the detail.
export function VoiceSelectorModal({ businessId, selectedVoiceId, onSelect, onClose }: VoiceSelectorModalProps) {
  const [tab, setTab] = useState<"explore" | "my">("my");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const { data: myVoices, isLoading: isLoadingMy } = useQuery({
    queryKey: ["voice-search", businessId, debouncedSearch],
    queryFn: () =>
      api.get<VoicesSearchResponse>(
        `/api/businesses/${businessId}/settings/voices/search?search=${encodeURIComponent(debouncedSearch)}`,
      ),
    enabled: tab === "my",
  });

  const { data: exploreResults, isLoading: isLoadingExplore } = useQuery({
    queryKey: ["voice-explore", businessId, debouncedSearch],
    queryFn: () =>
      api.get<VoicesSearchResponse>(
        `/api/businesses/${businessId}/settings/voices/explore?search=${encodeURIComponent(debouncedSearch)}`,
      ),
    enabled: tab === "explore",
  });

  const results = tab === "my" ? myVoices : exploreResults;
  const isLoading = tab === "my" ? isLoadingMy : isLoadingExplore;

  function togglePreview(voice: VoiceSummary) {
    if (!voice.previewUrl) return;
    if (playingVoiceId === voice.voiceId) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = voice.previewUrl;
    audio
      .play()
      .then(() => setPlayingVoiceId(voice.voiceId))
      .catch((err) => {
        console.error("Voice preview playback failed:", err);
        setPlayingVoiceId(null);
      });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select a voice</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className="modal-tabs">
          <button type="button" className={tab === "explore" ? "modal-tab active" : "modal-tab"} onClick={() => setTab("explore")}>
            <SearchIcon width={14} height={14} /> Explore
          </button>
          <button type="button" className={tab === "my" ? "modal-tab active" : "modal-tab"} onClick={() => setTab("my")}>
            My Voices
          </button>
        </div>

        <div className="modal-body">
          <div className="voice-search-row">
            <SearchIcon width={14} height={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Start typing to search…" autoFocus />
          </div>

          {isLoading && <div className="muted">Loading…</div>}
          {!isLoading && results?.voices.length === 0 && <div className="muted">No voices found.</div>}

          <div className="voice-list">
            {results?.voices.map((voice) => (
              <div key={voice.voiceId} className="voice-row" onClick={() => onSelect(voice)}>
                <div className="voice-row-info">
                  <div className="voice-row-name">{voice.name}</div>
                  <div className="voice-row-category muted">{voice.category}</div>
                </div>
                {voice.previewUrl && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePreview(voice);
                    }}
                  >
                    {playingVoiceId === voice.voiceId ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
                  </button>
                )}
                {voice.voiceId === selectedVoiceId && <CheckIcon width={16} height={16} className="voice-row-check" />}
              </div>
            ))}
          </div>

          {results?.hasMore && <p className="form-hint">More results available — refine your search to narrow them down.</p>}
        </div>

        <audio ref={audioRef} onEnded={() => setPlayingVoiceId(null)} style={{ display: "none" }} />
      </div>
    </div>
  );
}
