import axios from "axios";
import { requireElevenLabsConfig, elRequest } from "./httpClient";

const API_BASE_URL = "https://api.elevenlabs.io";

export type KnowledgeBaseDocumentType = "file" | "url" | "text" | "folder";

export interface KnowledgeBaseDocumentSummary {
  id: string;
  name: string;
  type: KnowledgeBaseDocumentType;
  createdAtUnixSecs: number | null;
  updatedAtUnixSecs: number | null;
  sizeBytes: number | null;
}

// Field names below follow ElevenLabs' documented Knowledge Base API
// (https://elevenlabs.io/docs/api-reference/knowledge-base/list) but the
// exact metadata key names haven't been confirmed against a real response
// yet — every field is read defensively (optional chaining, no assumed
// shape) so an unexpected/renamed field degrades to null rather than
// throwing and losing the whole list. Adjust the raw-field names here once
// a real account confirms them, same "known gaps" precedent used
// elsewhere in this codebase (e.g. postCall.ts's extractDurationSecs).
interface RawDocument {
  id: string;
  name: string;
  type: KnowledgeBaseDocumentType;
  metadata?: {
    created_at_unix_secs?: number;
    last_updated_at_unix_secs?: number;
    size_bytes?: number;
  };
}

function toSummary(doc: RawDocument): KnowledgeBaseDocumentSummary {
  return {
    id: doc.id,
    name: doc.name,
    type: doc.type,
    createdAtUnixSecs: doc.metadata?.created_at_unix_secs ?? null,
    updatedAtUnixSecs: doc.metadata?.last_updated_at_unix_secs ?? null,
    sizeBytes: doc.metadata?.size_bytes ?? null,
  };
}

interface ListResponse {
  documents: RawDocument[];
  has_more: boolean;
  next_cursor?: string | null;
}

export async function listKnowledgeBaseDocuments(
  businessId: number,
  options: { search?: string; cursor?: string } = {},
): Promise<{ documents: KnowledgeBaseDocumentSummary[]; hasMore: boolean; nextCursor: string | null }> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<ListResponse>(config, "GET", "/v1/convai/knowledge-base", {
    params: { page_size: 30, search: options.search || undefined, cursor: options.cursor || undefined },
  });
  return {
    documents: response.documents.map(toSummary),
    hasMore: response.has_more,
    nextCursor: response.next_cursor ?? null,
  };
}

interface DependentAgent {
  type: "available" | "unknown";
  id?: string;
  name?: string;
}

interface DependentAgentsResponse {
  agents: DependentAgent[];
  has_more: boolean;
}

export async function getDependentAgents(businessId: number, documentId: string): Promise<DependentAgent[]> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<DependentAgentsResponse>(
    config,
    "GET",
    `/v1/convai/knowledge-base/${documentId}/dependent-agents`,
  );
  return response.agents ?? [];
}

export async function createTextDocument(businessId: number, params: { text: string; name?: string }): Promise<KnowledgeBaseDocumentSummary> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<RawDocument>(config, "POST", "/v1/convai/knowledge-base/text", {
    data: { text: params.text, name: params.name || undefined },
  });
  return toSummary(response);
}

export async function createUrlDocument(
  businessId: number,
  params: { url: string; name?: string },
): Promise<KnowledgeBaseDocumentSummary> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<RawDocument>(config, "POST", "/v1/convai/knowledge-base/url", {
    data: { url: params.url, name: params.name || undefined },
  });
  return toSummary(response);
}

// POST /v1/convai/knowledge-base/file — multipart upload. Confirmed against
// a real account: the field name is "file", "name" is accepted alongside
// it, and ElevenLabs validates the part's Content-Type against an allowlist
// (application/pdf, .docx, .epub, text/plain, text/html, text/markdown) —
// an empty/missing Content-Type is rejected even for an otherwise-allowed
// extension like .txt, so the real upload MIME type (from multer's
// req.file.mimetype, which reflects what the browser's File object
// reported) must be passed through explicitly rather than left for Blob's
// default (empty string).
// Bypasses elRequest (built for JSON/arraybuffer, not multipart) — native
// FormData/Blob (global in Node 18+) let axios set the multipart
// Content-Type + boundary automatically, same reasoning as every other
// integration in this codebase preferring plain axios over an SDK.
export async function createFileDocument(
  businessId: number,
  params: { buffer: Buffer; filename: string; mimeType: string; name?: string },
): Promise<KnowledgeBaseDocumentSummary> {
  const config = requireElevenLabsConfig(businessId);
  const formData = new FormData();
  formData.append("file", new Blob([params.buffer], { type: params.mimeType }), params.filename);
  if (params.name) formData.append("name", params.name);
  const response = await axios.post<RawDocument>(`${API_BASE_URL}/v1/convai/knowledge-base/file`, formData, {
    headers: { "xi-api-key": config.apiKey },
  });
  return toSummary(response.data);
}

export async function deleteKnowledgeBaseDocument(businessId: number, documentId: string, force = false): Promise<void> {
  const config = requireElevenLabsConfig(businessId);
  await elRequest(config, "DELETE", `/v1/convai/knowledge-base/${documentId}`, {
    params: { force: force || undefined },
  });
}

interface AgentKnowledgeBaseEntry {
  type: KnowledgeBaseDocumentType;
  name: string;
  id: string;
  usage_mode?: string;
}

interface AgentConfigResponse {
  conversation_config?: {
    agent?: {
      prompt?: {
        knowledge_base?: AgentKnowledgeBaseEntry[];
      };
    };
  };
}

export async function getAgentKnowledgeBase(businessId: number): Promise<AgentKnowledgeBaseEntry[]> {
  const config = requireElevenLabsConfig(businessId);
  const response = await elRequest<AgentConfigResponse>(config, "GET", `/v1/convai/agents/${config.agentId}`);
  return response.conversation_config?.agent?.prompt?.knowledge_base ?? [];
}

// Read-modify-write the agent's own knowledge_base array, then PATCH only
// that field back — mirrors agents.ts's updateAgentVoiceConfig, which
// confirmed PATCH deep-merges conversation_config for .tts specifically.
// The array-vs-object merge behavior for .agent.prompt.knowledge_base
// hasn't been separately re-confirmed yet (arrays sometimes replace
// wholesale even in APIs that otherwise deep-merge objects) — verify
// against a real agent before relying on this in production.
async function setAgentKnowledgeBase(businessId: number, entries: AgentKnowledgeBaseEntry[]): Promise<void> {
  const config = requireElevenLabsConfig(businessId);
  await elRequest(config, "PATCH", `/v1/convai/agents/${config.agentId}`, {
    data: {
      conversation_config: {
        agent: {
          prompt: {
            knowledge_base: entries,
          },
        },
      },
    },
  });
}

export async function attachDocumentToAgent(businessId: number, doc: KnowledgeBaseDocumentSummary): Promise<void> {
  const current = await getAgentKnowledgeBase(businessId);
  if (current.some((entry) => entry.id === doc.id)) return; // already attached
  await setAgentKnowledgeBase(businessId, [...current, { type: doc.type, name: doc.name, id: doc.id }]);
}

export async function detachDocumentFromAgent(businessId: number, documentId: string): Promise<void> {
  const current = await getAgentKnowledgeBase(businessId);
  await setAgentKnowledgeBase(
    businessId,
    current.filter((entry) => entry.id !== documentId),
  );
}
