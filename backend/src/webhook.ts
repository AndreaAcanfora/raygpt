import { createHmac, timingSafeEqual } from "node:crypto";

/** Maximum clock skew accepted between OpenAI and this server. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "bad_signature" | "bad_secret" };

/**
 * Verifies an OpenAI webhook following the Standard Webhooks specification:
 * the signature is a base64 HMAC-SHA256 of `${id}.${timestamp}.${rawBody}`, keyed with the
 * base64-decoded part of the `whsec_...` secret, sent as space-separated `v1,<signature>` entries.
 */
export function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): WebhookVerification {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(nowSeconds - sentAt) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "bad_timestamp" };
  }

  const key = decodeSecret(secret);
  if (!key) return { ok: false, reason: "bad_secret" };

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const matches = signature
    .split(" ")
    .map((entry) => entry.split(","))
    .filter(([version, value]) => version === "v1" && value)
    .some(([, value]) => {
      const candidate = Buffer.from(value!, "base64");
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });

  return matches ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function decodeSecret(secret: string): Buffer | undefined {
  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(encoded, "base64");
  return key.length > 0 ? key : undefined;
}
