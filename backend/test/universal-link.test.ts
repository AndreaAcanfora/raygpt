import { describe, expect, it } from "vitest";
import { makeApp, testConfig } from "./helpers.js";

describe("apple-app-site-association", () => {
  it("lists the iOS app for /meta/* when the Team ID is set", async () => {
    const { app } = makeApp({ config: testConfig({ APPLE_TEAM_ID: "ABCDE12345" }) });

    const response = await app.request("/.well-known/apple-app-site-association");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      applinks: { details: [{ appIDs: ["ABCDE12345.com.andreaacanfora.raygpt.app"], components: [{ "/": "/meta/*" }] }] },
    });
  });

  it("is not served without a Team ID", async () => {
    const { app } = makeApp();

    expect((await app.request("/.well-known/apple-app-site-association")).status).toBe(404);
  });

  it("answers the callback path with a short page", async () => {
    const { app } = makeApp();

    const response = await app.request("/meta/callback");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("RayGPT");
  });
});
