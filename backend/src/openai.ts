import type { Config } from "./config.js";

const REQUEST_TIMEOUT_MS = 15_000;

export interface SessionOptions {
  voice: string;
}

/** Session configuration shared by WebRTC sessions and accepted SIP calls. */
export function buildSessionConfig(config: Config, options: SessionOptions) {
  return {
    type: "live",
    model: config.model,
    instructions: config.instructions,
    audio: { output: { voice: options.voice } },
  };
}

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface CreatedWebRtcSession {
  sessionId: string;
  answerSdp: string;
}

/**
 * Creates a GPT-Live session over WebRTC: forwards the client's SDP offer and returns
 * OpenAI's SDP answer. The API key never leaves the backend.
 */
export async function createWebRtcSession(
  config: Config,
  offerSdp: string,
  options: SessionOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedWebRtcSession> {
  const body = await postJson(config, "/v1/live/sessions", {
    session: buildSessionConfig(config, options),
    transport: { type: "webrtc", sdp: offerSdp },
  }, fetchImpl);

  const sessionId = (body as { session?: { id?: unknown } } | undefined)?.session?.id;
  const answerSdp = (body as { transport?: { sdp?: unknown } } | undefined)?.transport?.sdp;
  if (typeof sessionId !== "string" || typeof answerSdp !== "string") {
    throw new OpenAIError("Unexpected response from OpenAI: missing session id or SDP answer", 502);
  }
  return { sessionId, answerSdp };
}

/** Accepts an incoming SIP call (Strada C) with the RayGPT session configuration. */
export async function acceptSipCall(
  config: Config,
  sessionId: string,
  options: SessionOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await postJson(config, `/v1/live/sessions/${encodeURIComponent(sessionId)}/accept`, {
    session: buildSessionConfig(config, options),
  }, fetchImpl);
}

/** Rejects an incoming SIP call. 486 = Busy Here, 603 = Decline. */
export async function rejectSipCall(
  config: Config,
  sessionId: string,
  statusCode: 486 | 603,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await postJson(config, `/v1/live/sessions/${encodeURIComponent(sessionId)}/reject`, {
    status_code: statusCode,
  }, fetchImpl);
}

async function postJson(
  config: Config,
  path: string,
  payload: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.openaiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OpenAIError(`Could not reach OpenAI: ${(error as Error).message}`, 504);
  }

  const text = await response.text();
  const body = text ? safeJson(text) : undefined;
  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | undefined)?.error;
    throw new OpenAIError(
      error?.message ?? `OpenAI returned HTTP ${response.status}`,
      response.status,
      error?.code,
    );
  }
  return body;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
