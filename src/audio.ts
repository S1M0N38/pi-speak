import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

export const AUDIO_PLAYBACK_TIMEOUT_MS = 5 * 60 * 1000;
const execFileAsync = promisify(execFile);

export type AudioPlayer = {
  command: string;
  args: (path: string) => string[];
};

const DARWIN_PLAYERS: AudioPlayer[] = [
  { command: "afplay", args: (path) => [path] },
  { command: "ffplay", args: (path) => ["-nodisp", "-autoexit", "-loglevel", "quiet", path] },
  { command: "mpv", args: (path) => ["--no-video", "--really-quiet", path] },
];

const LINUX_PLAYERS: AudioPlayer[] = [
  { command: "pw-play", args: (path) => [path] },
  { command: "paplay", args: (path) => [path] },
  { command: "aplay", args: (path) => ["-q", path] },
  { command: "ffplay", args: (path) => ["-nodisp", "-autoexit", "-loglevel", "quiet", path] },
  { command: "mpv", args: (path) => ["--no-video", "--really-quiet", path] },
];

const WINDOWS_PLAYERS: AudioPlayer[] = [
  { command: "ffplay.exe", args: (path) => ["-nodisp", "-autoexit", "-loglevel", "quiet", path] },
  {
    command: "powershell.exe",
    args: (path) => [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(New-Object Media.SoundPlayer '${path.replace(/'/g, "''")}').PlaySync()`,
    ],
  },
];

export type AudioPlayerLookup = {
  platform?: NodeJS.Platform;
  pathEnv?: string;
  isExecutable?: (path: string) => boolean;
};

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function playersFor(platform: NodeJS.Platform): AudioPlayer[] {
  if (platform === "darwin") return DARWIN_PLAYERS;
  if (platform === "win32") return WINDOWS_PLAYERS;
  return LINUX_PLAYERS;
}

function fallbackDirs(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return [];
  if (platform === "darwin") return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const home = process.env.HOME ?? homedir();
  const user = process.env.USER;
  return [
    "/run/current-system/sw/bin",
    join(home, ".nix-profile", "bin"),
    ...(user ? [`/etc/profiles/per-user/${user}/bin`] : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

/** Absolute path of the preferred installed WAV player, if any. */
export function findAudioPlayer(options: AudioPlayerLookup = {}): AudioPlayer | undefined {
  const platform = options.platform ?? process.platform;
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const dirs = new Set<string>();

  for (const dir of pathEnv.split(platform === "win32" ? ";" : ":")) {
    if (isAbsolute(dir)) dirs.add(dir);
  }
  for (const dir of fallbackDirs(platform)) dirs.add(dir);

  for (const player of playersFor(platform)) {
    for (const dir of dirs) {
      const command = join(dir, player.command);
      if (isExecutable(command)) return { ...player, command };
    }
  }
  return undefined;
}

function noPlayerMessage(): string {
  if (process.platform === "darwin") return "No WAV audio player found. afplay ships with macOS.";
  if (process.platform === "win32") return "No WAV audio player found. Install ffplay or enable PowerShell.";
  return "No WAV audio player found. Install pw-play, paplay, aplay, ffplay, or mpv.";
}

export async function playWav(path: string): Promise<void> {
  const player = findAudioPlayer();
  if (!player) throw new Error(noPlayerMessage());
  await execFileAsync(player.command, player.args(path), { timeout: AUDIO_PLAYBACK_TIMEOUT_MS });
}

export interface QueueItem {
  play: () => Promise<void>;
}

export interface AudioQueue {
  enqueue(item: QueueItem): void;
  readonly size: number;
  readonly playing: boolean;
}

export function createAudioQueue(): AudioQueue {
  const queue: QueueItem[] = [];
  let playing = false;

  function drain(): void {
    if (playing) return;
    const item = queue.shift();
    if (!item) return;
    playing = true;
    item
      .play()
      .catch(() => {})
      .finally(() => {
        playing = false;
        drain();
      });
  }

  return {
    enqueue(item: QueueItem) {
      queue.push(item);
      drain();
    },
    get size() {
      return queue.length;
    },
    get playing() {
      return playing;
    },
  };
}

/** Write a WAV only when playback starts, then remove it. */
export function enqueueWav(
  queue: AudioQueue,
  wav: Buffer,
  onError: (error: unknown) => void,
): void {
  queue.enqueue({
    async play() {
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(tmpdir(), "pi-speak-"));
        const path = join(directory, "speech.wav");
        await writeFile(path, wav);
        await playWav(path);
      } catch (error) {
        onError(error);
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  });
}
