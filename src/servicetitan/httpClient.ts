import axios, { type Method } from "axios";
import { getServiceTitanConfig, type ServiceTitanConfig } from "../settings/store";
import { getAccessToken } from "./authClient";

export class ServiceTitanNotConfiguredError extends Error {
  constructor() {
    super("ServiceTitan is not configured. Visit /settings to add credentials.");
  }
}

export function requireServiceTitanConfig(): ServiceTitanConfig {
  const config = getServiceTitanConfig();
  if (!config) throw new ServiceTitanNotConfiguredError();
  return config;
}

export async function stRequest<T>(
  config: ServiceTitanConfig,
  method: Method,
  path: string,
  options: { params?: Record<string, unknown>; data?: unknown } = {},
): Promise<T> {
  const token = await getAccessToken(config);
  const response = await axios.request<T>({
    method,
    url: `${config.apiBaseUrl}${path}`,
    params: options.params,
    data: options.data,
    headers: {
      Authorization: `Bearer ${token}`,
      "ST-App-Key": config.appKey,
    },
  });
  return response.data;
}
