import assert from "node:assert/strict";
import test from "node:test";
import { cleanTextForSpeech, splitTextForSpeech } from "../src/text.js";

test("cleanTextForSpeech strips markdown and code fences", () => {
  assert.equal(
    cleanTextForSpeech("# Title\n\nHello **world** with `code` and [a link](https://example.com)."),
    "Title\n\nHello world with code and a link.",
  );
  assert.equal(cleanTextForSpeech("```js\nconsole.log('noise')\n```\nspoken"), "spoken");
  assert.equal(cleanTextForSpeech("- one\n- two\n\n> quote"), "one\ntwo\n\nquote");
  assert.equal(cleanTextForSpeech("![alt](image.png)"), "alt");
  assert.equal(cleanTextForSpeech("  spaced   out  "), "spaced out");
});

test("splitTextForSpeech keeps chunks under the limit", () => {
  assert.deepEqual(splitTextForSpeech("Short sentence."), ["Short sentence."]);

  const text = Array.from({ length: 40 }, (_, index) => `Sentence number ${index}.`).join(" ");
  const chunks = splitTextForSpeech(text, 80);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 80, chunk);

  const longWordSentence = `${"word ".repeat(60)}end.`;
  const longChunks = splitTextForSpeech(longWordSentence, 80);
  assert.ok(longChunks.length > 1);
  for (const chunk of longChunks) assert.ok(chunk.length <= 80, chunk);
});
