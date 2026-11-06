/** Built-in GPT-Live voices listed in the OpenAI API reference (November 2026). */
export const VOICES = [
  "alloy", "ash", "ballad", "beacon", "bossa", "brise", "cedar", "cinder",
  "coral", "delta", "echo", "flitz", "gleam", "harema", "juni", "marin",
  "meridian", "nira", "noeul", "nuri", "quartz", "ripple", "sage", "shida",
  "shimmer", "sillage", "stone", "tempo", "verse", "vesper", "willow",
] as const;

export type Voice = (typeof VOICES)[number];

export const DEFAULT_VOICE: Voice = "marin";

export function isAllowedVoice(value: string): value is Voice {
  return (VOICES as readonly string[]).includes(value);
}
