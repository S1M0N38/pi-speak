import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  readSettings,
  writeSettings,
  MAX_SPEED,
  MIN_SPEED,
  VOICES,
  voiceHint,
  type PiSpeakSettings,
  type PreprocessingModel,
} from "./settings.js";
import { SPEED_VALUES } from "./text.js";

function voiceLabel(voice: string): string {
  const hint = voiceHint(voice);
  return hint.length > 0 ? `${voice} (${hint})` : voice;
}

function preprocessingLabel(ctx: ExtensionContext, settings: PiSpeakSettings): string {
  if (!settings.preprocessingEnabled) return "off";
  const model = settings.preprocessingModel;
  if (model) return `${model.provider}/${model.id}`;
  return ctx.model ? `current model (${ctx.model.provider}/${ctx.model.id})` : "current model (none)";
}

type PreprocessingChoice = {
  label: string;
  model?: PreprocessingModel;
  current?: boolean;
};

async function choosePreprocessing(
  ctx: ExtensionContext,
  settings: PiSpeakSettings,
): Promise<void> {
  const choices: PreprocessingChoice[] = [{ label: "Off" }];
  if (ctx.model) {
    choices.push({
      label: `Current model (${ctx.model.provider}/${ctx.model.id})`,
      current: true,
    });
  }
  for (const model of ctx.modelRegistry.getAvailable()) {
    choices.push({
      label: `${model.provider}/${model.id}${model.name ? ` (${model.name})` : ""}`,
      model: { provider: model.provider, id: model.id },
    });
  }

  const selected = await ctx.ui.select(
    "Preprocessing",
    choices.map((choice) => choice.label),
  );
  const choice = choices.find((candidate) => candidate.label === selected);
  if (!choice) return;

  const { preprocessingModel: _model, ...withoutModel } = settings;
  if (choice.model) {
    await writeSettings({
      ...settings,
      preprocessingEnabled: true,
      preprocessingModel: choice.model,
    });
  } else if (choice.current) {
    await writeSettings({ ...withoutModel, preprocessingEnabled: true });
  } else {
    await writeSettings({ ...withoutModel, preprocessingEnabled: false });
  }
}

export async function showSpeakSettings(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/speak requires an interactive session", "error");
    return;
  }

  while (true) {
    let settings: PiSpeakSettings;
    try {
      settings = await readSettings();
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      return;
    }

    const voiceChoice = `Voice: ${voiceLabel(settings.voice)}`;
    const speedChoice = `Speed: ${settings.speed}`;
    const preprocessingChoice = `Preprocessing: ${preprocessingLabel(ctx, settings)}`;
    const selected = await ctx.ui.select("pi-speak settings", [
      voiceChoice,
      speedChoice,
      preprocessingChoice,
      "Done",
    ]);

    if (!selected || selected === "Done") return;

    if (selected === voiceChoice) {
      const labels = VOICES.map(voiceLabel);
      const voice = await ctx.ui.select("Voice", labels);
      const index = voice ? labels.indexOf(voice) : -1;
      if (index >= 0) await writeSettings({ ...settings, voice: VOICES[index]! });
      continue;
    }

    if (selected === speedChoice) {
      const speed = await ctx.ui.select(`Speed · current ${settings.speed}`, [...SPEED_VALUES]);
      const value = speed ? Number.parseFloat(speed) : Number.NaN;
      if (value >= MIN_SPEED && value <= MAX_SPEED) {
        await writeSettings({ ...settings, speed: value });
      }
      continue;
    }

    if (selected === preprocessingChoice) await choosePreprocessing(ctx, settings);
  }
}
