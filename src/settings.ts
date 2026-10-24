import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_VOICE = "af_heart";
export const DEFAULT_SPEED = 1.0;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3.0;

/** Voices accepted by kokoro-js (English only). */
export const VOICES = [
  "af_heart",
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis",
] as const;

export type Voice = (typeof VOICES)[number];

export type PreprocessingModel = {
  provider: string;
  id: string;
};

export type PiSpeakSettings = {
  voice: Voice;
  speed: number;
  preprocessingEnabled?: boolean;
  /** Undefined means "use the active session model". */
  preprocessingModel?: PreprocessingModel;
  /** Undefined means "use the built-in prompt". */
  preprocessingPrompt?: string;
};

function settingsPath(): string {
  return join(getAgentDir(), "pi-speak.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isVoice(value: string): value is Voice {
  return (VOICES as readonly string[]).includes(value);
}

function normalizeModel(value: unknown): PreprocessingModel | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
  const provider = value.provider.trim();
  const id = value.id.trim();
  return provider.length > 0 && id.length > 0 ? { provider, id } : undefined;
}

function normalize(raw: unknown): PiSpeakSettings {
  const value = isObject(raw) ? raw : {};
  const voice =
    typeof value.voice === "string" && isVoice(value.voice) ? value.voice : DEFAULT_VOICE;
  const speed =
    typeof value.speed === "number" && Number.isFinite(value.speed)
      ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, value.speed))
      : DEFAULT_SPEED;
  const model = normalizeModel(value.preprocessingModel);
  const prompt = typeof value.preprocessingPrompt === "string" ? value.preprocessingPrompt.trim() : "";

  return {
    voice,
    speed,
    ...(value.preprocessingEnabled === true ? { preprocessingEnabled: true } : {}),
    ...(model ? { preprocessingModel: model } : {}),
    ...(prompt.length > 0 ? { preprocessingPrompt: prompt } : {}),
  };
}

export async function readSettings(): Promise<PiSpeakSettings> {
  const path = settingsPath();
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return normalize({});
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return normalize(JSON.parse(content));
  } catch {
    throw new Error(`Invalid settings in ${path}`);
  }
}

export async function writeSettings(settings: PiSpeakSettings): Promise<void> {
  const path = settingsPath();
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function voiceHint(voice: string): string {
  const languages: Record<string, string> = { a: "American", b: "British" };
  const genders: Record<string, string> = { f: "female", m: "male" };
  const language = languages[voice[0] ?? ""] ?? "";
  const gender = genders[voice[1] ?? ""] ?? "";
  return [language, gender].filter(Boolean).join(" ");
}
