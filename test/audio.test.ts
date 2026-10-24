import assert from "node:assert/strict";
import test from "node:test";
import { createAudioQueue, findAudioPlayer } from "../src/audio.js";

test("findAudioPlayer prefers the best player on PATH", () => {
  const player = findAudioPlayer({
    platform: "linux",
    pathEnv: "/nix/store/bin:/custom/bin",
    isExecutable: (path) => path === "/custom/bin/aplay" || path === "/nix/store/bin/pw-play",
  });
  assert.equal(player?.command, "/nix/store/bin/pw-play");
});

test("findAudioPlayer searches fallback directories when PATH is empty", () => {
  const player = findAudioPlayer({
    platform: "darwin",
    pathEnv: "",
    isExecutable: (path) => path === "/usr/bin/afplay",
  });
  assert.equal(player?.command, "/usr/bin/afplay");
});

test("findAudioPlayer returns undefined when nothing is installed", () => {
  assert.equal(
    findAudioPlayer({ platform: "linux", pathEnv: "", isExecutable: () => false }),
    undefined,
  );
});

test("audio queue plays items one at a time", async () => {
  const queue = createAudioQueue();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  queue.enqueue({
    async play() {
      events.push("first");
      await gate;
      events.push("first-done");
    },
  });
  queue.enqueue({
    async play() {
      events.push("second");
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first"]);
  assert.equal(queue.playing, true);
  assert.equal(queue.size, 1);

  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first", "first-done", "second"]);
  assert.equal(queue.playing, false);
});
