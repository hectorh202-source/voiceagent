import crypto from "node:crypto";

// Matches ElevenLabs' own webhook-verification algorithm exactly (confirmed
// by reading their official SDK source, since their prose docs don't spell
// out the signed-string format): header is "t=<unix_seconds>,v0=<hex hmac>",
// hmac is over "<timestamp>.<rawBody>", with a 30-minute replay tolerance.
const TOLERANCE_MS = 30 * 60 * 1000;

export function verifyElevenLabsSignature(rawBody: string, sigHeader: string | undefined, secret: string): boolean {
  if (!sigHeader) return false;

  const parts = sigHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v0="));
  if (!timestampPart || !signaturePart) return false;

  const timestamp = timestampPart.slice(2);
  const requestTimeMs = Number(timestamp) * 1000;
  if (!Number.isFinite(requestTimeMs) || requestTimeMs < Date.now() - TOLERANCE_MS) {
    return false;
  }

  const message = `${timestamp}.${rawBody}`;
  const expectedSignature = "v0=" + crypto.createHmac("sha256", secret).update(message).digest("hex");

  const providedBuf = Buffer.from(signaturePart);
  const expectedBuf = Buffer.from(expectedSignature);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
