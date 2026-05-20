import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export function registerMessageRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer("phased-tasks-context", (message, _opts, theme) => {
    return new Text(theme.fg("accent", "📋 ") + theme.fg("dim", message.content as string), 0, 0);
  });

  pi.registerMessageRenderer("phased-tasks-notice", (message, _opts, theme) => {
    return new Text(theme.fg("warning", "⚠ ") + theme.fg("text", message.content as string), 0, 0);
  });
}
