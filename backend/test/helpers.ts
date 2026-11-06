import { createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";

export const APP_TOKEN = "test-token-0123456789abcdef0123456789";
export const WEBHOOK_SECRET = `whsec_${Buffer.from("super-secret-webhook-key").toString("base64")}`;
export const OFFER_SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n";

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    OPENAI_API_KEY: "sk-test",
    APP_TOKEN,
    OPENAI_BASE_URL: "https://openai.test",
    OPENAI_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SIP_CALLER_ALLOWLIST: "+393331234567",
    ...overrides,
  });
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** Fake fetch that records requests and answers with the queued responses in order. */
export function fakeFetch(...responses: Array<Response | Error>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function makeApp(options: { config?: Config; fetch?: typeof fetch; now?: () => number } = {}) {
  const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const app = createApp({
    config: options.config ?? testConfig(),
    fetch: options.fetch,
    now: options.now,
    log: (event, fields) => logs.push({ event, fields }),
  });
  return { app, logs };
}

export function signWebhook(rawBody: string, id: string, timestamp: number, secret = WEBHOOK_SECRET): Headers {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return new Headers({
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  });
}

export function incomingCall(from: string, sessionId = "live_sip_1") {
  return JSON.stringify({
    object: "event",
    id: "evt_1",
    type: "live.transport.incoming",
    data: {
      type: "sip",
      session_id: sessionId,
      sip_headers: [
        { name: "From", value: from },
        { name: "To", value: "<sip:+390212345678@sip.example.com>" },
      ],
    },
  });
}
