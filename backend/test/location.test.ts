import { describe, expect, it } from "vitest";
import { parseLocation, reverseGeocode } from "../src/location.js";
import { buildSessionConfig } from "../src/openai.js";
import { APP_TOKEN, fakeFetch, jsonResponse, makeApp, OFFER_SDP, testConfig } from "./helpers.js";

const FLORENCE = { lat: 43.77312, lon: 11.25601, accuracy: 18.4 };
const nominatim = () => jsonResponse({
  address: { road: "Via de' Martelli", house_number: "8", suburb: "Quartiere 1", city: "Firenze" },
  display_name: "8, Via de' Martelli, Quartiere 1, Firenze, Toscana, Italia",
});
const created = () => jsonResponse({ session: { id: "live_loc" }, transport: { type: "webrtc", sdp: "v=0 answer" } }, 201);

const post = (app: ReturnType<typeof makeApp>["app"], path: string, body: unknown) => app.request(path, {
  method: "POST",
  headers: { Authorization: `Bearer ${APP_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("parseLocation", () => {
  it("accepts a phone position, rounded to about 10 m", () => {
    expect(parseLocation(FLORENCE)).toEqual({ lat: 43.7731, lon: 11.256, accuracy: 18 });
  });

  it("is undefined when absent and null when invalid", () => {
    expect(parseLocation(undefined)).toBeUndefined();
    expect(parseLocation({ lat: 91, lon: 0 })).toBeNull();
    expect(parseLocation({ lat: "43", lon: 11 })).toBeNull();
    expect(parseLocation("Firenze")).toBeNull();
  });
});

describe("reverseGeocode", () => {
  it("turns coordinates into a short street address", async () => {
    const { fetchImpl, calls } = fakeFetch(nominatim());
    expect(await reverseGeocode({ lat: 43.7731, lon: 11.256 }, fetchImpl)).toBe("Via de' Martelli 8, Quartiere 1, Firenze");
    expect(calls[0]!.url).toContain("nominatim.openstreetmap.org/reverse");
    expect(calls[0]!.headers.get("User-Agent")).toMatch(/RayGPT/);
  });

  it("never fails the conversation: undefined on errors", async () => {
    const { fetchImpl } = fakeFetch(new Error("offline"));
    expect(await reverseGeocode({ lat: 1, lon: 1 }, fetchImpl)).toBeUndefined();
  });
});

describe("location in the session", () => {
  it("tells the voice model and the backend model where the user is", () => {
    const config = testConfig({
      OPENAI_WEB_SEARCH_MODEL: "gpt-5.6-terra",
      VPS_MCP_URL: "https://vps.example.com/mcp",
      VPS_MCP_TOKEN: "vps-token-0123456789abcdef0123456789abcdef",
    });
    const session = buildSessionConfig(config, { voice: "marin", location: { lat: 43.7731, lon: 11.256, accuracy: 18, address: "Via de' Martelli 8, Firenze" } }) as {
      instructions: string; delegation: { responses: { instructions: string } };
    };
    expect(session.instructions).toContain("Via de' Martelli 8, Firenze (lat 43.7731, lon 11.256, accuracy about 18 m)");
    expect(session.delegation.responses.instructions).toContain("nearby tool");
    expect(session.delegation.responses.instructions).toContain("lat 43.7731");
  });

  it("works without delegation too", () => {
    const session = buildSessionConfig(testConfig(), { voice: "marin", location: { lat: 1, lon: 2 } });
    expect(session.instructions).toContain("(lat 1, lon 2)");
    expect(session).not.toHaveProperty("delegation");
  });

  it("POST /api/session geocodes the position, then creates the session", async () => {
    const { fetchImpl, calls } = fakeFetch(nominatim(), created());
    const { app, logs } = makeApp({ fetch: fetchImpl });

    const response = await post(app, "/api/session", { sdp: OFFER_SDP, location: FLORENCE });

    expect(response.status).toBe(200);
    const session = (calls[1]!.body as { session: { instructions: string } }).session;
    expect(session.instructions).toContain("Via de' Martelli 8");
    // Coordinates stay out of the logs.
    expect(JSON.stringify(logs)).not.toContain("43.77");
  });

  it("starts the conversation even if geocoding fails", async () => {
    const { fetchImpl, calls } = fakeFetch(new Error("offline"), created());
    const { app } = makeApp({ fetch: fetchImpl });

    expect((await post(app, "/api/session", { sdp: OFFER_SDP, location: FLORENCE })).status).toBe(200);
    expect((calls[1]!.body as { session: { instructions: string } }).session.instructions).toContain("(lat 43.7731, lon 11.256");
  });

  it("rejects a malformed position", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const { app } = makeApp({ fetch: fetchImpl });
    const response = await post(app, "/api/session", { sdp: OFFER_SDP, location: { lat: 200, lon: 0 } });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/place", () => {
  it("returns the address of a new position", async () => {
    const { fetchImpl } = fakeFetch(nominatim());
    const { app } = makeApp({ fetch: fetchImpl });
    const response = await post(app, "/api/place", { location: FLORENCE });
    expect(await response.json()).toEqual({ address: "Via de' Martelli 8, Quartiere 1, Firenze", lat: 43.7731, lon: 11.256 });
  });

  it("needs the app token", async () => {
    const { app } = makeApp({ fetch: fakeFetch().fetchImpl });
    const response = await app.request("/api/place", { method: "POST", body: JSON.stringify({ location: FLORENCE }) });
    expect(response.status).toBe(401);
  });
});
