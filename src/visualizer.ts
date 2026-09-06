import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { STATUS_WIDGET_KEY } from "./shortcut-core.js";

export function showSynthesisStatus(
  ctx: ExtensionContext,
  text: string,
  options?: { spinner?: boolean },
): void {
  if (!ctx.hasUI) return;

  if (!options?.spinner) {
    ctx.ui.setWidget(STATUS_WIDGET_KEY, [ctx.ui.theme.fg("muted", text)]);
    return;
  }

  ctx.ui.setWidget(STATUS_WIDGET_KEY, (tui, theme) => {
    const loader = new Loader(
      tui,
      (frame) => theme.fg("accent", frame),
      (value) => value,
      theme.fg("muted", text),
    );

    return {
      render: (width: number) => loader.render(width),
      invalidate(): void {
        loader.invalidate();
      },
      dispose(): void {
        loader.stop();
      },
    };
  });
}

export function clearSynthesisWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
}
