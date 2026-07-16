import axios, { type Method } from "axios";
import { getElevenLabsConfig, type ElevenLabsConfig } from "../settings/store";

export class ElevenLabsNotConfiguredError extends Error {
  constructor() {
    super("ElevenLabs is not configured. Visit this business's General settings to add credentials.");
  }
}

export function requireElevenLabsConfig(businessId: number): ElevenLabsConfig {
  const config = getElevenLabsConfig(businessId);
  if (!config) throw new ElevenLabsNotConfiguredError();
  return config;
}

const API_BASE_URL = "https://api.elevenlabs.io";

export async function elRequest<T>(
  config: ElevenLabsConfig,
  method: Method,
  path: string,
  options: { params?: Record<string, unknown>; data?: unknown; responseType?: "json" | "arraybuffer" } = {},
): Promise<T> {
  const response = await axios.request<T>({
    method,
    url: `${API_BASE_URL}${path}`,
    params: options.params,
    data: options.data,
    responseType: options.responseType,
    headers: { "xi-api-key": config.apiKey },
  });
  return response.data;
}
