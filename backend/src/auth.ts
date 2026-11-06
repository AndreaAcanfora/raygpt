import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison that does not leak the length of the expected value. */
export function safeEqual(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}
