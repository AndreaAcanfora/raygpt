import { describe, expect, it } from "vitest";
import { buildSessionConfig } from "../src/openai.js";
import { gatewayBase, recentWorkSummary, type VpsTask } from "../src/vps.js";
import { APP_TOKEN, fakeFetch, jsonResponse, makeApp, OFFER_SDP, testConfig } from "./helpers.js";

const VPS = {
  OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra",
  VPS_MCP_URL: "https://vps.example.com/mcp",
  VPS_MCP_TOKEN: "vps-token-0123456789abcdef0123456789abcdef",
};
const NOW = Date.parse("2026-11-08T09:00:00Z");
const auth = { Authorization: `Bearer ${APP_TOKEN}` };

function gatewayTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "9c951639-7758-40ad-876b-cc0f8af62156",
    status: "done",
    instruction: "Controlla su WhatsApp se trovi il contatto di Maria",
    result: "Sì, il contatto c'è.",
    error: null,
    session_id: "d2c2a86d-25b0-4260-8161-436614bc864f",
    created_at: "2026-11-08T08:39:24.562Z",
    finished_at: "2026-11-08T08:40:28.079Z",
    ...overrides,
  };
}

function liveAnswer() {
  return jsonResponse({ session: { id: "sess_1" }, transport: { sdp: "v=0\r\nanswer" } });
}

describe("GET /api/vps/tasks", () => {
  it("returns the gateway's tasks since the given time, without the agent session ids", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({ tasks: [gatewayTask()] }));
    const { app } = makeApp({ config: testConfig(VPS), fetch: fetchImpl });

    const res = await app.request("/api/vps/tasks?since=2026-11-08T08:30:00.000Z", { headers: auth });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tasks: [{
        id: "9c951639-7758-40ad-876b-cc0f8af62156",
        status: "done",
        instruction: "Controlla su WhatsApp se trovi il contatto di Maria",
        result: "Sì, il contatto c'è.",
        createdAt: "2026-11-08T08:39:24.562Z",
        finishedAt: "2026-11-08T08:40:28.079Z",
      }],
    });
    expect(calls[0]!.url).toBe("https://vps.example.com/tasks?since=2026-11-08T08%3A30%3A00.000Z");
    expect(calls[0]!.headers.get("Authorization")).toBe(`Bearer ${VPS.VPS_MCP_TOKEN}`);
  });

  it("reports a failed task's error as its result", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ tasks: [gatewayTask({ status: "failed", result: null, error: "timed out" })] }));
    const { app } = makeApp({ config: testConfig(VPS), fetch: fetchImpl });
    const body = await (await app.request("/api/vps/tasks?since=2026-11-08T08:30:00Z", { headers: auth })).json() as { tasks: VpsTask[] };
    expect(body.tasks[0]).toMatchObject({ status: "failed", result: "timed out" });
  });

  it("needs the app token, a VPS and a valid time", async () => {
    expect((await makeApp({ config: testConfig(VPS) }).app.request("/api/vps/tasks?since=2026-11-08T08:30:00Z")).status).toBe(401);
    expect((await makeApp().app.request("/api/vps/tasks?since=2026-11-08T08:30:00Z", { headers: auth })).status).toBe(404);
    expect((await makeApp({ config: testConfig(VPS) }).app.request("/api/vps/tasks?since=ieri", { headers: auth })).status).toBe(400);
  });

  it("answers 502 when the gateway is down", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ error: "boom" }, 500));
    const { app, logs } = makeApp({ config: testConfig(VPS), fetch: fetchImpl });
    const res = await app.request("/api/vps/tasks?since=2026-11-08T08:30:00Z", { headers: auth });
    expect(res.status).toBe(502);
    expect(logs.map((l) => l.event)).toContain("vps.tasks_failed");
  });
});

describe("POST /api/session/end", () => {
  it("logs why the conversation ended", async () => {
    const { app, logs } = makeApp();
    const res = await app.request("/api/session/end", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess_1", reason: "idle", seconds: 312.4 }),
    });
    expect(res.status).toBe(204);
    expect(logs).toContainEqual({ event: "session.ended", fields: { sessionId: "sess_1", reason: "idle", seconds: 312 } });
  });

  it("rejects missing tokens and odd reasons", async () => {
    const { app } = makeApp();
    const post = (body: unknown, headers: Record<string, string> = auth) => app.request("/api/session/end", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await post({ reason: "idle" }, {})).status).toBe(401);
    expect((await post({ reason: "<script>" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});

describe("recent VPS work in a new conversation", () => {
  it("adds the last day's tasks to both the voice and the backend model instructions", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({ tasks: [gatewayTask()] }), liveAnswer());
    const { app, logs } = makeApp({ config: testConfig(VPS), fetch: fetchImpl, now: () => NOW });

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: OFFER_SDP }),
    });

    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://vps.example.com/tasks?since=2026-11-07T09%3A00%3A00.000Z");
    const session = (calls[1]!.body as { session: { instructions: string; delegation: { responses: { instructions: string } } } }).session;
    expect(session.instructions).toContain("Recent work of the VPS agent");
    expect(session.instructions).toContain("contatto di Maria");
    expect(session.delegation.responses.instructions).toContain("contatto di Maria");
    expect(logs.find((l) => l.event === "session.created")?.fields).toMatchObject({ recentVpsWork: true });
  });

  it("starts the conversation anyway when the gateway does not answer", async () => {
    const { fetchImpl, calls } = fakeFetch(new Error("connect ECONNREFUSED"), liveAnswer());
    const { app } = makeApp({ config: testConfig(VPS), fetch: fetchImpl, now: () => NOW });
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: OFFER_SDP }),
    });
    expect(res.status).toBe(200);
    expect((calls[1]!.body as { session: { instructions: string } }).session.instructions).not.toContain("Recent work");
  });

  it("summarises only finished tasks, newest first, on one line each", () => {
    const tasks: VpsTask[] = [
      { id: "a", status: "running", instruction: "in corso", result: null, createdAt: "2026-11-08T08:50:00Z", finishedAt: null },
      { id: "b", status: "done", instruction: "Crea il repo\ntrapradar", result: "Fatto:\n repo creata", createdAt: "2026-11-08T08:34:30Z", finishedAt: "2026-11-08T08:38:21Z" },
      { id: "c", status: "failed", instruction: "Manda a Mondo", result: "contatto ambiguo", createdAt: "2026-11-07T21:18:40Z", finishedAt: "2026-11-07T21:18:47Z" },
    ];
    const summary = recentWorkSummary(tasks)!;
    expect(summary.split("\n")).toHaveLength(2);
    expect(summary).toContain(`"Crea il repo trapradar" -> Fatto: repo creata`);
    expect(summary).toContain("failed: contatto ambiguo");
    expect(summary).toContain("09:34");
    expect(recentWorkSummary([tasks[0]!])).toBeUndefined();
  });

  it("leaves the instructions alone without recent work", () => {
    const config = testConfig(VPS);
    const session = buildSessionConfig(config, { voice: "marin" }) as { instructions: string };
    expect(session.instructions).not.toContain("Recent work");
  });

  it("finds the REST API next to the MCP endpoint", () => {
    expect(gatewayBase("https://vps.example.com/mcp")).toBe("https://vps.example.com");
    expect(gatewayBase("https://vps.example.com/mcp/")).toBe("https://vps.example.com");
  });
});
