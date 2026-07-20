import {
  createTextDocument,
  deleteKnowledgeBaseDocument,
  attachDocumentToAgent,
  detachDocumentFromAgent,
} from "../elevenlabs/knowledgeBase";
import { ElevenLabsNotConfiguredError } from "../elevenlabs/httpClient";
import { getKnowledgeDocument, setKnowledgeDocumentElevenLabsId } from "../db/knowledgeBase";

// Pushes a knowledge document into ElevenLabs so the voice agent can use it.
// This app owns the text; ElevenLabs holds a downstream copy (see
// docs/chat-widget.md). Because we extract plain text for every source type,
// even a PDF or a URL is pushed here as a plain text document — one sync path
// for all three.

// Best-effort teardown of a previously-pushed document. Each step is
// independently tolerant: a document already deleted on their side (or an
// agent it was never attached to) must not stop us replacing it.
async function removeFromElevenLabs(businessId: number, elevenlabsDocumentId: string): Promise<void> {
  try {
    await detachDocumentFromAgent(businessId, elevenlabsDocumentId);
  } catch {
    // not attached, or the agent is gone — nothing to undo
  }
  try {
    await deleteKnowledgeBaseDocument(businessId, elevenlabsDocumentId, true);
  } catch {
    // already deleted on their side
  }
}

export type VoiceSyncResult = "synced" | "not_configured" | "failed";

// Returns rather than throws, because the local document is the source of
// truth and stays fully usable by the chat widget regardless. A business with
// no ElevenLabs credentials (a chat-only client) is a normal, expected case —
// not an error, and never a reason to block saving a document.
export async function syncDocumentToElevenLabs(businessId: number, documentId: number): Promise<VoiceSyncResult> {
  const doc = getKnowledgeDocument(businessId, documentId);
  if (!doc) return "failed";

  try {
    // Their API has no confirmed in-place update, so an edit is a replace:
    // drop the old document, create a fresh one, re-attach.
    if (doc.elevenlabs_document_id) {
      await removeFromElevenLabs(businessId, doc.elevenlabs_document_id);
    }
    const created = await createTextDocument(businessId, { text: doc.content, name: doc.title });
    await attachDocumentToAgent(businessId, created);
    setKnowledgeDocumentElevenLabsId(businessId, documentId, created.id);
    return "synced";
  } catch (error) {
    if (error instanceof ElevenLabsNotConfiguredError) {
      setKnowledgeDocumentElevenLabsId(businessId, documentId, null);
      return "not_configured";
    }
    console.error("syncDocumentToElevenLabs failed:", error instanceof Error ? error.message : error);
    setKnowledgeDocumentElevenLabsId(businessId, documentId, null);
    return "failed";
  }
}

// Called before deleting the local document. Never throws — a failure to clean
// up their copy shouldn't block the delete the operator asked for.
export async function unsyncDocumentFromElevenLabs(
  businessId: number,
  elevenlabsDocumentId: string | null,
): Promise<void> {
  if (!elevenlabsDocumentId) return;
  try {
    await removeFromElevenLabs(businessId, elevenlabsDocumentId);
  } catch (error) {
    console.error("unsyncDocumentFromElevenLabs failed:", error instanceof Error ? error.message : error);
  }
}
