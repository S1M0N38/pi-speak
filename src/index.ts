import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiSpeakRuntime } from "./runtime.js";
import { registerSpeakTool } from "./speak-tool.js";

// Pi awaits extension module evaluation before continuing startup. Keep this
// entry point registration-only and load the runtime on first use.
export default function piSpeak(pi: ExtensionAPI): void {
  let runtimePromise: Promise<PiSpeakRuntime> | undefined;
  let shuttingDown = false;

  function runtime(): Promise<PiSpeakRuntime> {
    if (shuttingDown) return Promise.reject(new Error("pi-speak is shutting down"));
    return (runtimePromise ??= import("./runtime.js").then(({ createPiSpeakRuntime }) =>
      createPiSpeakRuntime(),
    ));
  }

  registerSpeakTool(pi, runtime);

  pi.registerShortcut("ctrl+alt+x", {
    description: "Speak the last agent message",
    handler: async (ctx) => {
      try {
        await (await runtime()).speakLastMessage(ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("speak", {
    description: "Configure voice, speed, and preprocessing",
    handler: async (_args, ctx) => (await runtime()).showSettings(ctx),
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    shuttingDown = true;
    const loading = runtimePromise;
    if (!loading) return;
    const loaded = await loading.catch(() => undefined);
    await loaded?.shutdown(ctx).catch(() => undefined);
  });
}
