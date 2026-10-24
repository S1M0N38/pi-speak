import { setImmediate } from "node:timers/promises";
import type { PiSpeakSettings } from "./settings.js";
import { KokoroBackend, type SynthesisBackend } from "./synthesis.js";
import { cleanTextForSpeech, splitTextForSpeech } from "./text.js";

const SAMPLE_RATE = 24_000;

export type SynthesizeOptions = {
  signal?: AbortSignal;
  onStatus?: (text: string) => void;
  onChunk: (wav: Buffer) => void;
};

export function float32ToWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const bitsPerSample = 16;
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2);
  }

  return buffer;
}

/** Serializes synthesis jobs so one Kokoro model serves one chunk at a time. */
export class SynthesisService {
  private backend: SynthesisBackend | undefined;
  private tail: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  constructor(private readonly createBackend: () => SynthesisBackend = () => new KokoroBackend()) {}

  synthesize(
    settings: PiSpeakSettings,
    text: string,
    options: SynthesizeOptions,
  ): Promise<void> {
    const run = this.tail.then(() => this.run(settings, text, options));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async run(
    settings: PiSpeakSettings,
    text: string,
    options: SynthesizeOptions,
  ): Promise<void> {
    if (this.shuttingDown) throw new Error("pi-speak is shutting down");

    const chunks = splitTextForSpeech(cleanTextForSpeech(text));
    if (chunks.length === 0) throw new Error("Missing or empty 'text' field");

    const backend = (this.backend ??= this.createBackend());
    options.signal?.throwIfAborted();
    options.onStatus?.("Loading Kokoro model…");
    await backend.load(options.onStatus);
    options.signal?.throwIfAborted();
    options.onStatus?.("Synthesizing…");

    for (const chunk of chunks) {
      options.signal?.throwIfAborted();
      const samples = await backend.synthesize(chunk, settings.voice, settings.speed);
      options.signal?.throwIfAborted();
      options.onChunk(float32ToWav(samples));
      await setImmediate();
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    await this.tail;
    const backend = this.backend;
    this.backend = undefined;
    await backend?.dispose();
  }
}
