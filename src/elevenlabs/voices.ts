import { requireElevenLabsConfig, elRequest } from "./httpClient";

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
  // Only set for a result from exploreVoices() — identifies which
  // ElevenLabs user shares this voice, required to add it to this
  // account's own library before it can be used as an agent's voice_id
  // (confirmed: setting it directly without adding first fails with a
  // 400 voice_not_found).
  publicOwnerId: string | null;
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
      publicOwnerId: null,
    })),
    hasMore: response.has_more,
  };
}

interface SharedVoicesResponse {
  voices: {
    voice_id: string;
    name: string;
    category: string;
    preview_url?: string | null;
    labels?: Record<string, string>;
    public_owner_id: string;
  }[];
  has_more: boolean;
}

// GET /v1/shared-voices — ElevenLabs' full public voice library, entirely
// distinct from /v2/voices above: confirmed against a real account
// (2026-07-15) that /v2/voices only ever returns voices already saved to
// this account ("My Voices"), regardless of any voice_type filter — a
// search for a voice known to exist in the wider library came back empty
// there but found it here. This is what actually powers an "Explore"
// tab. A result here can't be set as an agent's voice_id directly (fails
// with 400 voice_not_found, confirmed) — see addSharedVoice() below.
export async function exploreVoices(businessId: number, search?: string): Promise<{ voices: VoiceSummary[]; hasMore: boolean }> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<SharedVoicesResponse>(config, "GET", "/v1/shared-voices", {
    params: { search: search || undefined, page_size: 20 },
  });
  return {
    voices: response.voices.map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      previewUrl: v.preview_url ?? null,
      labels: v.labels ?? {},
      publicOwnerId: v.public_owner_id,
    })),
    hasMore: response.has_more,
  };
}

// POST /v1/voices/add/{public_owner_id}/{voice_id} — adds a shared-library
// voice to this account's own collection, a required step before it can be
// used as an agent's voice_id (see exploreVoices() above). Returns the same
// voice_id, so the caller's existing reference to it keeps working.
export async function addSharedVoice(businessId: number, publicOwnerId: string, voiceId: string, name: string): Promise<void> {
  const config = requireElevenLabsConfig(businessId);
  await elRequest(config, "POST", `/v1/voices/add/${publicOwnerId}/${voiceId}`, {
    data: { new_name: name },
  });
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
      publicOwnerId: null,
    };
  } catch {
    // A voice_id the agent has configured could in principle be deleted
    // from the account later — degrade to "unknown voice" rather than
    // failing the whole settings page load over it.
    return null;
  }
}
