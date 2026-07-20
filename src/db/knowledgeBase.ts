import { db } from "./index";

// The shared knowledge base: this app owns the canonical text, the voice agent
// reads a copy pushed into ElevenLabs, and the chat widget retrieves from the
// FTS5-indexed chunks here. See schema.ts for why this content is deliberately
// stored unencrypted, unlike the rest of the database.

export type KnowledgeSourceType = "text" | "url" | "file";

export interface KnowledgeDocument {
  id: number;
  business_id: number;
  title: string;
  source_type: string;
  source_ref: string | null;
  content: string;
  elevenlabs_document_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunkHit {
  documentId: number;
  title: string;
  chunkIndex: number;
  content: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

// Carries the tail of the previous chunk into the next so a fact spanning a
// boundary is still retrievable from at least one chunk. Trimmed to a word
// boundary so the overlap never starts mid-word.
function overlapTail(chunk: string): string {
  if (chunk.length <= CHUNK_OVERLAP) return `${chunk}\n\n`;
  const tail = chunk.slice(-CHUNK_OVERLAP);
  const space = tail.indexOf(" ");
  const clean = (space === -1 ? tail : tail.slice(space + 1)).trim();
  return clean ? `${clean}\n\n` : "";
}

// Splits on paragraph boundaries first (so a chunk rarely cuts mid-thought),
// packing paragraphs up to CHUNK_SIZE. A single paragraph longer than that is
// hard-split on word boundaries as a fallback.
export function chunkText(raw: string): string[] {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return [];

  const pieces: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (paragraph.length <= CHUNK_SIZE) {
      pieces.push(paragraph);
      continue;
    }
    let rest = paragraph;
    while (rest.length > CHUNK_SIZE) {
      let cut = rest.lastIndexOf(" ", CHUNK_SIZE);
      // A "word" longer than half a chunk isn't prose (a URL, a token dump) —
      // cut it bluntly rather than emitting a near-empty chunk.
      if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > CHUNK_SIZE) {
      chunks.push(current.trim());
      current = overlapTail(current) + piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const listDocsStmt = db.prepare(
  `SELECT * FROM knowledge_documents WHERE business_id = ? ORDER BY updated_at DESC, id DESC`,
);
const getDocStmt = db.prepare(`SELECT * FROM knowledge_documents WHERE id = ? AND business_id = ?`);
const insertDocStmt = db.prepare(`
  INSERT INTO knowledge_documents (business_id, title, source_type, source_ref, content)
  VALUES (@businessId, @title, @sourceType, @sourceRef, @content)
`);
const updateDocStmt = db.prepare(`
  UPDATE knowledge_documents
  SET title = @title, content = @content, updated_at = datetime('now')
  WHERE id = @id AND business_id = @businessId
`);
const deleteDocStmt = db.prepare(`DELETE FROM knowledge_documents WHERE id = ? AND business_id = ?`);
const setElIdStmt = db.prepare(`
  UPDATE knowledge_documents
  SET elevenlabs_document_id = @elevenlabsDocumentId, synced_at = @syncedAt
  WHERE id = @id AND business_id = @businessId
`);

const deleteChunksStmt = db.prepare(`DELETE FROM knowledge_chunks WHERE document_id = ?`);
const insertChunkStmt = db.prepare(`
  INSERT INTO knowledge_chunks (document_id, business_id, chunk_index, content)
  VALUES (@documentId, @businessId, @chunkIndex, @content)
`);
const countChunksStmt = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_chunks WHERE document_id = ?`);

export function listKnowledgeDocuments(businessId: number): KnowledgeDocument[] {
  return listDocsStmt.all(businessId) as unknown as KnowledgeDocument[];
}

export function getKnowledgeDocument(businessId: number, id: number): KnowledgeDocument | undefined {
  return getDocStmt.get(id, businessId) as unknown as KnowledgeDocument | undefined;
}

export function countDocumentChunks(documentId: number): number {
  return (countChunksStmt.get(documentId) as { count: number }).count;
}

// Deletes and reinserts every chunk for a document. Wholesale replacement (not
// a diff) keeps the FTS index correct via the delete/insert triggers with no
// UPDATE trigger to maintain, and a document is small enough that rewriting
// its chunks costs nothing.
function replaceDocumentChunks(documentId: number, businessId: number, content: string): void {
  deleteChunksStmt.run(documentId);
  chunkText(content).forEach((chunk, index) => {
    insertChunkStmt.run({ documentId, businessId, chunkIndex: index, content: chunk });
  });
}

export interface CreateKnowledgeDocumentInput {
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef?: string | null;
  content: string;
}

// Document row + its chunks are written together — a document whose chunks
// failed to write would be invisible to every search while still looking
// present in the UI.
export function createKnowledgeDocument(businessId: number, input: CreateKnowledgeDocumentInput): number {
  db.exec("BEGIN");
  try {
    const info = insertDocStmt.run({
      businessId,
      title: input.title,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      content: input.content,
    }) as { lastInsertRowid: number | bigint };
    const id = Number(info.lastInsertRowid);
    replaceDocumentChunks(id, businessId, input.content);
    db.exec("COMMIT");
    return id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateKnowledgeDocument(
  businessId: number,
  id: number,
  input: { title: string; content: string },
): void {
  db.exec("BEGIN");
  try {
    updateDocStmt.run({ id, businessId, title: input.title, content: input.content });
    replaceDocumentChunks(id, businessId, input.content);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteKnowledgeDocument(businessId: number, id: number): void {
  db.exec("BEGIN");
  try {
    // Chunks first — node:sqlite enforces foreign keys, so deleting the parent
    // with children still present throws (the same shape of bug already hit
    // once by deleteUser/user_businesses).
    deleteChunksStmt.run(id);
    deleteDocStmt.run(id, businessId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setKnowledgeDocumentElevenLabsId(
  businessId: number,
  id: number,
  elevenlabsDocumentId: string | null,
): void {
  setElIdStmt.run({
    id,
    businessId,
    elevenlabsDocumentId,
    syncedAt: elevenlabsDocumentId ? new Date().toISOString() : null,
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// Very common words carry no signal and, in a small corpus, can outrank the
// terms that matter. BM25 downweights frequent terms but only relative to this
// corpus, which may be a handful of documents.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from", "has", "have",
  "how", "i", "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "was", "we", "were", "what", "when", "where", "which",
  "who", "will", "with", "you", "your",
]);

function queryTerms(raw: string): string[] {
  return [
    ...new Set(
      raw
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .map((t) => t.replace(/'/g, ""))
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
    ),
  ];
}

// Turns free text into a safe FTS5 query. Every term is quoted so FTS5 can
// never interpret user input as its own operators (a bare `AND`, `*`, `"` or
// `:` would otherwise be a syntax error, not a search), and terms are OR'd so
// recall stays high with bm25() doing the ranking.
export function buildFtsQuery(raw: string): string | null {
  const terms = queryTerms(raw);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(" OR ");
}

// What fraction of the query's terms actually appear in this chunk. Compared on
// a truncated stem so plural/tense variants still count ("saturdays" matches
// "Saturday"), mirroring what the porter tokenizer does inside FTS.
function termCoverage(chunk: string, terms: string[]): number {
  const hay = chunk.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t.length > 5 ? t.slice(0, Math.max(5, t.length - 2)) : t)).length;
  return hits / terms.length;
}

// OR'd terms give good recall but poor precision on their own: "do you install
// solar panels" matches a document that merely says "we install tankless
// units", which is a junk hit that would mislead the assistant into thinking
// the knowledge base covers solar. bm25() can't be thresholded to fix it —
// with only a handful of documents, IDF collapses and every score sits near
// zero. Requiring half the query's terms to actually appear is a blunt but
// effective filter, and it's tuned to keep real matches: "are you open
// saturdays" (1 of 2) passes, "install solar panels" (1 of 3) doesn't.
// Single-term queries are always kept — there's nothing to corroborate.
const MIN_TERM_COVERAGE = 0.5;

const searchStmt = db.prepare(`
  SELECT c.document_id AS documentId, d.title AS title, c.chunk_index AS chunkIndex,
         c.content AS content, bm25(knowledge_chunks_fts) AS score
  FROM knowledge_chunks_fts
  JOIN knowledge_chunks c ON c.id = knowledge_chunks_fts.rowid
  JOIN knowledge_documents d ON d.id = c.document_id
  WHERE knowledge_chunks_fts MATCH @query AND c.business_id = @businessId
  ORDER BY score
  LIMIT @limit
`);

// bm25() returns a negative score where more negative is a better match, hence
// the plain ascending ORDER BY. Always business-scoped: one tenant's search can
// never surface another tenant's chunks.
export function searchKnowledge(businessId: number, query: string, limit = 5): KnowledgeChunkHit[] {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];
  const terms = queryTerms(query);
  try {
    // Over-fetch, then drop weak matches — filtering after the LIMIT would
    // return fewer results than asked for whenever anything is filtered.
    const rows = searchStmt.all({
      businessId,
      query: ftsQuery,
      limit: limit * 4,
    }) as unknown as KnowledgeChunkHit[];
    const filtered =
      terms.length < 2 ? rows : rows.filter((r) => termCoverage(r.content, terms) >= MIN_TERM_COVERAGE);
    return filtered.slice(0, limit);
  } catch (error) {
    // A malformed query should degrade to "no results", never break the chat.
    console.error("searchKnowledge failed:", error instanceof Error ? error.message : error);
    return [];
  }
}
