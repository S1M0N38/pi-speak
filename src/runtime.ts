import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAudioQueue, type AudioQueue } from "./audio.js";
import type { PiSpeakSettings } from "./settings.js";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";
import { SynthesisService } from "./synthesis-service.js";
import { DEFAULT_PREPROCESSING_PROMPT, extractTextContent } from "./text.js";

export type PiSpeakRuntime = {
  readonly service: SynthesisService;
  readonly audioQueue: AudioQueue;
  requireConfiguredSettingsForTool(): Promise<PiSpeakSettings>;
  showSettings(ctx: ExtensionCommandContext): Promise<void>;
  speakLastMessage(ctx: ExtensionContext): Promise<void>;
  replayOnboarding(ctx: ExtensionCommandContext): Promise<void>;
  shutdown(ctx: ExtensionContext): Promise<void>;
};

export type PiSpeakRuntimeOptions = {
  synthesisService?: SynthesisService;
  generatePreprocessedText?: (
    raw: string,
    prompt: string,
    model: unknown,
    ctx: ExtensionContext,
  ) => Promise<string | null>;
};

export function createPiSpeakRuntime(
  pi: ExtensionAPI,
  options: PiSpeakRuntimeOptions = {},
): PiSpeakRuntime {
  let operation: Promise<void> | undefined;
  let shutDown = false;
  let settings: PiSpeakSettings | undefined;
  let settingsLoaded = false;
  let settingsReadWarning: string | undefined;
  let settingsWarningShown = false;

  let audioModulePromise: Promise<typeof import("./audio.js")> | undefined;
  let visualizerModulePromise: Promise<typeof import("./visualizer.js")> | undefined;

  const synthesisService = options.synthesisService ?? new SynthesisService();
  const audioQueue = createAudioQueue();

  function loadAudio(): Promise<typeof import("./audio.js")> {
    return (audioModulePromise ??= import("./audio.js"));
  }

  function loadVisualizer(): Promise<typeof import("./visualizer.js")> {
    return (visualizerModulePromise ??= import("./visualizer.js"));
  }

  // Keep lazy boundary explicit for future wiring (like pi-transcribe runtime.ts:69-75)
  void loadAudio;
  void loadVisualizer;

  function rememberSettings(configured: PiSpeakSettings): void {
    settings = configured;
    settingsLoaded = true;
    settingsReadWarning = undefined;
  }

  async function loadSettingsOnce(): Promise<void> {
    if (settingsLoaded) return;
    const { readSettings } = await import("./settings.js");
    const result = await readSettings();
    settingsLoaded = true;
    settings = result.settings;
    settingsReadWarning = result.warning;
  }

  async function configureFirstRun(
    ctx: ExtensionContext,
  ): Promise<PiSpeakSettings | undefined> {
    const { runOnboarding } = await import("./onboarding.js");
    const configured = await runOnboarding(ctx);
    if (configured) rememberSettings(configured);
    return configured;
  }

  async function configureModel(
    ctx: ExtensionContext,
    previous: PiSpeakSettings,
  ): Promise<PiSpeakSettings | undefined> {
    const { runModelSelection } = await import("./onboarding.js");
    const configured = await runModelSelection(ctx, {
      currentModelId: previous.model.id,
      voice: previous.voice,
      speed: previous.speed,
      preprocessingEnabled: previous.preprocessingEnabled,
      preprocessingModel: previous.preprocessingModel,
      preprocessingPrompt: previous.preprocessingPrompt,
      continueAfterSelection: true,
    });
    if (configured) rememberSettings(configured);
    return configured;
  }

  async function ensureSettings(
    ctx: ExtensionContext,
  ): Promise<PiSpeakSettings | undefined> {
    await loadSettingsOnce();
    if (settingsReadWarning && !settingsWarningShown) {
      settingsWarningShown = true;
      ctx.ui.notify(settingsReadWarning, "warning");
    }

    if (settings && existsSync(settings.model.path)) return settings;

    const previous = settings;
    if (settings) {
      ctx.ui.notify(
        `Configured model file is missing: ${settings.model.path}. Choose a model again; nothing will be downloaded without confirmation.`,
        "warning",
      );
      settings = undefined;
    }

    const configured = previous
      ? await configureModel(ctx, previous)
      : await configureFirstRun(ctx);
    if (configured) {
      ctx.ui.notify("Setup complete. Use /speak for settings.", "info");
    }
    return configured;
  }

  async function requireConfiguredSettingsForTool(): Promise<PiSpeakSettings> {
    await loadSettingsOnce();
    if (settingsReadWarning) {
      throw new Error(
        `${settingsReadWarning} Run /speak in Pi's interactive TUI to configure a local model, then retry speak.`,
      );
    }
    if (!settings) {
      throw new Error(
        "pi-speak is not configured. Run /speak in Pi's interactive TUI once to choose and download a local model, then retry speak.",
      );
    }
    if (!existsSync(settings.model.path)) {
      throw new Error(
        `The configured speech model is missing: ${settings.model.path}. Run /speak and choose a model again, then retry speak.`,
      );
    }
    return settings;
  }

  function runExclusive(
    ctx: ExtensionContext,
    task: () => Promise<void>,
  ): Promise<void> {
    if (operation) {
      if (ctx.hasUI) ctx.ui.notify("A pi-speak operation is already in progress", "warning");
      return operation;
    }

    const nextOperation = task().finally(() => {
      if (operation === nextOperation) operation = undefined;
    });
    operation = nextOperation;
    return nextOperation;
  }

  async function showSettings(ctx: ExtensionCommandContext): Promise<void> {
    let reload = false;
    await runExclusive(ctx, async () => {
      const configured = await ensureSettings(ctx);
      if (!configured) return;
      const { showSpeakSettings } = await import("./settings-menu.js");
      reload = await showSpeakSettings(pi, ctx, configured);
    });
    if (reload) await ctx.reload();
  }

  async function speakLastMessage(ctx: ExtensionContext): Promise<void> {
    return runExclusive(ctx, async () => {
      let configured: PiSpeakSettings;
      try {
        configured = await requireConfiguredSettingsForTool();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      let raw: string | undefined;
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        const entry = branch[index] as unknown as {
          type: string;
          message?: { role?: string; content?: unknown[] };
        };
        if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
        const text = extractTextContent(entry.message.content as unknown[] | undefined);
        if (text && text.trim()) {
          raw = text;
          break;
        }
      }

      if (!raw) {
        ctx.ui.notify("No agent message to speak", "warning");
        return;
      }

      const hasUI = ctx.hasUI;
      let visualizer: Awaited<ReturnType<typeof loadVisualizer>> | undefined;
      try {
        visualizer = await loadVisualizer().catch(() => undefined);
      } catch {}
      if (hasUI) {
        if (visualizer) {
          visualizer.showSynthesisStatus(ctx, "Synthesizing…", { spinner: true });
        } else {
          ctx.ui.setWidget(STATUS_WIDGET_KEY, [ctx.ui.theme.fg("muted", "Synthesizing…")]);
        }
      }

      let textToSpeak: string;
      try {
        if (configured.preprocessingEnabled) {
          const modelConfig = configured.preprocessingModel;
          if (!modelConfig) {
            ctx.ui.notify(
              "Preprocessing is enabled but no model is configured. Use /speak to select a model or disable preprocessing.",
              "error",
            );
            return;
          }

          const model = ctx.modelRegistry.find(modelConfig.provider, modelConfig.id);
          if (!model) {
            ctx.ui.notify(`Preprocessing model not found: ${modelConfig.provider}/${modelConfig.id}`, "error");
            return;
          }

          const prompt =
            configured.preprocessingPrompt && configured.preprocessingPrompt.trim().length > 0
              ? configured.preprocessingPrompt.trim()
              : DEFAULT_PREPROCESSING_PROMPT;

          let result: string | null;
          try {
            const generate = options.generatePreprocessedText
              ? options.generatePreprocessedText
              : (await import("./preprocessing.js")).generatePreprocessedText;
            result = await generate(raw, prompt, model, ctx);
          } catch (error) {
            ctx.ui.notify(
              `Preprocessing failed: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
            return;
          }

          if (!result || !result.trim()) {
            ctx.ui.notify("Preprocessing failed: LLM returned empty response", "error");
            return;
          }

          textToSpeak = result.trim();
        } else {
          textToSpeak = raw;
        }

        let wavBuffer: Buffer;
        try {
          wavBuffer = await synthesisService.synthesize(configured, textToSpeak, undefined);
        } catch (error) {
          ctx.ui.notify(
            `Synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return;
        }

        const directory = await mkdtemp(join(tmpdir(), "pi-speak-"));
        const outPath = join(directory, `speak-last-${process.pid}-${Date.now()}.wav`);
        await writeFile(outPath, wavBuffer);
        const audio = await loadAudio();
        audioQueue.enqueue({
          play: async () => {
            try {
              await audio.playWav(outPath);
            } finally {
              await unlink(outPath).catch(() => undefined);
              await rm(directory, { recursive: true, force: true }).catch(() => undefined);
            }
          },
        });
        ctx.ui.notify(`Speaking last message (${textToSpeak.length} chars)`, "info");
      } finally {
        if (visualizer) {
          visualizer.clearSynthesisWidget(ctx);
        } else if (hasUI) {
          ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
        }
      }
    });
  }

  async function replayOnboarding(ctx: ExtensionCommandContext): Promise<void> {
    await runExclusive(ctx, async () => {
      await loadSettingsOnce();
      const { runOnboarding } = await import("./onboarding.js");
      const configured = await runOnboarding(ctx);
      if (!configured) return;
      rememberSettings(configured);
      ctx.ui.notify("Onboarding replay complete", "info");
    });
  }

  async function shutdown(ctx: ExtensionContext): Promise<void> {
    if (shutDown) return;
    shutDown = true;

    await Promise.all([operation?.catch(() => undefined), synthesisService.shutdown().catch(() => undefined)]);

    if (visualizerModulePromise) {
      const visualizer = await visualizerModulePromise.catch(() => undefined);
      visualizer?.clearSynthesisWidget(ctx);
    } else if (ctx.hasUI) {
      // Fallback clear if visualizer never loaded
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
    }
  }

  return {
    service: synthesisService,
    audioQueue,
    requireConfiguredSettingsForTool,
    showSettings,
    speakLastMessage,
    replayOnboarding,
    shutdown,
  };
}
