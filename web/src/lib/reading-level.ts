// How much detail the reader wants. "simple" is for someone who wants the
// gist in short sentences, "standard" is the default, "detailed" shows the
// numbers and the medical names. Stored per device only.

export type ReadingLevel = "simple" | "standard" | "detailed";

export const READING_LEVELS: { id: ReadingLevel; label: string; blurb: string }[] = [
  { id: "simple", label: "Simply", blurb: "Short sentences, no numbers" },
  { id: "standard", label: "Normally", blurb: "Plain English with the key numbers" },
  { id: "detailed", label: "In detail", blurb: "Every measurement and the medical names" },
];

const KEY = "kindred.readingLevel";

export function loadReadingLevel(): ReadingLevel {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    return v === "simple" || v === "detailed" ? v : "standard";
  } catch {
    return "standard";
  }
}

export function saveReadingLevel(level: ReadingLevel) {
  try {
    window.localStorage.setItem(KEY, level);
  } catch {
    /* private mode or blocked storage: keep the in-memory value */
  }
}
