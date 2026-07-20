import { requireElevenLabsConfig, elRequest } from "./httpClient";

// Voice selection only — stability/speed/similarity/style/speaker-boost were
// removed entirely (2026-07-20): even with settings synced exactly, the app's
// Test Audio preview never sounded the same as ElevenLabs' own dashboard
// playground, and no amount of matching the documented voice_settings fields
// closed that gap. Rather than keep chasing an unexplained discrepancy, the
// app no longer adjusts any of these — the agent's own existing tuning (set
// directly in ElevenLabs' dashboard, if at all) is left untouched.
export interface AgentVoiceConfig {
  voiceId: string;
}

interface AgentResponse {
  conversation_config?: {
    tts?: {
      voice_id?: string;
    };
  };
}

export async function getAgentVoiceConfig(businessId: number): Promise<AgentVoiceConfig | null> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<AgentResponse>(config, "GET", `/v1/convai/agents/${config.agentId}`);
  const voiceId = response.conversation_config?.tts?.voice_id;
  if (!voiceId) return null;
  return { voiceId };
}

// Confirmed against a real agent (2026-07-15): PATCH deep-merges
// conversation_config.tts — sending only voice_id leaves every other field
// (model_id, stability, speed, similarity_boost, expressive_mode, etc.)
// untouched, which is exactly what we want now that this app never adjusts
// them.
export async function updateAgentVoiceConfig(businessId: number, voiceConfig: AgentVoiceConfig): Promise<void> {
  const config = requireElevenLabsConfig(businessId);
  await elRequest(config, "PATCH", `/v1/convai/agents/${config.agentId}`, {
    data: {
      conversation_config: {
        tts: {
          voice_id: voiceConfig.voiceId,
        },
      },
    },
  });
}
