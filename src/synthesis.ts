import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { KokoroTTS as KokoroModel } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export type SynthesisBackend = {
  load(onProgress?: (text: string) => void): Promise<void>;
  synthesize(text: string, voice: string, speed: number): Promise<Float32Array>;
  dispose(): Promise<void>;
};

/** Lazily loads kokoro-js and keeps the q4 model in the agent directory. */
export class KokoroBackend implements SynthesisBackend {
  private tts: KokoroModel | undefined;

  async load(onProgress?: (text: string) => void): Promise<void> {
    if (this.tts) return;

    const [{ KokoroTTS }, { env }] = await Promise.all([
      import("kokoro-js"),
      import("@huggingface/transformers"),
    ]);
    env.cacheDir = join(getAgentDir(), "pi-speak-models");

    let lastPercent = -1;
    this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q4",
      device: "cpu",
      progress_callback: (progress) => {
        if (progress.status !== "progress" || !progress.file.endsWith(".onnx")) return;
        const percent = Math.round(progress.progress);
        if (percent === lastPercent) return;
        lastPercent = percent;
        onProgress?.(`Downloading Kokoro model… ${percent}%`);
      },
    });
  }

  async synthesize(text: string, voice: string, speed: number): Promise<Float32Array> {
    const tts = this.tts;
    if (!tts) throw new Error("Kokoro model is not loaded");
    const result = await tts.generate(text, {
      voice: voice as keyof KokoroModel["voices"],
      speed,
    });
    return result.audio as Float32Array;
  }

  async dispose(): Promise<void> {
    const tts = this.tts;
    this.tts = undefined;
    await tts?.model.dispose();
  }
}
