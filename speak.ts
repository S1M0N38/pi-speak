import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { playersFor } from "./players.ts";

export const MAX_TEXT_LENGTH = 4000;

const MIN_PTTS_VERSION = [0, 5, 0] as const;
const PTTS_VERSION_PATTERN = /^ptts\s+(\d+)\.(\d+)\.(\d+)/;
const STDERR_TAIL_LENGTH = 500;
const STDERR_MAX_BUFFER = 1024 * 1024;

const MISSING_PTTS_MESSAGE =
  "ptts not found on PATH. Install it with: brew install gradium-ai/tap/ptts (macOS) or uv tool install ptts.";

export class SpeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NoPttsError extends SpeakError {}

export class NoPlayerError extends SpeakError {}

export class SynthesisError extends SpeakError {}

export class PlaybackError extends SpeakError {}

export class CancelledError extends SpeakError {
  constructor() {
    super("Speech cancelled.");
  }
}

export class EmptyTextError extends SpeakError {
  constructor() {
    super("No text to speak.");
  }
}

export class TextTooLongError extends SpeakError {
  constructor(length: number) {
    super(`Text is ${length} characters; the limit is ${MAX_TEXT_LENGTH}. Summarize it first.`);
  }
}

export interface SpeakOptions {
  signal?: AbortSignal;
}

/** Speak `text` and resolve only after playback has finished. */
export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const { signal } = options;

  if (text.trim().length === 0) throw new EmptyTextError();
  if (text.length > MAX_TEXT_LENGTH) throw new TextTooLongError(text.length);

  await ensurePtts(signal);
  throwIfCancelled(signal);

  const directory = await mkdtemp(join(tmpdir(), "pi-speak-"));
  try {
    const wavPath = join(directory, "speech.wav");
    await synthesise(text, wavPath, signal);
    await play(wavPath, signal);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

let pttsCheck: { path: string; result: Promise<void> } | undefined;

// The check is memoised per PATH so a session spawns `ptts --version` once while
// still noticing a subtree that changed underneath it, as tests do.
function ensurePtts(signal: AbortSignal | undefined): Promise<void> {
  const path = process.env.PATH ?? "";
  if (pttsCheck?.path === path) return pttsCheck.result;

  const entry = { path, result: checkPtts(signal) };
  pttsCheck = entry;
  entry.result.catch(() => {
    if (pttsCheck === entry) pttsCheck = undefined;
  });
  return entry.result;
}

async function checkPtts(signal: AbortSignal | undefined): Promise<void> {
  throwIfCancelled(signal);

  const outcome = await run("ptts", ["--version"], { signal });
  if (outcome.kind === "cancelled") throw new CancelledError();
  if (outcome.kind !== "ok") throw new NoPttsError(MISSING_PTTS_MESSAGE);

  const match = PTTS_VERSION_PATTERN.exec(outcome.stdout.trim());
  if (!match) throw new NoPttsError(MISSING_PTTS_MESSAGE);

  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (compareVersions(version, MIN_PTTS_VERSION) < 0) {
    throw new NoPttsError(`ptts 0.5.0 or newer is required (found ${version.join(".")}).`);
  }
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function synthesise(
  text: string,
  wavPath: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const outcome = await run(
    "ptts",
    [
      "--device",
      "cpu",
      "--threads",
      "4",
      "--lang",
      "en",
      "--quant",
      "q4k",
      "--voice",
      "Easton",
      "--rewrites",
      "all",
      "--output",
      wavPath,
      "--",
      text,
    ],
    {
      signal,
      env: { ...process.env, RUST_LOG: "error" },
      maxBuffer: STDERR_MAX_BUFFER,
    },
  );

  if (outcome.kind === "ok") return;
  if (outcome.kind === "cancelled") throw new CancelledError();
  if (outcome.kind === "missing") throw new NoPttsError(MISSING_PTTS_MESSAGE);
  throw new SynthesisError(failureMessage("ptts failed", outcome.code, outcome.stderr));
}

async function play(wavPath: string, signal: AbortSignal | undefined): Promise<void> {
  const platform = process.platform;
  const candidates = playersFor(platform, wavPath);

  for (const candidate of candidates) {
    throwIfCancelled(signal);

    const outcome = await run(candidate.command, candidate.args, { signal });
    if (outcome.kind === "ok") return;
    if (outcome.kind === "cancelled") throw new CancelledError();
    if (outcome.kind === "missing") continue;
    throw new PlaybackError(failureMessage("Audio playback failed", outcome.code, outcome.stderr));
  }

  throw new NoPlayerError(noPlayerMessage(platform));
}

function noPlayerMessage(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "No audio player found. afplay should be available on macOS.";
    case "linux":
      return "No audio player found. Install pw-play, paplay, or aplay.";
    case "win32":
      return "No audio player found. PowerShell is required.";
    default:
      return `No audio player found for ${platform}.`;
  }
}

function failureMessage(prefix: string, code: string | number | null, stderr: string): string {
  const status = `exit ${code ?? "unknown"}`;
  const tail = stderrTail(stderr);
  return tail.length > 0 ? `${prefix} (${status}): ${tail}` : `${prefix} (${status}).`;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError();
}

type RunOutcome =
  | { kind: "ok"; stdout: string }
  | { kind: "missing" }
  | { kind: "cancelled" }
  | { kind: "failed"; code: string | number | null; stderr: string };

interface RunOptions {
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunOutcome> {
  throwIfCancelled(options.signal);

  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 64 * 1024,
        ...(options.env ? { env: options.env } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ kind: "ok", stdout });

        const failure = error as NodeJS.ErrnoException & {
          code?: string | number;
          signal?: string | null;
        };

        if (failure.code === "ABORT_ERR" || options.signal?.aborted) {
          return resolve({ kind: "cancelled" });
        }
        if (failure.code === "ENOENT") return resolve({ kind: "missing" });

        resolve({
          kind: "failed",
          code: typeof failure.code === "number" ? failure.code : (failure.signal ?? null),
          stderr: stderr || failure.message,
        });
      },
    );
  });
}

function stderrTail(stderr: string): string {
  return stripAnsi(stderr).trim().slice(-STDERR_TAIL_LENGTH);
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}
