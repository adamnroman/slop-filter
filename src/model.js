// The judgments Jev makes about a post, and how code turns them into one probability.
// Pure module: no chrome APIs, so the Node scripts import it too.
//
// The rules judge cadence and prose, not meaning. A person can be generic, restate the
// post they answer, or say nothing new, and that is human slop, not AI. What gives a model
// away is how it writes: staged pivots, manufactured rhythm, significance paint, tidy bows.
//
// The tells, their examples, and the word tiers in vocab.js come from the
// unpolish-ai-writing skill (MIT, github.com/wilu222/unpolish-ai-writing): its three
// buckets (assistant residue, false profundity, machine cadence) and its word tables.
// The last group, circumvention, is ours: what a model does when told to avoid the
// well-known tells.
import { VOCAB_FEATURES } from './vocab.js';

// Pinned, not an alias: fitted weights and the threshold are tied to one model version.
export const JEV_MODEL = 'jev-1.13.0';
// Jev bills input tokens only. Output tokens are free. Price for the pinned model.
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042;

export function requestCostUsd(inputTokens) {
  return (inputTokens / 1_000_000) * JEV_USD_PER_MILLION_INPUT_TOKENS;
}

const TYPE = Object.freeze({ NOUL: 'noul', SCORE: 'score' });

// Each question is one narrow, literal judgment. Jev reads the words as written, so
// every instruction names the exact pattern and gives examples of it.
// Score levels run from least to most AI-like, so every feature points the same way.
// A question with `needsParent: true` is only asked when the replied-to post is known.
export const QUESTIONS = Object.freeze({
  // The one overall read, about how the text is written and nothing else.
  reads_as_model: {
    type: TYPE.NOUL,
    instructions:
      'Judging only how `post.text` is written, not what it says: does its prose read like a language model wrote it?',
    criteria: {
      true: 'Smooth and evenly paced, with staged pivots, an assistant-like tone, and tidy structure in a place where people write casually.',
      false: 'Reads typed by a person: uneven rhythm, loose punctuation, abrupt turns, repeated words, or sentences that trail off. Being generic, unoriginal, or repetitive does not make it true.',
    },
  },

  // Bucket A: assistant residue.
  assistant_residue: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` contain chatbot leftovers, such as 'Certainly!', 'Happy to help!', 'Hope this helps!', 'As an AI', 'I should be clear that', or a line that narrates its own drafting?",
  },
  sycophantic_opener: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` open with flattery or a praise loop before saying anything of its own, such as 'Great question', 'Love this', 'What a fantastic breakdown', or 'This is such an important point'?",
  },
  not_x_but_y: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` use a not-X-it's-Y pivot or stacked negations, such as \"It's not X, it's Y\", \"This isn't about X. It's about Y.\", or \"Not A. Not B. Just C.\"?",
  },

  // Bucket B: false profundity.
  invented_label: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` coin a concept label and use it as if it were established, such as 'the X paradox', 'the X trap', 'the X creep', 'the X tax', or 'the X gap'?",
  },
  stakes_inflation: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` frame something small as enormous, such as 'this changes everything', 'the future of work', or a minor update described as a turning point for an industry?",
  },
  vague_authority: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` lean on unnamed authorities, such as 'experts say', 'studies show', 'research suggests', or 'many believe', without naming who?",
  },
  parallel_triad: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` contain three items in a row that share the same grammatical skeleton, such as three short clauses, three verb phrases, or three \"It's X\" beats?",
    criteria: {
      true: "Three parallel beats built for rhythm, such as 'Ship faster. Learn faster. Win faster.' or 'It saves time, cuts cost, and builds trust.'",
      false: 'No such triple, or a plain inventory of nouns, such as a shopping list or a list of ingredients.',
    },
  },
  verbless_fragments: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` use noun or adjective fragments in place of full sentences, with no subject and no verb, such as 'Less busywork. More impact.' or 'Porcelain-enameled kettle.'?",
  },
  uniform_cadence: {
    type: TYPE.SCORE,
    instructions: 'How uniform and scripted is the sentence rhythm of `post.text`?',
    criteria: [
      'Uneven: a mix of long and short sentences, run-ons, loose fragments, or typos.',
      'Mostly natural, with some variety in length and structure.',
      'Even: sentences of similar length with clean, consistent grammar.',
      'Scripted: every sentence is a similar length and shape, with parallel structure so clean it reads rehearsed in a casual setting.',
    ],
  },

  // Bucket C: machine cadence.
  synonym_cycling: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` rotate through synonyms for the same thing instead of repeating the clearest word, such as 'developers... engineers... practitioners... builders'?",
  },
  manufactured_punchlines: {
    type: TYPE.NOUL,
    instructions:
      'Does `post.text` contain three or more same-shaped short beats in a row, such as standalone micro-sentences or one-line paragraphs stacked for dramatic rhythm?',
  },
  subject_drop: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` recap events in clauses with the first-person subject missing, such as 'Made the call. Fixed the bug. Went home.'?",
  },
  bow_tie_closer: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` end on a signposted wrap-up or a tidy bow, such as 'In conclusion', 'At the end of the day', \"That's it. That's the post.\", \"That's the update.\", or an empty tail like 'and that matters'?",
  },
  paint_words: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` use significance paint or promotional filler: words that add importance and no information, such as 'quietly' changing something, 'deeply' integrated, 'fundamentally', 'remarkably', 'genuinely', a 'landscape' of something, 'robust', or something that 'landed'?",
    criteria: {
      true: 'At least one such word is used for emphasis or as a metaphor, and the sentence would say the same thing without it.',
      false: 'None are present, or each is literal, such as a robust test suite in a technical sense, a plane that landed, or a painted landscape.',
    },
  },

  // Circumvention: what a model does when told to avoid the well-known tells.
  colon_semicolon_pivot: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` use a colon or a semicolon to stage a reveal or to join two clauses, where an em dash would otherwise go, such as \"Here's the thing: it works\", 'The result: fewer bugs', or 'Speed is easy; trust is hard'?",
    criteria: {
      true: 'A colon or semicolon does rhetorical work between clauses. People rarely punctuate casual posts this way.',
      false: 'No colon or semicolon, or only ordinary uses: a time, a ratio, a URL, an emoticon, a label before a link, or a colon before a list of items.',
    },
  },
  performed_casualness: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` bolt casual markers onto otherwise polished, structured prose, such as a lone 'lol', 'tbh', or 'ngl', all-lowercase text with flawless punctuation and parallel structure, or an emoji dropped at the end of a formal sentence?",
  },
});

