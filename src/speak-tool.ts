import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PiSpeakRuntime } from "./runtime.js";
import { MAX_SPEED, MIN_SPEED } from "./settings.js";

export function registerSpeakTool(
  pi: ExtensionAPI,
  getRuntime: () => Promise<PiSpeakRuntime>,
): void {
  pi.registerTool({
    name: "speak",
    label: "Speak",
    description: "Convert text to speech via local Kokoro TTS and play audio",
    promptSnippet: "Speak text aloud with local Kokoro TTS",
    promptGuidelines: [
      "Use speak when the user wants to hear text spoken aloud.",
      "speak queues synthesis and playback; multiple calls play serially.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "Text to speak" }),
      voice: Type.Optional(Type.String({ description: "Voice id, defaults to configured" })),
      speed: Type.Optional(
        Type.Number({ description: "Speed 0.5-3.0", minimum: MIN_SPEED, maximum: MAX_SPEED }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const text = params.text?.trim();
      if (!text) throw new Error("Missing or empty 'text' field");

      const { voice, speed } = await (await getRuntime()).speak(ctx, text, {
        voice: params.voice,
        speed: params.speed,
        signal,
      });

      const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      return {
        content: [
          {
            type: "text" as const,
            text: `Speaking: "${preview}" (voice ${voice}, speed ${speed})`,
          },
        ],
        details: { voice, speed, textLength: text.length },
      };
    },
  });
}
