import { describe, expect, it } from "vitest";
import { WEB_SEARCH_HINT } from "../src/instructions.js";
import { buildSessionConfig } from "../src/openai.js";
import { APP_TOKEN, fakeFetch, incomingCall, jsonResponse, makeApp, OFFER_SDP, signWebhook, testConfig } from "./helpers.js";

describe("web search delegation", () => {
  it("is off by default", () => {
    const session = buildSessionConfig(testConfig(), { voice: "marin" });

    expect(session).not.toHaveProperty("delegation");
    expect(session.instructions).not.toContain("search the web");
  });

  it("delegates to a backend model with the web_search tool when configured", () => {
    const config = testConfig({ OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra" });

    const session = buildSessionConfig(config, { voice: "marin" });

    expect(session.delegation).toEqual({
      type: "responses",
      responses: {
        model: "gpt-5.6-terra",
        instructions: expect.stringContaining("web search"),
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        reasoning: { effort: "low" },
      },
    });
    expect(session.instructions).toBe(`${config.instructions}\n${WEB_SEARCH_HINT}`);
  });

  it("is sent when creating WebRTC sessions", async () => {
    const { fetchImpl, calls } = fakeFetch(
      jsonResponse({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "v=0 answer" } }, 201),
    );
    const { app } = makeApp({ config: testConfig({ OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra" }), fetch: fetchImpl });

    await app.request("/api/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${APP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: OFFER_SDP }),
    });

    expect(calls[0]!.body).toMatchObject({ session: { delegation: { type: "responses" } } });
  });

  it("is sent when accepting SIP calls", async () => {
    const now = 1_800_000_000_000;
    const { fetchImpl, calls } = fakeFetch(jsonResponse({}));
    const { app } = makeApp({ config: testConfig({ OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra" }), fetch: fetchImpl, now: () => now });
    const body = incomingCall("sip:+393331234567@sip.example.com");

    await app.request("/sip/webhook", { method: "POST", headers: signWebhook(body, "wh_ws", now / 1000), body });

    expect(calls[0]!.body).toMatchObject({ session: { type: "live", delegation: { type: "responses" } } });
  });
});
