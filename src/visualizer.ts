import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const STATUS_WIDGET_KEY = "pi-speak-status";

export function showStatus(ctx: ExtensionContext, text: string): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATUS_WIDGET_KEY, [ctx.ui.theme.fg("muted", text)]);
}

export function clearStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
}
