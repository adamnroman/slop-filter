// Picks the excerpt of a video's captions that gets scored. Pure logic with no DOM, so
// the tests import it too. Attaches to globalThis because content scripts are classic
// scripts.
(() => {
  // Only the first minute is considered. That is where a viewer decides to stay, and it
  // holds about 150 spoken words, enough to judge cadence.
  const OPENING_MS = 60 * 1000;
  const EXCERPT_WORDS = 150;

  // Small stable hash, so "random" means the same section every time for one video.
  // A verdict that changed on every reload could not be cached, labeled, or fitted.
  function seedFrom(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // `captions` is YouTube's json3 format: { events: [{ tStartMs, segs: [{ utf8 }] }] }.
  function openingWords(captions) {
    return (captions?.events ?? [])
      .filter((event) => event.segs && event.tStartMs < OPENING_MS)
      .map((event) => event.segs.map((seg) => seg.utf8).join(''))
      .join(' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  // A window of EXCERPT_WORDS from the opening, at a position picked by the seed. A
  // short opening is used whole.
  function pickExcerpt(captions, seedText) {
    const words = openingWords(captions);
    const lastStart = Math.max(0, words.length - EXCERPT_WORDS);
    const start = lastStart === 0 ? 0 : seedFrom(seedText) % (lastStart + 1);
    return words.slice(start, start + EXCERPT_WORDS).join(' ');
  }

  globalThis.XAF_TRANSCRIPT = Object.freeze({ pickExcerpt, OPENING_MS, EXCERPT_WORDS });
})();
