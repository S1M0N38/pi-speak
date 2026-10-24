import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_SPEED,
  DEFAULT_VOICE,
  readSettings,
  writeSettings,
} from "../src/settings.js";

async function withAgentDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-speak-settings-"));
  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    await run(directory);
  } finally {
    process.env.PI_CODING_AGENT_DIR = original;
    await rm(directory, { recursive: true, force: true });
  }
}

test("settings default when missing", async () => {
  await withAgentDir(async () => {
    const settings = await readSettings();
    assert.equal(settings.voice, DEFAULT_VOICE);
    assert.equal(settings.speed, DEFAULT_SPEED);
    assert.equal(settings.preprocessingEnabled, undefined);
  });
});

test("settings round-trip atomically", async () => {
  await withAgentDir(async (directory) => {
    await writeSettings({
      voice: "bm_george",
      speed: 1.25,
      preprocessingEnabled: true,
      preprocessingModel: { provider: "openai", id: "gpt-4o-mini" },
      preprocessingPrompt: " Summarize. ",
    });

    const path = join(directory, "pi-speak.json");
    const mode = (await stat(path)).mode & 0o777;
    assert.equal(mode, 0o600);

    const settings = await readSettings();
    assert.deepEqual(settings, {
      voice: "bm_george",
      speed: 1.25,
      preprocessingEnabled: true,
      preprocessingModel: { provider: "openai", id: "gpt-4o-mini" },
      preprocessingPrompt: "Summarize.",
    });
  });
});

test("legacy flat settings keep working", async () => {
  await withAgentDir(async (directory) => {
    await writeFile(
      join(directory, "pi-speak.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "kokoro" },
        voice: "af_bella",
        speed: 9,
        model: { source: "catalog", id: "kokoro-82m", path: "/old/model.onnx" },
        preprocessingEnabled: true,
        preprocessingModel: { provider: "x", id: "y" },
      }),
    );

    const settings = await readSettings();
    assert.deepEqual(settings, {
      voice: "af_bella",
      speed: 3,
      preprocessingEnabled: true,
      preprocessingModel: { provider: "x", id: "y" },
    });
  });
});

test("unknown voice falls back and invalid JSON fails", async () => {
  await withAgentDir(async (directory) => {
    await writeFile(
      join(directory, "pi-speak.json"),
      JSON.stringify({ voice: "zf_invalid", speed: 1 }),
    );
    assert.equal((await readSettings()).voice, DEFAULT_VOICE);

    await writeFile(join(directory, "pi-speak.json"), "{oops");
    await assert.rejects(readSettings(), /Invalid settings/);
  });
});
