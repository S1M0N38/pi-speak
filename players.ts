export interface Player {
  command: string;
  args: string[];
}

/** Ordered player candidates for `platform`; the first one that starts wins. */
export function playersFor(platform: NodeJS.Platform, wavPath: string): Player[] {
  switch (platform) {
    case "darwin":
      return [{ command: "afplay", args: [wavPath] }];
    case "linux":
      return [
        { command: "pw-play", args: [wavPath] },
        { command: "paplay", args: [wavPath] },
        { command: "aplay", args: ["-q", wavPath] },
      ];
    case "win32":
      return [
        {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(New-Object Media.SoundPlayer '${wavPath.replaceAll("'", "''")}').PlaySync()`,
          ],
        },
      ];
    default:
      return [];
  }
}
