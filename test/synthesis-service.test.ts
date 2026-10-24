import assert from "node:assert/strict";
import test from "node:test";
import type { SynthesisBackend } from "../src/synthesis.js";
import { SynthesisService, float32ToWav } from "../src/synthesis-service.js";
import type { PiSpeakSettings } from "../src/settings.js";

const settings: PiSpeakSettings = { voice: "af_heart", speed: 1 };

type Harness = {
  service: SynthesisService;
  calls: string[];
  chunks: Buffer[];
};

function harness(
  options: { gate?: Promise<void>; samples?: Float32Array } = {},
): Harness {
  const calls: string[] = [];
  const chunks: Buffer[] = [];
  const backend: SynthesisBackend = {
    async load(onProgress) {
      onProgress?.("loaded");
    },
    async synthesize(text) {
      calls.push(text);
      await options.gate;
      return options.samples ?? new Float32Array([0, 0.5, -0.5]);
    },
    async dispose() {
      calls.push("dispose");
    },
  };
  return { service: new SynthesisService(() => backend), calls, chunks };
}

test("float32ToWav writes a valid mono 24 kHz header", () => {
  const wav = float32ToWav(new Float32Array([0, 0.5, -0.5]));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.length, 50);
});

test("synthesis chunks text and yields one WAV per chunk", async () => {
  const { service, calls, chunks } = harness();
  await service.synthesize(
    settings,
    Array.from({ length: 30 }, (_, index) => `Sentence ${index}.`).join(" "),
    { onChunk: (wav) => chunks.push(wav) },
  );

  assert.ok(calls.length > 1);
  assert.equal(chunks.length, calls.length);
  for (const wav of chunks) assert.equal(wav.toString("ascii", 0, 4), "RIFF");
});

test("synthesis serializes overlapping jobs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { service, calls, chunks } = harness({ gate });

  const first = service.synthesize(settings, "first", { onChunk: (wav) => chunks.push(wav) });
  const second = service.synthesize(settings, "second", { onChunk: (wav) => chunks.push(wav) });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["first"]);

  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(chunks.length, 2);
});

test("shutdown waits for active work and disposes the backend", async () => {
  const { service, calls } = harness();
  await service.synthesize(settings, "hello", { onChunk: () => {} });
  await service.shutdown();
  assert.equal(calls.at(-1), "dispose");
  await assert.rejects(
    service.synthesize(settings, "after", { onChunk: () => {} }),
    /shutting down/,
  );
});
