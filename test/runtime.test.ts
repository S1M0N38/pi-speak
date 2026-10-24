import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext, ModelRegistry, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AudioQueue, QueueItem } from "../src/audio.js";
import { createPiSpeakRuntime } from "../src/runtime.js";
import type { PiSpeakSettings } from "../src/settings.js";
import type { SynthesisService } from "../src/synthesis-service.js";

type Notification = { message: string; level: string };

function assistantEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: "entry",
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-responses",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

function createHarness(options: {
  text?: string;
  model?: unknown;
  modelRegistry?: Partial<ModelRegistry>;
}) {
  const notifications: Notification[] = [];
  const chunks: Buffer[] = [];
  const synthesisCalls: Array<{ settings: PiSpeakSettings; text: string }> = [];
  const queueItems: QueueItem[] = [];

  const service = {
    async synthesize(settings: PiSpeakSettings, text: string, synthOptions: { onChunk: (wav: Buffer) => void }) {
      synthesisCalls.push({ settings, text });
      synthOptions.onChunk(Buffer.from("wav"));
    },
    async shutdown() {},
  } as unknown as SynthesisService;

  const audioQueue = {
    enqueue(item: QueueItem) {
      queueItems.push(item);
    },
    size: 0,
    playing: false,
  } as AudioQueue;

  const modelRegistry = {
    find: () => undefined,
    complete: async () => ({
      role: "assistant",
      content: [],
      stopReason: "stop",
      usage: { input: 0, output: 0 },
    }),
    getAvailable: () => [],
    ...options.modelRegistry,
  } as unknown as ModelRegistry;

  const ctx = {
    hasUI: false,
    ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
    sessionManager: {
      getBranch: () => [assistantEntry(options.text ?? "raw message")],
      getSessionId: () => "test-session",
    },
    model: options.model,
    modelRegistry,
    signal: undefined,
  } as unknown as ExtensionContext;

  const runtime = createPiSpeakRuntime({ service, audioQueue });
  return { runtime, ctx, notifications, chunks, synthesisCalls, queueItems, modelRegistry };
}

async function withAgentDir(run: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-speak-runtime-"));
  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    await run();
  } finally {
    process.env.PI_CODING_AGENT_DIR = original;
    await rm(directory, { recursive: true, force: true });
  }
}

test("shortcut speaks the last assistant message verbatim", async () => {
  await withAgentDir(async () => {
    const { runtime, ctx, notifications, synthesisCalls, queueItems } = createHarness({
      text: "the last message",
    });
    await runtime.speakLastMessage(ctx);

    assert.equal(synthesisCalls.length, 1);
    assert.equal(synthesisCalls[0]?.text, "the last message");
    assert.equal(queueItems.length, 1);
    assert.equal(notifications.at(-1)?.level, "info");
  });
});

test("preprocessing summarizes with the configured model", async () => {
  await withAgentDir(async () => {
    await writeFile(
      join(process.env.PI_CODING_AGENT_DIR!, "pi-speak.json"),
      JSON.stringify({
        voice: "af_heart",
        speed: 1,
        preprocessingEnabled: true,
        preprocessingModel: { provider: "test", id: "fast" },
        preprocessingPrompt: "Be brief.",
      }),
    );

    let completeInput: { systemPrompt?: string; text?: string } = {};
    const model = { provider: "test", id: "fast" };
    const { runtime, ctx, synthesisCalls, notifications } = createHarness({
      text: "raw message",
      modelRegistry: {
        find: () => model as never,
        complete: (async (_model: unknown, context: { systemPrompt?: string; messages: Array<{ content: Array<{ text: string }> }> }) => {
          completeInput = {
            systemPrompt: context.systemPrompt,
            text: context.messages[0]?.content[0]?.text,
          };
          return {
            role: "assistant",
            content: [{ type: "text", text: "a short summary" }],
            stopReason: "stop",
            usage: { input: 0, output: 0 },
          };
        }) as never,
      },
    });

    await runtime.speakLastMessage(ctx);

    assert.equal(completeInput.systemPrompt, "Be brief.");
    assert.equal(completeInput.text, `""""\nraw message\n""""`);
    assert.equal(synthesisCalls[0]?.text, "a short summary");
    assert.equal(notifications.at(-1)?.level, "info");
  });
});

test("preprocessing falls back to the active model when the configured one is gone", async () => {
  await withAgentDir(async () => {
    await writeFile(
      join(process.env.PI_CODING_AGENT_DIR!, "pi-speak.json"),
      JSON.stringify({
        voice: "af_heart",
        speed: 1,
        preprocessingEnabled: true,
        preprocessingModel: { provider: "gone", id: "model" },
      }),
    );

    const active = { provider: "active", id: "current" };
    let usedModel: unknown;
    const { runtime, ctx, synthesisCalls } = createHarness({
      text: "raw message",
      model: active,
      modelRegistry: {
        find: () => undefined,
        complete: (async (model: unknown) => {
          usedModel = model;
          return {
            role: "assistant",
            content: [{ type: "text", text: "a short summary" }],
            stopReason: "stop",
            usage: { input: 0, output: 0 },
          };
        }) as never,
      },
    });

    await runtime.speakLastMessage(ctx);

    assert.equal(usedModel, active);
    assert.equal(synthesisCalls[0]?.text, "a short summary");
  });
});

test("preprocessing without a model fails loudly and plays nothing", async () => {
  await withAgentDir(async () => {
    await writeFile(
      join(process.env.PI_CODING_AGENT_DIR!, "pi-speak.json"),
      JSON.stringify({ voice: "af_heart", speed: 1, preprocessingEnabled: true }),
    );

    const { runtime, ctx, synthesisCalls, notifications } = createHarness({
      text: "raw message",
    });
    await runtime.speakLastMessage(ctx);

    assert.equal(synthesisCalls.length, 0);
    assert.equal(notifications.at(-1)?.level, "error");
    assert.match(notifications.at(-1)?.message ?? "", /No active model/);
  });
});
