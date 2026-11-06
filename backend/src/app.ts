import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bearerToken, safeEqual } from "./auth.js";
import type { Config } from "./config.js";
import { RecentIds, SessionLimiter } from "./limits.js";
import { acceptSipCall, createWebRtcSession, OpenAIError, rejectSipCall } from "./openai.js";
import { callerNumber, maskNumber, type SipHeader } from "./sip.js";
import { isAllowedVoice, VOICES } from "./voices.js";
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

export function createApp({ config, fetch: fetchImpl = fetch, log = jsonLogger, now = Date.now }: AppDependencies) {
  const app = new Hono();
  const limiter = new SessionLimiter(config.maxSessionsPerDay, now);
  const handledWebhooks = new RecentIds(undefined, now);

  app.get("/health", (c) => c.json({ ok: true, model: config.model }));

  app.get("/api/voices", (c) => c.json({ voices: VOICES, default: config.defaultVoice }));

  app.post("/api/session", bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token || !safeEqual(token, config.appToken)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = await c.req.json().catch(() => undefined) as { sdp?: unknown; voice?: unknown } | undefined;
    const sdp = body?.sdp;
    if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > MAX_SDP_LENGTH) {
      return c.json({ error: "invalid_sdp" }, 400);
    }
    const voice = body?.voice ?? config.defaultVoice;
    if (typeof voice !== "string" || !isAllowedVoice(voice)) {
      return c.json({ error: "invalid_voice" }, 400);
    }

    if (!limiter.tryAcquire()) {
      log("session.rate_limited");
      return c.json({ error: "daily_session_limit" }, 429);
    }

    const startedAt = now();
    try {
      const session = await createWebRtcSession(config, sdp, { voice }, fetchImpl);
      log("session.created", { sessionId: session.sessionId, voice, ms: now() - startedAt });
      return c.json({ sessionId: session.sessionId, sdp: session.answerSdp });
    } catch (error) {
      return openAIFailure(c, error, log, "session.failed");
    }
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
