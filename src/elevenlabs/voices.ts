import { requireElevenLabsConfig, elRequest } from "./httpClient";

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
}

interface VoicesResponse {
  voices: {
    voice_id: string;
    name: string;
    category: string;
    preview_url?: string | null;
    labels?: Record<string, string>;
  }[];
  has_more: boolean;
}

// GET /v2/voices — confirmed against a real account (2026-07-15): returns
// both premade and professional-category voices, respects `search` (matches
// name/description/labels) and paginates via has_more, so a searchable
// picker is the right UI rather than a single giant dropdown.
export async function searchVoices(businessId: number, search?: string): Promise<{ voices: VoiceSummary[]; hasMore: boolean }> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<VoicesResponse>(config, "GET", "/v2/voices", {
    params: { search: search || undefined, page_size: 20 },
  });
  return {
    voices: response.voices.map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      previewUrl: v.preview_url ?? null,
      labels: v.labels ?? {},
    })),
    hasMore: response.has_more,
  };
}

interface SingleVoiceResponse {
  voice_id: string;
  name: string;
  category: string;
  preview_url?: string | null;
  labels?: Record<string, string>;
}

// GET /v1/voices/{id} — confirmed against a real account (2026-07-15). Used
// to resolve the agent's currently-configured voice_id into a display name,
// since the agent config itself only ever stores the bare ID.
export async function getVoice(businessId: number, voiceId: string): Promise<VoiceSummary | null> {
  const config = requireElevenLabsConfig(businessId);
  try {
    const v = await elRequest<SingleVoiceResponse>(config, "GET", `/v1/voices/${voiceId}`);
    return {
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      previewUrl: v.preview_url ?? null,
      labels: v.labels ?? {},
    };
  } catch {
    // A voice_id the agent has configured could in principle be deleted
    // from the account later — degrade to "unknown voice" rather than
    // failing the whole settings page load over it.
    return null;
  }
}
