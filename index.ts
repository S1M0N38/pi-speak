import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { NoPlayerError, NoPttsError, speak } from "./speak.ts";

export default function piSpeak(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "speak",
    label: "Speak",
    description: "Play text aloud with TTS.",
    promptSnippet: "Speak text aloud locally",
    promptGuidelines: [
      "Use speak when the user asks to hear text aloud.",
      "Pass natural spoken prose, not markdown or code.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "The text to speak." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        await speak(params.text, { signal });
      } catch (error) {
        if (error instanceof NoPttsError || error instanceof NoPlayerError) {
          ctx.ui.notify(error.message, "error");
        }
        throw error;
      }

      return { content: [{ type: "text" as const, text: "Spoken." }], details: undefined };
    },
  });
}
