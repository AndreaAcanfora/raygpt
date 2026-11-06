import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const base = { OPENAI_API_KEY: "sk-test", APP_TOKEN: "x".repeat(32) };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(base);

    expect(config).toMatchObject({
      model: "gpt-live-1",
      defaultVoice: "marin",
      openaiBaseUrl: "https://api.openai.com",
      sipCallerAllowlist: [],
      maxSessionsPerDay: 50,
      port: 8787,
    });
    expect(config.webhookSecret).toBeUndefined();
    expect(config.instructions).toContain("RayGPT");
  });

  it.each([
    [{ OPENAI_API_KEY: "" }, /OPENAI_API_KEY/],
    [{ APP_TOKEN: "short" }, /at least 32/],
    [{ OPENAI_VOICE: "robot" }, /not a known GPT-Live voice/],
    [{ SIP_CALLER_ALLOWLIST: "3331234567" }, /E\.164/],
    [{ MAX_SESSIONS_PER_DAY: "0" }, /positive integer/],
  ])("rejects invalid settings %#", (overrides, message) => {
    expect(() => loadConfig({ ...base, ...overrides })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ...overrides })).toThrow(message);
  });

  it("parses the SIP allowlist", () => {
    expect(loadConfig({ ...base, SIP_CALLER_ALLOWLIST: "+393331234567, +41791234567" }).sipCallerAllowlist)
      .toEqual(["+393331234567", "+41791234567"]);
  });
});

describe("universal link", () => {
  it("validates APPLE_TEAM_ID", () => {
    expect(loadConfig({ ...base, APPLE_TEAM_ID: "ABCDE12345" }).appleTeamId).toBe("ABCDE12345");
    expect(() => loadConfig({ ...base, APPLE_TEAM_ID: "abc" })).toThrow(/APPLE_TEAM_ID/);
  });
});
