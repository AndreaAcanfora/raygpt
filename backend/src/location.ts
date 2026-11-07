/**
 * The user's position, sent by the phone (web page or iOS app) when a conversation starts and
 * when the user moves. GPT-Live cannot know where the user is: "a pizzeria near me" needs it.
 */
export interface UserLocation {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, when the device reports it. */
  accuracy?: number;
  /** Street address from reverse geocoding, when available. */
  address?: string;
}

/** Validates a `{ lat, lon, accuracy? }` object from a client. Undefined when absent, null when invalid. */
export function parseLocation(raw: unknown): UserLocation | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return null;
  const { lat, lon, accuracy } = raw as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const location: UserLocation = { lat: round(lat), lon: round(lon) };
  if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0) {
    location.accuracy = Math.round(Math.min(accuracy, 100_000));
  }
  return location;
}

/** ~10 m precision is plenty for "near me" and keeps the coordinates short. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;

const GEOCODE_TIMEOUT_MS = 2_500;

/**
 * Street address of a position via OpenStreetMap Nominatim (free, needs an identifying
 * User-Agent). Returns undefined on any failure: the conversation must not wait on it.
 */
export async function reverseGeocode(
  location: UserLocation,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1`
    + `&lat=${location.lat}&lon=${location.lon}`;
  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "RayGPT/1.0 (personal use; andreaacanfora95@gmail.com)", "Accept-Language": "it" },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const body = await response.json() as { address?: Record<string, string>; display_name?: string };
    const a = body.address ?? {};
    const street = [a.road ?? a.pedestrian ?? a.square ?? a.footway, a.house_number].filter(Boolean).join(" ");
    const city = a.city ?? a.town ?? a.village ?? a.municipality;
    const parts = [street, a.suburb ?? a.neighbourhood, city].filter(Boolean);
    return parts.length ? parts.join(", ") : body.display_name?.split(",").slice(0, 3).join(",").trim();
  } catch {
    return undefined;
  }
}

/** One line describing the position, for the model. */
export function describeLocation(location: UserLocation): string {
  const where = location.address ? `${location.address} ` : "";
  const accuracy = location.accuracy !== undefined ? `, accuracy about ${location.accuracy} m` : "";
  return `${where}(lat ${location.lat}, lon ${location.lon}${accuracy})`;
}