// Patterns code can detect exactly stay in code. Every value lands on 0..1.
const COLON_PIVOT = /[\p{L}\p{N})"'’]:\s+\p{L}/gu;
const COLON_FULL_HITS = 2;
const CODE_FEATURES = Object.freeze({
  // The em-dash habit.
  em_dash: (text) => (text.includes('—') ? 1 : 0),
  // The dodges: a spaced hyphen or double hyphen standing in for the em dash, and the
  // colon or semicolon doing its job.
  spaced_hyphen_dash: (text) => (/\p{L}\s(?:-|--|–)\s\p{L}/u.test(text) ? 1 : 0),
  semicolon: (text) => (/\p{L};\s/u.test(text) ? 1 : 0),
  colon_clauses: (text) => Math.min(1, (text.match(COLON_PIVOT) ?? []).length / COLON_FULL_HITS),
  // Quotes pasted from a chat window. Weak: phones type curly quotes by default.
  curly_quotes: (text) => (/[‘’“”]/.test(text) ? 1 : 0),
  ...VOCAB_FEATURES,
});

// Hand-set starting point. Replace with the output of scripts/fit.mjs once labels exist.
export const DEFAULT_WEIGHTS = Object.freeze({
  bias: -5.0,
  w: Object.freeze({
    reads_as_model: 2.5,
    assistant_residue: 2.0,
    sycophantic_opener: 0.8,
    not_x_but_y: 1.6,
    invented_label: 0.9,
    stakes_inflation: 0.8,
    vague_authority: 0.5,
    parallel_triad: 0.8,
    verbless_fragments: 0.8,
    uniform_cadence: 1.2,
    synonym_cycling: 0.6,
    manufactured_punchlines: 1.0,
    subject_drop: 0.2,
    bow_tie_closer: 0.9,
    paint_words: 1.0,
    colon_semicolon_pivot: 0.9,
    performed_casualness: 0.8,
    em_dash: 0.8,
    spaced_hyphen_dash: 0.3,
    semicolon: 0.6,
    colon_clauses: 0.5,
    curly_quotes: 0.15,
    vocab_always: 1.0,
    vocab_cluster: 0.7,
    vocab_density: 0.5,
  }),
});

export function buildQuestions(post) {
  const questions = {};
  for (const [id, { needsParent, ...question }] of Object.entries(QUESTIONS)) {
    if (needsParent && !post.parentText) continue;
    questions[id] = question;
  }
  return questions;
}

const asksAboutParent = (post) =>
  Boolean(post.parentText) && Object.values(QUESTIONS).some((question) => question.needsParent);

// Only what the questions need. Text that no question looks at costs tokens and accuracy,
// so the replied-to post is left out unless a question asks about it.
export function buildState(post) {
  const state = { post: { text: post.text } };
  if (asksAboutParent(post)) state.parent = { text: post.parentText };
  return state;
}

function readAnswer(question, answer) {
  if (!answer) return 0;
  if (question.type === TYPE.NOUL) return answer.noul;
  return answer.score / (question.criteria.length - 1);
}

// Every feature lands on 0..1. Questions that were not asked read as 0.
export function featureVector(answers, post) {
  const features = {};
  for (const [id, question] of Object.entries(QUESTIONS)) {
    features[id] = readAnswer(question, answers[id]);
  }
  for (const [id, detect] of Object.entries(CODE_FEATURES)) {
    features[id] = detect(post.text);
  }
  return features;
}

// Why a post got its score: every feature's pull on it, strongest first.
// `askedIds` are the questions that were sent. A reply-only question that was not sent
// reads as 0, and the breakdown says so instead of showing it as a "no".
export function explain(features, weights = DEFAULT_WEIGHTS, askedIds = Object.keys(QUESTIONS)) {
  const asked = new Set(askedIds);
  const rows = Object.entries(features).map(([id, value]) => {
    const weight = weights.w[id] ?? 0;
    return { id, value, weight, contribution: weight * value, asked: !(id in QUESTIONS) || asked.has(id) };
  });
  rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { bias: weights.bias, rows };
}

export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

export function probability(features, weights = DEFAULT_WEIGHTS) {
  let z = weights.bias;
  for (const [id, value] of Object.entries(features)) {
    z += (weights.w[id] ?? 0) * value;
  }
  return sigmoid(z);
}
