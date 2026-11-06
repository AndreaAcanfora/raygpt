import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp, jsonLogger } from "./app.js";
import { type Config, ConfigError, loadConfig } from "./config.js";

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Configuration error: ${error.message}. See backend/.env.example.`);
      process.exit(1);
    }
    throw error;
  }
}

const config = loadConfigOrExit();
const app = createApp({ config });

// Web test client: lets the iPhone talk to GPT-Live from Safari before the iOS app exists.
const publicDir = new URL("../public/", import.meta.url);
const staticFiles: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/client.js": { file: "client.js", type: "text/javascript; charset=utf-8" },
};
for (const [path, { file, type }] of Object.entries(staticFiles)) {
  const content = readFileSync(new URL(file, publicDir), "utf8");
  app.get(path, (c) => c.body(content, 200, { "Content-Type": type, "Cache-Control": "no-store" }));
}

app.get("/favicon.ico", (c) => c.body(null, 204));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  jsonLogger("server.started", { port: info.port, model: config.model, sip: Boolean(config.webhookSecret) });
});
