import type { Config } from "./config.js";

/** A task of the VPS agent, as the clients see it (cb-gateway GET /tasks). */
export interface VpsTask {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  instruction: string;
  /** The agent's report, or the error for a failed task. */
  result: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface GatewayTask {
  id: string;
  status: VpsTask["status"];
  instruction: string;
  result: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const MAX_RESULT_CHARS = 2000;

/** The gateway's REST API lives next to its MCP endpoint (https://vps.example/mcp). */
export function gatewayBase(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, "");
}

/** Tasks created from `since` on, newest first. Throws when the gateway does not answer. */
export async function listVpsTasks(
  vps: NonNullable<Config["vps"]>,
  since: Date,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<VpsTask[]> {
  const url = `${gatewayBase(vps.url)}/tasks?since=${encodeURIComponent(since.toISOString())}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${vps.token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`VPS gateway HTTP ${res.status}`);
  const body = await res.json() as { tasks?: GatewayTask[] };
  return (body.tasks ?? []).map((t) => ({
    id: t.id,
    status: t.status,
    instruction: t.instruction,
    result: (t.status === "failed" ? t.error ?? t.result : t.result)?.slice(0, MAX_RESULT_CHARS) ?? null,
    createdAt: t.created_at,
    finishedAt: t.finished_at,
  }));
}

/**
 * What the VPS agent did recently, for the instructions of a new conversation: so "continue
 * with the extension" makes sense to GPT-Live after the previous conversation closed.
 */
export function recentWorkSummary(tasks: VpsTask[], limit = 5): string | undefined {
  const lines = tasks
    .filter((t) => t.status === "done" || t.status === "failed")
    .slice(0, limit)
    .map((t) => {
      const when = new Date(t.createdAt).toLocaleString("it-IT", {
        timeZone: "Europe/Rome", weekday: "short", hour: "2-digit", minute: "2-digit",
      });
      const outcome = t.status === "failed" ? `failed: ${t.result ?? "unknown error"}` : t.result ?? "";
      return `  - ${when}: "${oneLine(t.instruction, 160)}" -> ${oneLine(outcome, 260)}`;
    });
  return lines.length ? lines.join("\n") : undefined;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
