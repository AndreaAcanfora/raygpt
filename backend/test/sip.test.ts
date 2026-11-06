import { describe, expect, it } from "vitest";
import { callerNumber, maskNumber } from "../src/sip.js";
import { verifyWebhook } from "../src/webhook.js";
import { fakeFetch, incomingCall, jsonResponse, makeApp, signWebhook, testConfig, WEBHOOK_SECRET } from "./helpers.js";

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;
const ANDREA = '"Andrea" <sip:+393331234567@pstn.example.com>;tag=abc123';
const STRANGER = "<sip:+390699999999@pstn.example.com>;tag=xyz";

function deliver(app: ReturnType<typeof makeApp>["app"], body: string, id = "wh_1", timestamp = NOW_S) {
  return app.request("/sip/webhook", { method: "POST", headers: signWebhook(body, id, timestamp), body });
}

describe("callerNumber", () => {
  it.each([
    [ANDREA, "+393331234567"],
    ["<sip:+39 333 123 4567@pstn.example.com>", "+393331234567"],
    ["<tel:+393331234567>", "+393331234567"],
    ["sip:00393331234567@pstn.example.com;tag=1", "+393331234567"],
    ["<sip:%2B393331234567@pstn.example.com>", "+393331234567"],
    ['"Anonymous" <sip:anonymous@anonymous.invalid>', undefined],
    ["<sip:3331234567@pstn.example.com>", undefined],
  ])("parses %s", (from, expected) => {
    expect(callerNumber([{ name: "From", value: from }])).toBe(expected);
  });

  it("matches the header name case-insensitively and handles missing headers", () => {
    expect(callerNumber([{ name: "from", value: ANDREA }])).toBe("+393331234567");
    expect(callerNumber([])).toBeUndefined();
    expect(callerNumber(undefined)).toBeUndefined();
  });

  it("masks numbers for logs", () => {
    expect(maskNumber("+393331234567")).toBe("+39******4567");
    expect(maskNumber(undefined)).toBe("unknown");
  });
});

describe("verifyWebhook", () => {
  const body = incomingCall(ANDREA);
  const headersOf = (headers: Headers) => ({
    id: headers.get("webhook-id") ?? undefined,
    timestamp: headers.get("webhook-timestamp") ?? undefined,
    signature: headers.get("webhook-signature") ?? undefined,
  });

  it("accepts a valid signature", () => {
    expect(verifyWebhook(WEBHOOK_SECRET, headersOf(signWebhook(body, "wh_1", NOW_S)), body, NOW_S)).toEqual({ ok: true });
  });

  it("accepts a valid signature among several entries", () => {
    const headers = headersOf(signWebhook(body, "wh_1", NOW_S));
    headers.signature = `v1,b2xkLXNpZ25hdHVyZQ== ${headers.signature}`;
    expect(verifyWebhook(WEBHOOK_SECRET, headers, body, NOW_S)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const headers = headersOf(signWebhook(body, "wh_1", NOW_S));
    expect(verifyWebhook(WEBHOOK_SECRET, headers, body.replace("+39333", "+39066"), NOW_S))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature made with another secret", () => {
    const other = `whsec_${Buffer.from("another-key").toString("base64")}`;
    const headers = headersOf(signWebhook(body, "wh_1", NOW_S, other));
    expect(verifyWebhook(WEBHOOK_SECRET, headers, body, NOW_S)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects old or future timestamps", () => {
    for (const timestamp of [NOW_S - 301, NOW_S + 301]) {
      const headers = headersOf(signWebhook(body, "wh_1", timestamp));
      expect(verifyWebhook(WEBHOOK_SECRET, headers, body, NOW_S)).toEqual({ ok: false, reason: "bad_timestamp" });
    }
  });

  it("rejects missing headers", () => {
    expect(verifyWebhook(WEBHOOK_SECRET, { id: "wh_1", timestamp: undefined, signature: undefined }, body, NOW_S))
      .toEqual({ ok: false, reason: "missing_headers" });
  });
});

describe("POST /sip/webhook", () => {
  it("accepts a call from an allowed number with the RayGPT session", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({}));
    const { app, logs } = makeApp({ fetch: fetchImpl, now: () => NOW_MS });

    const response = await deliver(app, incomingCall(ANDREA));

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openai.test/v1/live/sessions/live_sip_1/accept");
    expect(calls[0]!.body).toMatchObject({
      session: { model: "gpt-live-1", audio: { output: { voice: "marin" } } },
    });
    expect(JSON.stringify(logs)).not.toContain("+393331234567");
  });

  it("declines calls from other numbers", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({}));
    const { app } = makeApp({ fetch: fetchImpl, now: () => NOW_MS });

    await deliver(app, incomingCall(STRANGER));

    expect(calls[0]!.url).toBe("https://openai.test/v1/live/sessions/live_sip_1/reject");
    expect(calls[0]!.body).toEqual({ status_code: 603 });
  });

  it("declines every call when the allowlist is empty", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({}));
    const { app } = makeApp({ config: testConfig({ SIP_CALLER_ALLOWLIST: "" }), fetch: fetchImpl, now: () => NOW_MS });

    await deliver(app, incomingCall(ANDREA));

    expect(calls[0]!.url).toMatch(/\/reject$/);
  });

  it("answers busy when the daily session limit is reached", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({}), jsonResponse({}));
    const { app } = makeApp({ config: testConfig({ MAX_SESSIONS_PER_DAY: "1" }), fetch: fetchImpl, now: () => NOW_MS });

    await deliver(app, incomingCall(ANDREA, "live_a"), "wh_a");
    await deliver(app, incomingCall(ANDREA, "live_b"), "wh_b");

    expect(calls[1]!.url).toMatch(/live_b\/reject$/);
    expect(calls[1]!.body).toEqual({ status_code: 486 });
  });

  it("rejects unsigned deliveries without calling OpenAI", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const { app } = makeApp({ fetch: fetchImpl, now: () => NOW_MS });

    const response = await app.request("/sip/webhook", { method: "POST", body: incomingCall(ANDREA) });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("ignores duplicate deliveries", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({}));
    const { app } = makeApp({ fetch: fetchImpl, now: () => NOW_MS });

    await deliver(app, incomingCall(ANDREA));
    const second = await deliver(app, incomingCall(ANDREA));

    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(calls).toHaveLength(1);
  });

  it("lets OpenAI retry when accepting fails", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({ error: { message: "boom" } }, 500), jsonResponse({}));
    const { app } = makeApp({ fetch: fetchImpl, now: () => NOW_MS });

    expect((await deliver(app, incomingCall(ANDREA))).status).toBe(502);
    expect((await deliver(app, incomingCall(ANDREA))).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("ignores other event types", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const { app } = makeApp({ fetch: fetchImpl, now: () => NOW_MS });

    const response = await deliver(app, JSON.stringify({ type: "response.completed", data: {} }));

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(calls).toHaveLength(0);
  });

  it("is disabled without a webhook secret", async () => {
    const config = testConfig({ OPENAI_WEBHOOK_SECRET: "" });
    const { app } = makeApp({ config, now: () => NOW_MS });

    expect((await deliver(app, incomingCall(ANDREA))).status).toBe(404);
  });
});
