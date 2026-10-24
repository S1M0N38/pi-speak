import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiSpeakSettings } from "./settings.js";
import { DEFAULT_PREPROCESSING_PROMPT } from "./text.js";

export function buildPreprocessingUserMessage(raw: string): string {
  return `""""\n${raw}\n""""`;
}

type PreprocessingContext = Pick<
  ExtensionContext,
  "model" | "modelRegistry" | "signal" | "sessionManager"
>;

/** Summarize the raw message with the configured model, or the active session model. */
export async function preprocess(
  ctx: PreprocessingContext,
  raw: string,
  settings: Pick<PiSpeakSettings, "preprocessingModel" | "preprocessingPrompt">,
): Promise<string> {
  const configured = settings.preprocessingModel;
  const model = (configured ? ctx.modelRegistry.find(configured.provider, configured.id) : undefined) ?? ctx.model;
  if (!model) {
    throw new Error(
      configured
        ? `Preprocessing model not found: ${configured.provider}/${configured.id} and no active model is available`
        : "No active model available for preprocessing",
    );
  }

  const response = await ctx.modelRegistry.complete(
    model,
    {
      systemPrompt: settings.preprocessingPrompt ?? DEFAULT_PREPROCESSING_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: buildPreprocessingUserMessage(raw) }],
          timestamp: Date.now(),
        },
      ],
    },
    { signal: ctx.signal, sessionId: ctx.sessionManager.getSessionId() },
  );

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage ?? `Model stopped: ${response.stopReason}`);
  }

  const text = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (text.length === 0) throw new Error("The model returned no text");
  return text;
}
