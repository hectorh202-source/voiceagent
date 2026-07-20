import axios from "axios";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

// Turns a URL or an uploaded file into plain text for the knowledge base.
// Extraction happens once, at add-time, and the result is shown to the operator
// to review and edit before it's stored — which is what keeps this from needing
// to be perfect (page nav, boilerplate and odd PDF layout can be cleaned by
// hand rather than by heuristics).

export class UnsupportedFileTypeError extends Error {}
export class ExtractionFailedError extends Error {}

// A very large document would produce hundreds of chunks and bloat every
// ElevenLabs push. Cap it and tell the caller, rather than silently storing a
// book — the operator can split it into focused documents instead.
const MAX_CHARS = 150_000;

export interface ExtractedContent {
  title: string;
  content: string;
  sourceRef: string;
  truncated: boolean;
}

function clamp(text: string): { content: string; truncated: boolean } {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= MAX_CHARS) return { content: clean, truncated: false };
  return { content: clean.slice(0, MAX_CHARS), truncated: true };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', trade: "™", reg: "®", copy: "©",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// Deliberately in-house rather than another dependency: with the operator
// reviewing the result, "good enough structure" beats a heavyweight readability
// parser. Block-level tags become newlines so paragraphs survive for chunking.
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const rawTitle = titleMatch?.[1] ?? h1Match?.[1] ?? "";

  const text = html
    // Drop anything that isn't page copy, content and all.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Block boundaries become line breaks so paragraph structure survives.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ");

  return {
    title: decodeEntities(rawTitle).replace(/\s+/g, " ").trim(),
    text: decodeEntities(text),
  };
}

export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  let html: string;
  try {
    const res = await axios.get<string>(url, {
      timeout: 20_000,
      maxRedirects: 5,
      responseType: "text",
      // Some sites serve a stripped page (or block outright) without a
      // browser-ish UA.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBaseBot/1.0)", Accept: "text/html,*/*" },
      validateStatus: () => true,
      transformResponse: [(d) => d],
    });
    if (res.status >= 400) throw new ExtractionFailedError(`The page returned HTTP ${res.status}.`);
    html = typeof res.data === "string" ? res.data : String(res.data);
  } catch (error) {
    if (error instanceof ExtractionFailedError) throw error;
    throw new ExtractionFailedError(
      `Couldn't fetch that URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const { title, text } = htmlToText(html);
  const { content, truncated } = clamp(text);
  if (!content) throw new ExtractionFailedError("No readable text was found at that URL.");

  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // keep the raw string for display
  }
  return { title: title || host, content, sourceRef: url, truncated };
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export async function extractFromFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ExtractedContent> {
  const ext = extensionOf(filename);
  const titleFromName = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;

  let raw: string;
  try {
    if (ext === "pdf" || mimeType === "application/pdf") {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        raw = (await parser.getText()).text ?? "";
      } finally {
        await parser.destroy();
      }
    } else if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      raw = (await mammoth.extractRawText({ buffer })).value ?? "";
    } else if (["txt", "md", "markdown", "csv"].includes(ext) || mimeType.startsWith("text/")) {
      raw = buffer.toString("utf8");
    } else {
      throw new UnsupportedFileTypeError(
        `Can't read .${ext || "unknown"} files. Supported: PDF, DOCX, TXT, MD, CSV.`,
      );
    }
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError) throw error;
    throw new ExtractionFailedError(
      `Couldn't read that file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const { content, truncated } = clamp(raw);
  if (!content) {
    throw new ExtractionFailedError(
      "No text could be extracted. If this is a scanned PDF, it holds images rather than text and would need OCR.",
    );
  }
  return { title: titleFromName, content, sourceRef: filename, truncated };
}
