import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config.js";
import { VPS_HINT, WEB_SEARCH_HINT } from "../src/instructions.js";
import { buildSessionConfig } from "../src/openai.js";
import { testConfig } from "./helpers.js";

const TOKEN = "vps-token-0123456789abcdef0123456789abcdef";
const VPS = {
  OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra",
  VPS_MCP_URL: "https://vps.example.com/mcp",
  VPS_MCP_TOKEN: TOKEN,
};

describe("VPS tool (MCP via delegation)", () => {
  it("adds the VPS MCP server next to web search, with its bearer token", () => {
    const config = testConfig(VPS);
    const session = buildSessionConfig(config, { voice: "marin" }) as {
      instructions: string;
      delegation: { responses: { tools: unknown[]; instructions: string } };
    };

    expect(session.delegation.responses.tools).toEqual([
      { type: "web_search" },
      expect.objectContaining({
        type: "mcp",
        server_label: "vps",
        server_url: VPS.VPS_MCP_URL,
        headers: { Authorization: `Bearer ${TOKEN}` },
        require_approval: "never",
      }),
    ]);
    expect(session.delegation.responses.instructions).toContain("vps_task");
    expect(session.instructions).toBe(`${config.instructions}\n${WEB_SEARCH_HINT}\n${VPS_HINT}`);
  });

  it("is absent unless configured", () => {
    const session = buildSessionConfig(testConfig({ OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra" }), { voice: "marin" }) as {
      delegation: { responses: { tools: unknown[] } };
    };
    expect(session.delegation.responses.tools).toEqual([{ type: "web_search" }]);
  });

  it("WEB_SEARCH_VIA=vps drops OpenAI's web_search and sends searches to the VPS", () => {
    const session = buildSessionConfig(testConfig({ ...VPS, WEB_SEARCH_VIA: "vps" }), { voice: "marin" }) as {
      delegation: { responses: { tools: Array<{ type: string }>; instructions: string } };
    };
    expect(session.delegation.responses.tools.map((t) => t.type)).toEqual(["mcp"]);
    expect(session.delegation.responses.instructions).toContain("search the web");
    expect(session.delegation.responses.instructions).toContain("weather tool");
    expect(session.delegation.responses.instructions).toContain("vps_task");
  });

  it("rejects half or unsafe configurations", () => {
    expect(() => testConfig({ ...VPS, VPS_MCP_TOKEN: "" })).toThrow(ConfigError);
    expect(() => testConfig({ ...VPS, VPS_MCP_URL: "http://plain.example/mcp" })).toThrow(/https/);
    expect(() => testConfig({ ...VPS, VPS_MCP_TOKEN: "short" })).toThrow(/32/);
    expect(() => testConfig({ ...VPS, OPENAI_WEB_SEARCH_MODEL: "" })).toThrow(/OPENAI_WEB_SEARCH_MODEL/);
    expect(() => testConfig({ WEB_SEARCH_VIA: "vps" })).toThrow(/VPS_MCP_URL/);
    expect(() => testConfig({ WEB_SEARCH_VIA: "google" })).toThrow(/openai/);
  });
});
