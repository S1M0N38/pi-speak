import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piSpeak from "../index.ts";
import { CancelledError, NoPlayerError, NoPttsError } from "../speak.ts";

interface Notification {
  message: string;
  level: string;
}

interface FakeContext {
  ui: { notify: (message: string, level: string) => void };
}

interface ToolResult {
  content: { type: string; text: string }[];
  details: unknown;
}

interface SpeakTool {
  execute(
    toolCallId: string,
    params: { text: string },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: FakeContext,
  ): Promise<ToolResult>;
}

// Capture the tool the adapter registers so the notification path is covered.
function captureTool(): SpeakTool {
  let captured: SpeakTool | undefined;
  const fakePi = {
    registerTool: (tool: SpeakTool) => {
      captured = tool;
    },
  } as unknown as ExtensionAPI;

  piSpeak(fakePi);
  assert.ok(captured, "speak tool was registered");
  return captured;
}

function fakeContext(): { ctx: FakeContext; notifications: Notification[] } {
  const notifications: Notification[] = [];
  const ctx: FakeContext = {
    ui: {
      notify: (message, level) => {
        notifications.push({ message, level });
      },
    },
  };
  return { ctx, notifications };
}

async function speechTempDirs(): Promise<string[]> {
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("pi-speak-"))
    .map((entry) => entry.name)
    .sort();
}

const tool = captureTool();

test("happy path speaks, blocks until playback ends, and cleans up", async () => {
  const { ctx, notifications } = fakeContext();
  const before = await speechTempDirs();

  const startedAt = Date.now();
  const result = await tool.execute(
    "call-happy",
    { text: "This is pi-speak playing a short sentence out loud from a test." },
    undefined,
    undefined,
    ctx,
  );
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(result.content, [{ type: "text", text: "Spoken." }]);
  assert.equal(result.details, undefined);
  assert.ok(elapsed >= 1500, `expected blocking playback (took ${elapsed} ms)`);
  assert.deepEqual(notifications, []);
  assert.deepEqual(await speechTempDirs(), before);
});

test("abort during playback fails with CancelledError and cleans up", async () => {
  const { ctx, notifications } = fakeContext();
  const before = await speechTempDirs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    await assert.rejects(
      tool.execute(
        "call-abort",
        {
          text:
            "This sentence is long enough to keep the player busy for several seconds, " +
            "which gives the abort signal time to interrupt playback halfway through.",
        },
        controller.signal,
        undefined,
        ctx,
      ),
      CancelledError,
    );
  } finally {
    clearTimeout(timer);
  }

  assert.deepEqual(notifications, []);
  assert.deepEqual(await speechTempDirs(), before);
});

test("missing ptts notifies once and leaves no temp directory", async () => {
  const { ctx, notifications } = fakeContext();
  const before = await speechTempDirs();
  const emptyBin = await mkdtemp(join(tmpdir(), "pi-speak-empty-bin-"));
  const originalPath = process.env.PATH;

  try {
    process.env.PATH = emptyBin;
    await assert.rejects(
      tool.execute("call-no-ptts", { text: "This should never be synthesised." }, undefined, undefined, ctx),
      (error: unknown) =>
        error instanceof NoPttsError && /ptts not found on PATH/.test(error.message),
    );
  } finally {
    process.env.PATH = originalPath;
    await rm(emptyBin, { recursive: true, force: true });
  }

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.level, "error");
  assert.deepEqual(await speechTempDirs(), before);
});

test("missing player notifies once and leaves no temp directory", async () => {
  const { ctx, notifications } = fakeContext();
  const before = await speechTempDirs();
  const pttsPath = execFileSync("sh", ["-c", "command -v ptts"], { encoding: "utf8" }).trim();
  const binDir = await mkdtemp(join(tmpdir(), "pi-speak-ptts-only-"));
  const originalPath = process.env.PATH;

  try {
    await symlink(pttsPath, join(binDir, "ptts"));
    process.env.PATH = binDir;
    await assert.rejects(
      tool.execute("call-no-player", { text: "This should be synthesised but not played." }, undefined, undefined, ctx),
      (error: unknown) =>
        error instanceof NoPlayerError && /No audio player found/.test(error.message),
    );
  } finally {
    process.env.PATH = originalPath;
    await rm(binDir, { recursive: true, force: true });
  }

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.level, "error");
  assert.deepEqual(await speechTempDirs(), before);
});
