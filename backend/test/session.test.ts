import { describe, expect, it } from "vitest";
import { APP_TOKEN, fakeFetch, jsonResponse, makeApp, OFFER_SDP, testConfig } from "./helpers.js";

function postSession(app: ReturnType<typeof makeApp>["app"], body: unknown, token = APP_TOKEN) {
  return app.request("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const created = () => jsonResponse({ session: { id: "live_123" }, transport: { type: "webrtc", sdp: "v=0 answer" } }, 201);

describe("POST /api/session", () => {
  it("forwards the SDP offer to GPT-Live and returns the answer", async () => {
    const { fetchImpl, calls } = fakeFetch(created());
    const { app, logs } = makeApp({ fetch: fetchImpl });

    const response = await postSession(app, { sdp: OFFER_SDP, voice: "cedar" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: "live_123", sdp: "v=0 answer" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openai.test/v1/live/sessions");
    expect(calls[0]!.headers.get("Authorization")).toBe("Bearer sk-test");
    expect(calls[0]!.body).toMatchObject({
      session: { model: "gpt-live-1", audio: { output: { voice: "cedar" } } },
      transport: { type: "webrtc", sdp: OFFER_SDP },
    });
    expect(logs.map((log) => log.event)).toContain("session.created");
  });

  it("uses the default voice when none is given", async () => {
    const { fetchImpl, calls } = fakeFetch(created());
    const { app } = makeApp({ fetch: fetchImpl });

    await postSession(app, { sdp: OFFER_SDP });

    expect(calls[0]!.body).toMatchObject({ session: { audio: { output: { voice: "marin" } } } });
  });

  it("never exposes the OpenAI key to the client", async () => {
    const { fetchImpl } = fakeFetch(created());
    const { app } = makeApp({ fetch: fetchImpl });

    const text = await (await postSession(app, { sdp: OFFER_SDP })).text();

    expect(text).not.toContain("sk-test");
  });

  it.each([
    ["missing", undefined],
    ["wrong", "wrong-token"],
  ])("rejects a %s token", async (_label, token) => {
    const { fetchImpl, calls } = fakeFetch();
    const { app } = makeApp({ fetch: fetchImpl });

    const response = await app.request("/api/session", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ sdp: OFFER_SDP }),
    });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid SDP offer", async () => {
    const { app } = makeApp({ fetch: fakeFetch().fetchImpl });

    expect((await postSession(app, { sdp: "hello" })).status).toBe(400);
    expect((await postSession(app, {})).status).toBe(400);
  });

  it("rejects an unknown voice", async () => {
    const { app } = makeApp({ fetch: fakeFetch().fetchImpl });

    const response = await postSession(app, { sdp: OFFER_SDP, voice: "darth" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_voice" });
  });

  it("enforces the daily session limit", async () => {
    const { fetchImpl, calls } = fakeFetch(created(), created(), created());
    let now = 0;
    const { app } = makeApp({ config: testConfig({ MAX_SESSIONS_PER_DAY: "2" }), fetch: fetchImpl, now: () => now });

    expect((await postSession(app, { sdp: OFFER_SDP })).status).toBe(200);
    expect((await postSession(app, { sdp: OFFER_SDP })).status).toBe(200);
    expect((await postSession(app, { sdp: OFFER_SDP })).status).toBe(429);
    expect(calls).toHaveLength(2);

    now += 24 * 60 * 60 * 1000;
    expect((await postSession(app, { sdp: OFFER_SDP })).status).toBe(200);
  });

  it("reports OpenAI errors as 502 with the OpenAI message", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ error: { message: "Insufficient quota", code: "insufficient_quota" } }, 429));
    const { app } = makeApp({ fetch: fetchImpl });

    const response = await postSession(app, { sdp: OFFER_SDP });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "openai_error", status: 429, code: "insufficient_quota" });
  });

  it("reports network failures as 504", async () => {
    const { fetchImpl } = fakeFetch(new Error("ECONNRESET"));
    const { app } = makeApp({ fetch: fetchImpl });

    expect((await postSession(app, { sdp: OFFER_SDP })).status).toBe(504);
  });

  it("reports a malformed OpenAI response as 502", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ session: {} }, 201));
    const { app } = makeApp({ fetch: fetchImpl });

    expect((await postSession(app, { sdp: OFFER_SDP })).status).toBe(502);
  });
});

describe("public endpoints", () => {
  it("answers the health check", async () => {
    const { app } = makeApp();

    expect(await (await app.request("/health")).json()).toEqual({ ok: true, model: "gpt-live-1" });
  });

  it("lists the voices with the default", async () => {
    const { app } = makeApp();

    const body = await (await app.request("/api/voices")).json() as { voices: string[]; default: string };

    expect(body.default).toBe("marin");
    expect(body.voices).toContain("cedar");
  });
});
