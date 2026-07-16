import crypto from "node:crypto";

// Twilio's own request-validation algorithm (https://www.twilio.com/docs/usage/security#validating-requests):
// take the full URL Twilio was configured to call, append every POST
// param's key immediately followed by its value — sorted by key, no
// separator between pairs — then HMAC-SHA1 the result with the account's
// Auth Token and base64-encode. Distinct from ElevenLabs' HMAC-SHA256
// timestamp-based scheme in webhooks/signature.ts: no timestamp/replay
// window here, since that's simply not part of Twilio's scheme.
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  sigHeader: string | undefined,
  authToken: string,
): boolean {
  if (!sigHeader) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");

  const providedBuf = Buffer.from(sigHeader);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
