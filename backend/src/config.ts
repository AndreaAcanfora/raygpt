import { DEFAULT_INSTRUCTIONS } from "./instructions.js";
import { DEFAULT_VOICE, isAllowedVoice } from "./voices.js";

export interface Config {
  /** OpenAI API key. Never sent to clients. */
  openaiApiKey: string;
  /** Base URL of the OpenAI API, overridable for tests. */
  openaiBaseUrl: string;
  model: string;
  defaultVoice: string;
  instructions: string;
  /** Shared secret the iPhone app (or the web test client) sends as a bearer token. */
  appToken: string;
  /** Secret of the OpenAI webhook endpoint (whsec_...). Only needed for SIP. */
  webhookSecret?: string;
  /** Normalized E.164 numbers allowed to call RayGPT over SIP. Empty means reject every call. */
  sipCallerAllowlist: string[];
  /**
   * Backend model that GPT-Live delegates web searches to (Responses API with the web_search
   * tool). Undefined disables web search.
   */
  webSearchModel?: string;
  /** Upper bound on GPT-Live sessions created per rolling 24 hours (WebRTC + SIP). */
  maxSessionsPerDay: number;
  port: number;
}

export class ConfigError extends Error {}

const MIN_APP_TOKEN_LENGTH = 32;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const openaiApiKey = required(env, "OPENAI_API_KEY");
  const appToken = required(env, "APP_TOKEN");
  if (appToken.length < MIN_APP_TOKEN_LENGTH) {
    throw new ConfigError(`APP_TOKEN must be at least ${MIN_APP_TOKEN_LENGTH} characters long`);
  }

  const defaultVoice = env.OPENAI_VOICE?.trim() || DEFAULT_VOICE;
  if (!isAllowedVoice(defaultVoice)) {
    throw new ConfigError(`OPENAI_VOICE "${defaultVoice}" is not a known GPT-Live voice`);
  }

  return {
    openaiApiKey,
    openaiBaseUrl: (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com").replace(/\/+$/, ""),
    model: env.OPENAI_MODEL?.trim() || "gpt-live-1",
    defaultVoice,
    instructions: env.OPENAI_INSTRUCTIONS?.trim() || DEFAULT_INSTRUCTIONS,
    appToken,
    webhookSecret: env.OPENAI_WEBHOOK_SECRET?.trim() || undefined,
    sipCallerAllowlist: parseAllowlist(env.SIP_CALLER_ALLOWLIST),
    webSearchModel: env.OPENAI_WEB_SEARCH_MODEL?.trim() || undefined,
    maxSessionsPerDay: positiveInt(env, "MAX_SESSIONS_PER_DAY", 50),
    port: positiveInt(env, "PORT", 8787),
  };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`Missing required environment variable ${name}`);
  return value;
}

function positiveInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }
  return value;
}

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!/^\+[1-9]\d{6,14}$/.test(entry)) {
        throw new ConfigError(`SIP_CALLER_ALLOWLIST entry "${entry}" is not an E.164 number like +393331234567`);
      }
      return entry;
    });
}
