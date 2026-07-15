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
