import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bearerToken, safeEqual } from "./auth.js";
import type { Config } from "./config.js";
import { RecentIds, SessionLimiter } from "./limits.js";
import { acceptSipCall, createWebRtcSession, OpenAIError, rejectSipCall } from "./openai.js";
import { callerNumber, maskNumber, type SipHeader } from "./sip.js";
import { parseLocation, reverseGeocode } from "./location.js";
import { isAllowedVoice, VOICES } from "./voices.js";
import { listVpsTasks, recentWorkSummary } from "./vps.js";
import { verifyWebhook } from "./webhook.js";

export type Logger = (event: string, fields?: Record<string, unknown>) => void;

export const jsonLogger: Logger = (event, fields = {}) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
};

export interface AppDependencies {
  config: Config;
  fetch?: typeof fetch;
  log?: Logger;
  now?: () => number;
}

const MAX_SDP_LENGTH = 100_000;
/** How far back a new conversation looks for VPS work to continue, and how long it waits for it. */
const RECENT_VPS_WORK_MS = 24 * 3600_000;
const RECENT_VPS_WORK_TIMEOUT_MS = 1500;

export function createApp({ config, fetch: fetchImpl = fetch, log = jsonLogger, now = Date.now }: AppDependencies) {
  const app = new Hono();
  const limiter = new SessionLimiter(config.maxSessionsPerDay, now);
  const handledWebhooks = new RecentIds(undefined, now);

  app.get("/health", (c) => c.json({ ok: true, model: config.model }));

  // Universal link for Meta AI callbacks (Wearables Developer Center → iOS → Universal link):
  // https://<backend>/meta/callback opens the RayGPT app when APPLE_TEAM_ID is set.
  app.get("/.well-known/apple-app-site-association", (c) => {
    if (!config.appleTeamId) return c.json({ error: "apple_team_id_not_configured" }, 404);
    return c.json({
      applinks: {
        details: [{
          appIDs: [`${config.appleTeamId}.${config.iosBundleId}`],
          components: [{ "/": "/meta/*" }],
        }],
      },
    });
  });

  // Reached only when the app is not installed: universal links open the app directly.
  app.get("/meta/*", (c) => c.html(
    "<!doctype html><meta charset=utf-8><title>RayGPT</title>"
      + "<p>Apri questo link dall’iPhone con l’app RayGPT installata.</p>",
  ));

  app.get("/api/voices", (c) => c.json({ voices: VOICES, default: config.defaultVoice }));

  app.post("/api/session", bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token || !safeEqual(token, config.appToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = await c.req.json().catch(() => undefined) as { sdp?: unknown; voice?: unknown; location?: unknown } | undefined;
    const sdp = body?.sdp;
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > MAX_SDP_LENGTH) {
      return c.json({ error: "invalid_sdp" }, 400);
    }
    const voice = body?.voice ?? config.defaultVoice;
    if (typeof voice !== "string" || !isAllowedVoice(voice)) {
      return c.json({ error: "invalid_voice" }, 400);
    }

    const location = parseLocation(body?.location);
    if (location === null) return c.json({ error: "invalid_location" }, 400);

    if (!limiter.tryAcquire()) {
      log("session.rate_limited");
      return c.json({ error: "daily_session_limit" }, 429);
    }

    const startedAt = now();
    try {
      // Both are optional context: a slow or failing lookup only leaves it out.
      const [address, recentVpsWork] = await Promise.all([
        location ? reverseGeocode(location, fetchImpl) : undefined,
        config.vps
          ? listVpsTasks(config.vps, new Date(startedAt - RECENT_VPS_WORK_MS), fetchImpl, RECENT_VPS_WORK_TIMEOUT_MS)
            .then((tasks) => recentWorkSummary(tasks), () => undefined)
          : undefined,
      ]);
      if (location) location.address = address;
      const session = await createWebRtcSession(config, sdp, { voice, location, recentVpsWork }, fetchImpl);
      // Coordinates are not logged: only whether the phone sent them.
      log("session.created", {
        sessionId: session.sessionId, voice, location: Boolean(location), recentVpsWork: Boolean(recentVpsWork),
        ms: now() - startedAt,
      });
      return c.json({ sessionId: session.sessionId, sdp: session.answerSdp });
    } catch (error) {
      return openAIFailure(c, error, log, "session.failed");
    }
  });

  // Street address for a new position during a conversation; the client then adds it to the
  // session context (session.thinking.append) so the model knows where the user is now.
  app.post("/api/place", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token || !safeEqual(token, config.appToken)) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => undefined) as { location?: unknown } | undefined;
    const location = parseLocation(body?.location);
    if (!location) return c.json({ error: "invalid_location" }, 400);
    return c.json({ address: (await reverseGeocode(location, fetchImpl)) ?? null, lat: location.lat, lon: location.lon });
  });

  // Tasks the VPS agent got during a conversation: the client polls them to keep the conversation
  // open while the agent works and to have the outcome said as soon as it is ready.
  app.get("/api/vps/tasks", async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token || !safeEqual(token, config.appToken)) return c.json({ error: "unauthorized" }, 401);
    if (!config.vps) return c.json({ error: "vps_not_configured" }, 404);
    const since = new Date(c.req.query("since") ?? "");
    if (Number.isNaN(since.getTime())) return c.json({ error: "invalid_since" }, 400);
    try {
      return c.json({ tasks: await listVpsTasks(config.vps, since, fetchImpl) });
    } catch (error) {
      log("vps.tasks_failed", { message: (error as Error).message });
      return c.json({ error: "vps_unavailable" }, 502);
    }
  });

  // Why a conversation ended, reported by the client (idle, voice command, connection lost...).
  app.post("/api/session/end", bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token || !safeEqual(token, config.appToken)) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => undefined) as { sessionId?: unknown; reason?: unknown; seconds?: unknown } | undefined;
    const reason = body?.reason;
    if (typeof reason !== "string" || !/^[a-z_]{1,40}$/.test(reason)) return c.json({ error: "invalid_reason" }, 400);
    log("session.ended", {
      sessionId: typeof body?.sessionId === "string" ? body.sessionId.slice(0, 100) : undefined,
      reason,
      seconds: typeof body?.seconds === "number" && Number.isFinite(body.seconds) ? Math.round(body.seconds) : undefined,
    });
    return c.body(null, 204);
  });

  app.post("/sip/webhook", async (c) => {
    if (!config.webhookSecret) return c.json({ error: "sip_not_configured" }, 404);

    const rawBody = await c.req.text();
    const webhookId = c.req.header("webhook-id");
    const verification = verifyWebhook(config.webhookSecret, {
      id: webhookId,
      timestamp: c.req.header("webhook-timestamp"),
      signature: c.req.header("webhook-signature"),
    }, rawBody, Math.floor(now() / 1000));
    if (!verification.ok) {
      log("sip.webhook_rejected", { reason: verification.reason });
      return c.json({ error: "invalid_signature" }, 401);
    }
    if (handledWebhooks.has(webhookId!)) return c.json({ ok: true, duplicate: true });

    const event = JSON.parse(rawBody) as {
      type?: string;
      data?: { type?: string; session_id?: string; sip_headers?: SipHeader[] };
    };
    const sessionId = event.data?.session_id;
    if (event.type !== "live.transport.incoming" || event.data?.type !== "sip" || !sessionId) {
      handledWebhooks.add(webhookId!);
      return c.json({ ok: true, ignored: true });
    }

    const caller = callerNumber(event.data.sip_headers);
    const allowed = caller !== undefined && config.sipCallerAllowlist.includes(caller);
    try {
      if (!allowed) {
        await rejectSipCall(config, sessionId, 603, fetchImpl);
        log("sip.call_rejected", { sessionId, caller: maskNumber(caller), reason: "caller_not_allowed" });
      } else if (!limiter.tryAcquire()) {
        await rejectSipCall(config, sessionId, 486, fetchImpl);
        log("sip.call_rejected", { sessionId, caller: maskNumber(caller), reason: "daily_session_limit" });
      } else {
        await acceptSipCall(config, sessionId, { voice: config.defaultVoice }, fetchImpl);
        log("sip.call_accepted", { sessionId, caller: maskNumber(caller) });
      }
    } catch (error) {
      // Not marked as handled: OpenAI retries failed webhook deliveries.
      return openAIFailure(c, error, log, "sip.call_failed");
    }
    handledWebhooks.add(webhookId!);
    return c.json({ ok: true });
  });

  return app;
}

function openAIFailure(
  c: { json: (body: unknown, status: 502 | 504) => Response },
  error: unknown,
  log: Logger,
  event: string,
): Response {
  if (error instanceof OpenAIError) {
    log(event, { status: error.status, code: error.code, message: error.message });
    return c.json({ error: "openai_error", status: error.status, code: error.code, message: error.message },
      error.status === 504 ? 504 : 502);
  }
  log(event, { message: (error as Error).message });
  return c.json({ error: "internal_error" }, 502);
}
