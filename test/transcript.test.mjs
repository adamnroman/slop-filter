import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../src/transcript.js';

const { pickExcerpt, OPENING_MS, EXCERPT_WORDS } = globalThis.XAF_TRANSCRIPT;

// One caption event per second, three numbered words each: about 180 words a minute.
const captions = (seconds) => ({
  events: Array.from({ length: seconds }, (_, i) => ({ tStartMs: i * 1000, segs: [{ utf8: `a${i} b${i} c${i}` }] })),
});

test('the excerpt comes from the first minute only', () => {
  const words = pickExcerpt(captions(600), 'abcdefghijk').split(' ');
  assert.equal(words.length, EXCERPT_WORDS);
  const lastAllowed = OPENING_MS / 1000 - 1;
  for (const word of words) assert.ok(Number(word.slice(1)) <= lastAllowed, `${word} is past the first minute`);
});

test('the same video always gets the same section, and videos differ', () => {
  const long = captions(600);
  assert.equal(pickExcerpt(long, 'video-one__'), pickExcerpt(long, 'video-one__'));
  const starts = new Set(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'].map((id) => pickExcerpt(long, id).split(' ')[0]));
  assert.ok(starts.size > 1, 'different videos start at different points');
});

test('a short opening is used whole, and no captions means no text', () => {
  assert.equal(pickExcerpt(captions(20), 'x').split(' ').length, 60);
  assert.equal(pickExcerpt({ events: [] }, 'x'), '');
  assert.equal(pickExcerpt(null, 'x'), '');
  assert.equal(pickExcerpt({ events: [{ tStartMs: 0 }] }, 'x'), '', 'events without text are ignored');
});
