import type { ExecutionContext } from "hono";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

/**
 * Cloudflare Workers entry point. Static files in public/ are served by Workers static assets
 * (wrangler.toml); every other path reaches the Hono app. Secrets and variables come from the
 * Worker environment instead of process.env.
 *
 * The session limiter and webhook de-duplication live in memory, so on Workers they apply per
 * isolate: the real spending cap is the budget of the OpenAI project.
 */
let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Response | Promise<Response> {
    if (!app) {
      try {
        app = createApp({ config: loadConfig(stringValues(env)) });
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`Configuration error: ${error.message}`);
          return Response.json({ error: "server_misconfigured" }, { status: 500 });
        }
        throw error;
      }
    }
    return app.fetch(request, env, ctx);
  },
};

function stringValues(env: Record<string, unknown>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, typeof value === "string" ? value : undefined]),
  );
}
