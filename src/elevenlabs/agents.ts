import { requireElevenLabsConfig, elRequest } from "./httpClient";

// Confirmed against a real agent (2026-07-15): PATCH deep-merges
// conversation_config.tts — sending only these 5 fields leaves every other
// field (suggested_audio_tags, expressive_mode, agent_output_audio_format,
// etc.) untouched. Never send anything beyond these 5.
export const TTS_MODEL_IDS = [
  "eleven_turbo_v2",
  "eleven_turbo_v2_5",
  "eleven_flash_v2",
  "eleven_flash_v2_5",
  "eleven_multilingual_v2",
  "eleven_v3_conversational",
] as const;
export type TtsModelId = (typeof TTS_MODEL_IDS)[number];

export interface AgentVoiceConfig {
  modelId: TtsModelId;
  voiceId: string;
  stability: number;
  speed: number;
  similarityBoost: number;
  // Real ElevenLabs voice_settings fields confirmed to exist on the raw
  // Text-to-Speech API (used by generateTestAudio below) but NOT on a
  // Conversational AI agent's own conversation_config.tts — confirmed
  // against ElevenLabs' real API reference for GET /v1/convai/agents/{id}
  // (2026-07-19): that object only ever has stability/speed/similarity_boost,
  // no style or use_speaker_boost field at all. So these two are only ever
  // read/sent by generateTestAudio, never by updateAgentVoiceConfig's PATCH —
  // a real live call can never be affected by them, only the in-app Test
  // Audio preview. This split explains a real reported bug (2026-07-19):
  // the Test Audio button used to omit both entirely, so it wasn't a true
  // apples-to-apples comparison against ElevenLabs' own TTS playground for
  // the same voice, even with identical stability/speed/similarity.
  style?: number;
  useSpeakerBoost?: boolean;
}

interface AgentResponse {
  conversation_config?: {
    tts?: {
      model_id?: TtsModelId;
      voice_id?: string;
      stability?: number;
      speed?: number;
      similarity_boost?: number;
    };
  };
}

export async function getAgentVoiceConfig(businessId: number): Promise<AgentVoiceConfig | null> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<AgentResponse>(config, "GET", `/v1/convai/agents/${config.agentId}`);
  const tts = response.conversation_config?.tts;
  if (!tts?.voice_id || !tts.model_id) return null;
  return {
    modelId: tts.model_id,
    voiceId: tts.voice_id,
    stability: tts.stability ?? 0.5,
    speed: tts.speed ?? 1,
    similarityBoost: tts.similarity_boost ?? 0.8,
  };
}

export async function updateAgentVoiceConfig(businessId: number, voiceConfig: AgentVoiceConfig): Promise<void> {
  const config = requireElevenLabsConfig(businessId);
  await elRequest(config, "PATCH", `/v1/convai/agents/${config.agentId}`, {
    data: {
      conversation_config: {
        tts: {
          model_id: voiceConfig.modelId,
          voice_id: voiceConfig.voiceId,
          stability: voiceConfig.stability,
          speed: voiceConfig.speed,
          similarity_boost: voiceConfig.similarityBoost,
        },
      },
    },
  });
}

// A fixed, short receptionist-style line — kept brief since, unlike every
// other ElevenLabs call this app makes, this one is real paid speech
// synthesis (confirmed against a real account: a 50-word line cost ~72KB
// of audio), not free metadata. Lets someone actually hear the effect of
// stability/speed/similarity while they're still adjusting the sliders,
// which a voice's static preview clip (always its default settings) can't
// show at all.
const TEST_AUDIO_TEXT = "Hi, thanks for calling! How can I help you today?";

export async function generateTestAudio(businessId: number, voiceConfig: AgentVoiceConfig): Promise<Buffer> {
  const config = requireElevenLabsConfig(businessId);
  return elRequest<Buffer>(config, "POST", `/v1/text-to-speech/${voiceConfig.voiceId}`, {
    data: {
      text: TEST_AUDIO_TEXT,
      model_id: voiceConfig.modelId,
      voice_settings: {
        stability: voiceConfig.stability,
        similarity_boost: voiceConfig.similarityBoost,
        speed: voiceConfig.speed,
        // Always sent explicitly now, never omitted — see AgentVoiceConfig's
        // comment for the real bug this fixes. Falls back to ElevenLabs' own
        // documented API defaults only if a caller genuinely didn't supply
        // one; the client normally seeds these from the voice's own real
        // default settings (voices.ts's getVoiceDefaultSettings) instead.
        style: voiceConfig.style ?? 0,
        use_speaker_boost: voiceConfig.useSpeakerBoost ?? true,
      },
    },
    responseType: "arraybuffer",
  });
}
