import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { createAudioQueue, enqueueWav, type AudioQueue } from "./audio.js";
import { preprocess } from "./preprocessing.js";
import {
  isVoice,
  readSettings,
  VOICES,
  MAX_SPEED,
  MIN_SPEED,
  type PiSpeakSettings,
} from "./settings.js";
import { showSpeakSettings } from "./settings-menu.js";
import { SynthesisService } from "./synthesis-service.js";
import { clearStatus, showStatus } from "./visualizer.js";

export type SpeakOptions = {
  voice?: string;
  speed?: number;
  signal?: AbortSignal;
  settings?: PiSpeakSettings;
};

export type PiSpeakRuntime = {
  readonly service: SynthesisService;
  readonly audioQueue: AudioQueue;
  speak(
    ctx: ExtensionContext,
    text: string,
    options?: SpeakOptions,
  ): Promise<{ voice: string; speed: number }>;
  speakLastMessage(ctx: ExtensionContext): Promise<void>;
  showSettings(ctx: ExtensionContext): Promise<void>;
  shutdown(ctx?: ExtensionContext): Promise<void>;
};

export type PiSpeakRuntimeOptions = {
  service?: SynthesisService;
  audioQueue?: AudioQueue;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lastAssistantText(branch: readonly SessionEntry[]): string | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
    const text = entry.message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export function createPiSpeakRuntime(options: PiSpeakRuntimeOptions = {}): PiSpeakRuntime {
  const service = options.service ?? new SynthesisService();
  const audioQueue = options.audioQueue ?? createAudioQueue();

  async function speak(
    ctx: ExtensionContext,
    text: string,
    speakOptions: SpeakOptions = {},
  ): Promise<{ voice: string; speed: number }> {
    const settings = speakOptions.settings ?? (await readSettings());
    const voice = speakOptions.voice ?? settings.voice;
    const speed = speakOptions.speed ?? settings.speed;

    if (!isVoice(voice)) {
      throw new Error(`Unknown voice: ${voice}. Available voices: ${VOICES.join(", ")}`);
    }
    if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
      throw new Error(`Speed must be between ${MIN_SPEED} and ${MAX_SPEED}`);
    }

    showStatus(ctx, "Synthesizing…");
    try {
      await service.synthesize({ ...settings, voice, speed }, text, {
        signal: speakOptions.signal,
        onStatus: (status) => showStatus(ctx, status),
        onChunk: (wav) =>
          enqueueWav(audioQueue, wav, (error) =>
            ctx.ui.notify(`Audio playback failed: ${errorMessage(error)}`, "error"),
          ),
      });
      ctx.ui.notify(`Speaking ${text.length} chars (${voice}, ${speed}×)`, "info");
      return { voice, speed };
    } finally {
      clearStatus(ctx);
    }
  }

  async function speakLastMessage(ctx: ExtensionContext): Promise<void> {
    const raw = lastAssistantText(ctx.sessionManager.getBranch());
    if (!raw) {
      ctx.ui.notify("No agent message to speak", "warning");
      return;
    }

    let settings: PiSpeakSettings;
    try {
      settings = await readSettings();
    } catch (error) {
      ctx.ui.notify(errorMessage(error), "error");
      return;
    }

    let text = raw;
    if (settings.preprocessingEnabled) {
      showStatus(ctx, "Summarizing…");
      try {
        text = await preprocess(ctx, raw, settings);
      } catch (error) {
        clearStatus(ctx);
        ctx.ui.notify(`Preprocessing failed: ${errorMessage(error)}`, "error");
        return;
      }
    }

    try {
      await speak(ctx, text, { settings });
    } catch (error) {
      ctx.ui.notify(`Synthesis failed: ${errorMessage(error)}`, "error");
    }
  }

  async function showSettings(ctx: ExtensionContext): Promise<void> {
    await showSpeakSettings(ctx);
  }

  async function shutdown(ctx?: ExtensionContext): Promise<void> {
    await service.shutdown().catch(() => undefined);
    if (ctx) clearStatus(ctx);
  }

  return { service, audioQueue, speak, speakLastMessage, showSettings, shutdown };
}
