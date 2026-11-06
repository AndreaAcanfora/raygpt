export interface SipHeader {
  name: string;
  value: string;
}

/**
 * Returns the caller's number in E.164 form from the SIP `From` header, e.g.
 * `"Andrea" <sip:+393331234567@pstn.example.com>;tag=abc` → `+393331234567`.
 * Returns undefined when the header is missing or the number is anonymous or malformed.
 */
export function callerNumber(headers: SipHeader[] | undefined): string | undefined {
  const from = headers?.find((header) => header.name.toLowerCase() === "from")?.value;
  if (!from) return undefined;

  const uri = from.match(/<([^>]+)>/)?.[1] ?? from.split(";")[0]!;
  const user = uri.match(/^(?:sips?|tel):([^@;]+)/i)?.[1];
  if (!user) return undefined;

  const digits = decodeURIComponent(user).replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  if (/^00[1-9]\d{6,14}$/.test(digits)) return `+${digits.slice(2)}`;
  return undefined;
}

/** Masks a phone number for logs: +393331234567 → +39******4567. */
export function maskNumber(number: string | undefined): string {
  if (!number) return "unknown";
  return `${number.slice(0, 3)}${"*".repeat(Math.max(0, number.length - 7))}${number.slice(-4)}`;
}
