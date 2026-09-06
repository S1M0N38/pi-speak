import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CATALOG_MODELS, formatBinarySize } from "./catalog.js";
import {
  downloadCatalogModel,
  findCachedCatalogModel,
  findIncompleteDownload,
} from "./models.js";
import { settingsForModel, writeSettings, type PiSpeakSettings } from "./settings.js";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";

function requireTui(ctx: ExtensionContext): boolean {
  if (ctx.mode === "tui") return true;
  ctx.ui.notify("pi-speak configuration requires the interactive TUI", "error");
  return false;
}

type ModelSelectionOptions = {
  currentModelId?: string;
  voice?: string;
  speed?: number;
  preprocessingEnabled?: boolean;
  preprocessingModel?: { provider: string; id: string };
  preprocessingPrompt?: string;
  continueAfterSelection?: boolean;
};

export async function runModelSelection(
  ctx: ExtensionContext,
  options: ModelSelectionOptions = {},
): Promise<PiSpeakSettings | undefined> {
  if (!requireTui(ctx)) return undefined;

  let currentModelId = options.currentModelId;
  let configured: PiSpeakSettings | undefined;
  let commitQueue: Promise<void> = Promise.resolve();
  const enqueueCommit = (commit: () => Promise<void>): Promise<void> => {
    const result = commitQueue.then(commit);
    commitQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  while (true) {
    const models = CATALOG_MODELS;
    let selected = models.find((model) => model.id === currentModelId) ?? models[0];
    if (!selected) return configured;

    if (models.length > 1) {
      const choices = models.map((model) => {
        const cached = findCachedCatalogModel(model);
        if (cached) return `${model.name} (${formatBinarySize(model.size)}) ✓`;
        const partial = findIncompleteDownload(model);
        const resume =
          partial !== undefined ? ` · ↻ ${formatBinarySize(partial.bytes)} downloaded` : "";
        return `${model.name} (${formatBinarySize(model.size)})${resume}`;
      });
      const choice = await ctx.ui.select("Choose a model", choices);
      if (!choice) {
        await commitQueue;
        return configured;
      }
      const index = choices.indexOf(choice);
      selected = models[index] ?? selected;
    } else {
      const cached = findCachedCatalogModel(selected);
      if (!cached) {
        const confirm = await ctx.ui.confirm(
          "Download model",
          `Download ${selected.name} (${formatBinarySize(selected.size)}) from Hugging Face? Audio never leaves this machine.`,
        );
        if (!confirm) {
          await commitQueue;
          return configured;
        }
      }
    }

    let path: string;
    const cached = findCachedCatalogModel(selected);
    if (cached) {
      const stillCached = findCachedCatalogModel(selected);
      if (!stillCached) {
        ctx.ui.notify(
          "the downloaded file is missing; select the model again to re-download it",
          "error",
        );
        continue;
      }
      path = stillCached.path;
    } else {
      const controller = new AbortController();
      const show = (text: string): void => {
        if (!ctx.hasUI) return;
        ctx.ui.setWidget(STATUS_WIDGET_KEY, [ctx.ui.theme.fg("muted", text)]);
      };
      const clear = (): void => {
        if (!ctx.hasUI) return;
        ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
      };
      show(`Downloading ${selected.name}… 0%`);
      try {
        path = await downloadCatalogModel(selected, {
          signal: controller.signal,
          onProgress: ({ downloaded, total }) => {
            const percent = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
            show(
              `Downloading ${selected.name}… ${formatBinarySize(downloaded)} / ${formatBinarySize(total)} · ${percent}%`,
            );
          },
        });
        clear();
        controller.signal.throwIfAborted();
      } catch (error) {
        clear();
        if ((error as Error).name === "AbortError" || controller.signal.aborted) {
          ctx.ui.notify("Download cancelled", "info");
          continue;
        }
        ctx.ui.notify(
          `Could not download ${selected.name}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        continue;
      }
    }

    await enqueueCommit(async () => {
      const settings = settingsForModel(selected.id, path, {
        voice: configured?.voice ?? options.voice,
        speed: configured?.speed ?? options.speed,
        preprocessingEnabled: configured?.preprocessingEnabled ?? options.preprocessingEnabled,
        preprocessingModel: configured?.preprocessingModel ?? options.preprocessingModel,
        preprocessingPrompt: configured?.preprocessingPrompt ?? options.preprocessingPrompt,
      });
      await writeSettings(settings);
      configured = settings;
      currentModelId = selected.id;
    });

    await commitQueue;

    if (options.continueAfterSelection) {
      return configured;
    }

    // For single-model catalog, return after first successful selection.
    // Multi-model case would loop to allow picking another, but keep simple.
    return configured;
  }
}

export async function runOnboarding(
  ctx: ExtensionContext,
): Promise<PiSpeakSettings | undefined> {
  if (!requireTui(ctx)) return undefined;
  return runModelSelection(ctx, { continueAfterSelection: true });
}
