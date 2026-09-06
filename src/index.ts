import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSpeakTool } from "./speak-tool.js";
import type { PiSpeakRuntime } from "./runtime.js";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";

// Pi awaits extension module evaluation before continuing startup. Keep this
// entry point registration-only and load feature implementations on first use.
export default function piSpeak(pi: ExtensionAPI): void {
  let runtimePromise: Promise<PiSpeakRuntime> | undefined;
  let shuttingDown = false;

  function loadRuntime(): Promise<PiSpeakRuntime> {
    if (shuttingDown) {
      return Promise.reject(new Error("pi-speak is shutting down"));
    }
    if (runtimePromise) return runtimePromise;

    const loading = import("./runtime.js").then(({ createPiSpeakRuntime }) =>
      createPiSpeakRuntime(pi),
    );
    runtimePromise = loading;
    void loading.catch(() => {
      if (runtimePromise === loading) runtimePromise = undefined;
    });
    return loading;
  }

  const speakTool = registerSpeakTool(pi, {
    getSettings: async () => (await loadRuntime()).requireConfiguredSettingsForTool(),
    getService: async () => (await loadRuntime()).service,
    getAudioQueue: async () => (await loadRuntime()).audioQueue,
  });

  pi.registerShortcut("ctrl+alt+x" as Parameters<ExtensionAPI["registerShortcut"]>[0], {
    description: "Speak last agent message",
    handler: async (ctx) => {
      // The first press pays deferred module loading before the runtime can
      // show anything; paint feedback synchronously. Later presses reach the
      // memoized runtime in a microtask and it paints its own status.
      if (!runtimePromise && ctx.hasUI) {
        ctx.ui.setWidget(STATUS_WIDGET_KEY, [
          ctx.ui.theme.fg("muted", "Synthesizing…"),
        ]);
      }
      try {
        await (await loadRuntime()).speakLastMessage(ctx);
      } catch (error) {
        if (ctx.hasUI) ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
        throw error;
      }
    },
  });

  pi.registerCommand("speak", {
    description: "Configure voice and speed for pi-speak",
    handler: async (_args, ctx) => (await loadRuntime()).showSettings(ctx),
  });

  if (process.env.PI_SPEAK_DEBUG === "1") {
    pi.registerCommand("speak-onboarding", {
      description: "Replay pi-speak onboarding (debug)",
      handler: async (_args, ctx) => (await loadRuntime()).replayOnboarding(ctx),
    });
  }

  pi.on("session_shutdown", async (_event, ctx) => {
    shuttingDown = true;
    await speakTool.shutdown().catch(() => undefined);
    const loading = runtimePromise;
    if (!loading) return;
    const runtime = await loading.catch(() => undefined);
    await runtime?.shutdown(ctx).catch(() => undefined);
  });
}
