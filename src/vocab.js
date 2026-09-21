// Words and phrases that mark machine prose, in three tiers with their own counting rules.
// The tiers and the entries come from the "Words and phrases to replace" tables of the
// unpolish-ai-writing skill (MIT, github.com/wilu222/unpolish-ai-writing). Only the tells
// are kept. This is a classifier, so there are no replacements.
//
// Entries that are only a tell in one sense ("quietly" as significance paint, "landscape"
// as a metaphor, "robust" as filler, "lands" for a launch) are NOT here. Code cannot tell
// the senses apart, and counting every use would flag normal writing. Those go to Jev as
// examples in the `paint_words` question in model.js.

// Each entry is a regex source that also matches the inflected forms.
const ALWAYS = [
  'delv(?:e|es|ed|ing)', 'div(?:e|es|ed|ing) deep', 'deep div(?:e|es)', 'tapestr(?:y|ies)',
  'embark(?:s|ed|ing)?', 'leverag(?:e|es|ed|ing)', 'utili[sz](?:e|es|ed|ing)', 'seamless(?:ly)?',
  'nestled', 'showcas(?:e|es|ed|ing)', 'testament to', 'game[- ]chang(?:er|ers|ing)',
  'groundbreaking', 'revolutionary', 'cutting[- ]edge', 'in order to', 'serv(?:es|ed|ing)? as',
  'stand(?:s|ing)? as', 'moreover', 'furthermore', 'additionally', 'at its core',
  "it(?:'|’)?s important to note", 'amidst', 'load[- ]bearing', 'realms?',
  'meticulous(?:ly)?', 'intricate', 'intricac(?:y|ies)', 'ever[- ]evolving', 'impactful',
  'paradigms?', 'comprehensive', 'pivotal', 'underscor(?:e|es|ed|ing)', 'unpack(?:s|ed|ing)?',
  'holistic', 'actionable', 'synerg(?:y|ies)',
];

// A tell only when two or more sit together.
const CLUSTER = [
  'harness(?:es|ed|ing)?', 'foster(?:s|ed|ing)?', 'streamlin(?:e|es|ed|ing)',
  'empower(?:s|ed|ing)?', 'crucial', 'myriad', 'plethora', 'facilitat(?:e|es|ed|ing)',
  'enhanc(?:e|es|ed|ing)', 'resonat(?:e|es|ed|ing)',
];

// A tell only when the text is soaked in them.
const DENSITY = ['significant(?:ly)?', 'innovative', 'compelling', 'remarkable', 'noteworthy', 'interesting'];

const CLUSTER_MIN_HITS = 2;
const DENSITY_MIN_HITS = 2;
// "Soaked" is about 3% of the words.
const DENSITY_SOAKED_SHARE = 0.03;
// One always-tier word is a nudge. Two is the full signal. A pile of tells, not one hit.
const ALWAYS_FULL_HITS = 2;

const matcher = (sources) => new RegExp(`\\b(?:${sources.join('|')})\\b`, 'gi');
const TIER = Object.freeze({ ALWAYS: matcher(ALWAYS), CLUSTER: matcher(CLUSTER), DENSITY: matcher(DENSITY) });

const hits = (text, regex) => (text.match(regex) ?? []).length;
const wordCount = (text) => (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

// Each feature lands on 0..1.
export const VOCAB_FEATURES = Object.freeze({
  vocab_always: (text) => Math.min(1, hits(text, TIER.ALWAYS) / ALWAYS_FULL_HITS),
  vocab_cluster: (text) => (hits(text, TIER.CLUSTER) >= CLUSTER_MIN_HITS ? 1 : 0),
  vocab_density: (text) => {
    const count = hits(text, TIER.DENSITY);
    if (count < DENSITY_MIN_HITS) return 0;
    return Math.min(1, count / Math.max(1, wordCount(text)) / DENSITY_SOAKED_SHARE);
  },
});
