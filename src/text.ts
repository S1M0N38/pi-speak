export const DEFAULT_PREPROCESSING_PROMPT =
  "You are preparing text for a text-to-speech system. " +
  "You will receive a message from a conversation enclosed in quadruple backticks. " +
  "Summarize it in one single very short sentence, two at most. " +
  "Use a dry, matter-of-fact tone. " +
  "Do not use any markdown formatting, just plain text. " +
  "Prefer words over symbols or abbreviations, as this will be read aloud. " +
  "Output only the sentence, nothing else.";

export const SPEED_VALUES = [
  "0.5",
  "0.75",
  "1.0",
  "1.25",
  "1.5",
  "1.75",
  "2.0",
  "2.25",
  "2.5",
  "2.75",
  "3.0",
] as const;

/**
 * Strip markdown syntax so the synthesizer speaks words, not symbols.
 * Fenced code blocks are dropped entirely; inline code keeps its text;
 * links/images keep their label/alt.
 */
export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(/(^|[\s([{])\*\*\*([^*\n]+?)\*\*\*(?=$|[\s.,!?;:)}\]])/g, "$1$2")
    .replace(/(^|[\s([{])\*\*([^*\n]+?)\*\*(?=$|[\s.,!?;:)}\]])/g, "$1$2")
    .replace(/(^|[\s([{])\*([^*\n]+?)\*(?=$|[\s.,!?;:)}\]])/g, "$1$2")
    .replace(/(^|[\s([{])___([^_\n]+?)___(?=$|[\s.,!?;:)}\]])/g, "$1$2")
    .replace(/(^|[\s([{])__([^_\n]+?)__(?=$|[\s.,!?;:)}\]])/g, "$1$2")
    .replace(/(^|[\s([{])_([^_\n]+?)_(?=$|[\s.,!?;:)}\]])/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Kokoro truncates input around 510 tokens, so split cleaned text into
 * sentence-sized chunks. Each chunk stays under `maxChars` when possible.
 */
export function splitTextForSpeech(text: string, maxChars = 240): string[] {
  const sentences = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const push = (piece: string): void => {
    if (current.length > 0 && current.length + piece.length + 1 > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current.length > 0 ? `${current} ${piece}` : piece;
    }
  };

  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      push(sentence);
      continue;
    }
    for (const word of sentence.split(/\s+/)) push(word);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
