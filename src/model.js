// The judgments Jev makes about a post, and how code turns them into one probability.
// Pure module: no chrome APIs, so the Node scripts import it too.
//
// The rules judge cadence and prose, not meaning. A person can be generic, restate the
// post they answer, or say nothing new, and that is human slop, not AI. What gives a model
// away is how it writes: staged pivots, manufactured rhythm, significance paint, tidy bows.
//
// Human first. A model can be told to avoid any AI tell named here, so that list is a
// moving target. It cannot be told to be weird in a way it did not already have, so the
// human list is stable. The decision runs in this order: a confident human tell settles it
// as human; a confident AI tell (a hard rule) flags it; otherwise the weighted sum decides;
// and with no tell on either side the post is human.
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
  // The pivot comes in many orders. Jev reads literally, so every order is named:
  // "X, not Y" and "Y instead of X" were both missed when only "It's not X, it's Y" was.
  contrast_pivot: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` use the rhetorical pivot where the writer raises a framing nobody proposed only to reject it, in any order, such as \"It's not X, it's Y\", 'X, not Y', 'Y instead of X', 'less X, more Y', 'stops being X and becomes Y', or stacked negations like \"Not A. Not B. Just C.\"?",
    criteria: {
      true: "The rejected half is a framing the writer invented to sharpen the point, such as 'something a human can re-run, not a green check the agent wrote for itself' or 'a failure-modeling exercise instead of a code-coverage ritual'.",
      false: "No such move. A comparison ('A is way better than B'), a recommendation ('sorry about that one, try this one'), a preference, a correction of a fact or of something the writer or another person actually said ('the meeting is at 3, not 2'), or plain negation ('this does not work') is not a pivot.",
    },
  },

  // Asked only when the replied-to post is known. Rejecting a point the other person made is
  // a real answer. Rejecting one nobody made is the tell. Kept as its own question so Jev
  // makes one judgment at a time, and code combines the two (see `unprompted_pivot`).
  pivot_answers_parent: {
    type: TYPE.NOUL,
    needsParent: true,
    instructions:
      "`post.text` may reject an alternative, as in 'X, not Y' or \"it's not Y, it's X\". Is the rejected alternative, the Y, something that `parent.text` actually says, argues, or clearly implies?",
    criteria: {
      true: '`parent.text` states or clearly implies the rejected idea, so `post.text` is pushing back on something that was said.',
      false: '`parent.text` does not say or imply it, so the writer raised the alternative themselves. Also false when `post.text` rejects nothing.',
    },
  },

  // Word formation. Tells in how words are made, not in sentence shape. A model packs an
  // idea into a noun stack and uses it as a term everyone knows. A person says the idea.
  compressed_coinage: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` pack an idea into a two or three word noun phrase and use it as if it were an established term, such as 'keep rate', 'review-rejection rate', 'pass rate' for whether tests pass, 'trust debt', 'decision latency', or 'context rot'?",
    criteria: {
      true: "A compact noun phrase stands in for a whole idea the writer never spells out, and it is not a term in common use. A person would say the idea: 'how much of the code is still there a week later', not 'keep rate'.",
      false: 'The nouns are ordinary words used plainly, or the phrase is a real established term in that field, such as a product name, a job title, or a well-known metric.',
    },
  },
  frame_presupposition: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` refer to a set, a half, or a frame the reader was never shown, such as 'the missing one is...', 'the other half is...', 'the real question is...', 'the part nobody talks about is...', or 'the second problem is...' with no first?",
    criteria: {
      true: 'The phrase presupposes a list, a pair, or a framing that appears nowhere in the post, so it does not make sense on a plain reading.',
      false: 'The set or frame it refers to is in the post, or in an earlier sentence, so the reference makes sense.',
    },
  },
  spotlight_formula: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` single out one detail with a casual-sounding praise formula, such as 'is the part that jumps out', \"is the part I'd steal\", 'is the underrated bit', 'is doing a lot of work here', 'is the real story', or 'is what stands out'?",
  },

  // Bucket B: false profundity.
  announced_insight: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` label its own point as an insight before or while making it, such as 'This is a useful inversion:', 'The catch is...', 'The hard part is...', 'The trick is...', 'The key insight:', \"Here's the shift:\", or 'The real unlock is...'?",
    criteria: {
      true: 'A phrase frames what follows as the catch, the trick, the hard part, the shift, the inversion, the takeaway, or the unlock.',
      false: "It just says the thing with no such framing, or the word is literal, such as a catch in a contract or a hard part of a physical object.",
    },
  },
  invented_label: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` coin a label or a metaphor and use it as if it were established, such as 'the X paradox', 'the X trap', 'the X tax', 'the X gap', or a fresh metaphor treated as a known category, such as 'pass rates and shipping are different games'?",
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
  engagement_close: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` end by fishing for replies with a generic prompt, such as 'Curious if anyone...', 'Would love to hear how others...', 'What do you think?', 'Anyone else seeing this?', or 'Thoughts?'",
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

  // Human tells, five groups. Yes on any of them pulls toward human, and a confident yes
  // settles it. They live in the shape of the words, not the vocabulary: a model asked to
  // sound casual reaches for slang; a person stretches, repeats, mistypes, jokes, and
  // invents words no dictionary has.

  // Group 1: invented words.
  invented_words: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` use a made-up word or spelling that no dictionary or field has, such as 'jestermaxx', 'jevmaxx', suffix play like '-maxx', '-pilled', or '-core', a portmanteau, a deliberately mangled spelling, or an absurd compound like 'slop-infrastructuring'?",
    criteria: {
      true: 'At least one word is invented, and it reads playful, absurd, clumsy, or in-jokey. That is how a person coins a word.',
      false: "Every word is real, or the only coinage is a tidy, plausible term used straight, such as 'keep rate' or 'decision latency'. That is how a model coins a word, and it is not a human tell.",
    },
  },

  // Group 2: typing shape.
  emphatic_repetition: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` repeat a word for emphasis, such as 'way, way, way better', 'no no no', 'so so good', 'very very slow', or 'never ever'?",
  },
  stretched_typing: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` show expression through the typing itself: stretched letters ('soooo', 'nooo', 'yesss'), a stack of punctuation ('!!!', '???', '?!'), shouted caps on a word or two ('this is INSANE'), or a laugh typed out ('lol', 'lmao', 'lmfao', 'haha', 'hahaha')?",
    criteria: {
      true: 'At least one of these is present and reads as the writer expressing themselves through how the words are typed.',
      false: "None present. Casual vocabulary alone, such as 'tbh', 'ngl', 'honestly', or 'kinda', does not count: that is word choice, and models use it when told to sound casual.",
    },
  },
  human_slips: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` contain a slip a person leaves and a model does not: a typo, a missing or doubled word, a mid-sentence self-correction ('wait, no', 'I mean', 'sorry, I meant'), a trailing thought ('idk', 'anyway'), or a sentence that gives up halfway?",
  },

  // Group 3: humor.
  humor: {
    type: TYPE.NOUL,
    instructions:
      "Is `post.text` making a joke: sarcasm, absurdity, deadpan exaggeration, a pun, a meme format used as a meme such as 'born to X, forced to Y' or 'nobody: / me:', or a coinage whose whole point is to be funny?",
    criteria: {
      true: 'The post is trying to be funny and the humor is its own, not a quoted joke. Dry or deadpan counts.',
      false: "It is earnest, or the only lightness is a lone 'lol' or an emoji stuck on a serious sentence.",
    },
  },

  // Group 4: specificity a model cannot fake. The weakest group, never decisive on its own:
  // a reply bot mirrors specifics from the post it answers.
  firsthand_specifics: {
    type: TYPE.NOUL,
    instructions:
      "Does `post.text` state a concrete firsthand detail only its writer would know, such as something they did or saw, a number they measured, a named person, place, tool, or date from their own experience?",
    criteria: {
      true: "A detail from the writer's own life or work, stated as their own: 'our build broke twice on Friday', 'I paid $14 for it', 'my cousin in Leeds'.",
      false: 'Only general statements, or specifics that could have been copied from the post it replies to or from common knowledge.',
    },
  },

  // Group 5: unpolish.
  unpolished_prose: {
    type: TYPE.NOUL,
    instructions:
      'Is `post.text` unpolished in a way a person leaves and a model does not: uneven rhythm, a run-on, a sentence that trails off or gives up, no closing line, or lowercase with loose or missing punctuation?',
    criteria: {
      true: 'The text was typed and not edited: it wanders, stops short, or ignores punctuation, and no part of it is tidy.',
      false: 'The text is clean throughout, or its casualness is a surface over exact punctuation and tidy phrasing.',
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
      "Does `post.text` bolt casual markers onto prose that is otherwise precise, such as a lone 'lol', 'tbh', or 'ngl' on a polished paragraph, an emoji dropped at the end of a formal sentence, or all-lowercase text whose punctuation, terminology, and phrasing are exact?",
    criteria: {
      true: "The casual surface hides careful writing: every comma and colon is placed correctly, the terms are precise, and the phrasing is tidy, as in 'evals measure pass rate. the missing one is keep rate: how much generated code survives the week.'",
      false: 'The text is casual through and through: loose punctuation, slang used naturally, run-ons, or slips, or it is plain formal prose with no casual markers.',
    },
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
  // Human typing shape. These pull a score toward human.
  // The same word three or more times in a row, as in "way, way, way better".
  repeated_word: (text) => (/\b(\p{L}+)(?:[\s,]+\1\b){2,}/iu.test(text) ? 1 : 0),
  // A letter stretched to three or more, as in "soooo". URLs are removed first.
  stretched_letters: (text) => (/\b\p{L}*([a-z])\1{2,}\p{L}*\b/iu.test(text.replace(/https?:\/\/\S+/g, '')) ? 1 : 0),
  // A stack of ! or ? marks.
  stacked_punctuation: (text) => (/[!?]{2,}/.test(text) ? 1 : 0),
  // A typed laugh anywhere in the text.
  typed_laugh: (text) => (/\b(?:lo+l|lmf?ao+|rofl|ha(?:ha)+h?|hehe+)\b/i.test(text) ? 1 : 0),
  ...VOCAB_FEATURES,
});

// A pivot only counts in full when nobody raised the alternative it rejects. With the
// replied-to post known, Jev's confidence in the pivot is discounted by its confidence that
// the post really said the rejected idea. With no post to answer, the pivot stands as it is.
function unpromptedPivot(features, post) {
  const answersParent = post.parentText ? features.pivot_answers_parent : 0;
  return features.contrast_pivot * (1 - answersParent);
}

// Gate 2, hard rules. A weighted sum suits tells that add up. These do not add up: when
// Jev is fairly confident of one, the post is flagged on that alone, however short it is,
// and Jev's confidence becomes the score. Edit this list to change what counts as decisive.
const HARD_RULE_BAR = 0.75;
export const HARD_RULES = Object.freeze([
  'unprompted_pivot',
  'assistant_residue',
  'announced_insight',
  'compressed_coinage',
  'spotlight_formula',
]);

// Gate 1. When Jev is this confident a person typed the post, the post is human. No hard
// rule and no sum may flag it. Firsthand specifics are left out: a reply bot mirrors the
// specifics of the post it answers, so that group only counts through the sum.
const HUMAN_VETO_BAR = 0.75;
export const HUMAN_TELLS = Object.freeze([
  'invented_words',
  'emphatic_repetition',
  'stretched_typing',
  'human_slips',
  'humor',
  'unpolished_prose',
]);

// The strongest decisive human tell, or null.
export function humanVeto(features) {
  let best = null;
  for (const id of HUMAN_TELLS) {
    const value = features[id] ?? 0;
    if (value >= HUMAN_VETO_BAR && value > (best?.value ?? 0)) best = { id, value };
  }
  return best;
}

// A reply whose parent is not on the page cannot be checked against it, so the pivot
// cannot be a hard rule there. It still counts through the weighted sum.
const isCheckable = (id, post) => id !== 'unprompted_pivot' || !post?.isReply || Boolean(post.parentText);

// The strongest hard rule that fires, or null. A confident human tell vetoes them all.
export function hardRule(features, post = null) {
  if (humanVeto(features)) return null;
  let best = null;
  for (const id of HARD_RULES) {
    const value = features[id] ?? 0;
    if (value >= HARD_RULE_BAR && isCheckable(id, post) && value > (best?.value ?? 0)) best = { id, value };
  }
  return best;
}

// Hand-set starting point. Replace with the output of scripts/fit.mjs once labels exist.
// With no tell on either side the post is human, so the bias sits well below the
// threshold. Strong AI tells carry weight of their own, and the hard rules flag on Jev's
// confidence alone, so the owner's preference for a false positive over a miss lives
// there and not in the bias.
export const DEFAULT_WEIGHTS = Object.freeze({
  bias: -5.0,
  w: Object.freeze({
    reads_as_model: 2.5,
    assistant_residue: 2.0,
    sycophantic_opener: 0.8,
    // The source skill treats a single instance of the pivot as enough. On a short post
    // there is room for one or two tells, so the strong ones carry real weight.
    unprompted_pivot: 3.0,
    // Raw answers behind `unprompted_pivot`. Kept as features so labels record them.
    contrast_pivot: 0,
    pivot_answers_parent: 0,
    announced_insight: 2.0,
    compressed_coinage: 3.0,
    frame_presupposition: 1.5,
    spotlight_formula: 1.5,
    engagement_close: 1.0,
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
    // Human tells. Negative: a person typed this. Gate 1 handles the confident cases;
    // these carry the weaker answers through the sum.
    invented_words: -2.0,
    emphatic_repetition: -2.0,
    stretched_typing: -1.5,
    human_slips: -1.5,
    humor: -1.5,
    firsthand_specifics: -0.8,
    unpolished_prose: -1.2,
    repeated_word: -1.5,
    stretched_letters: -1.0,
    stacked_punctuation: -0.6,
    typed_laugh: -0.8,
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
  features.unprompted_pivot = unpromptedPivot(features, post);
  return features;
}

// Why a post got its score: every feature's pull on it, strongest first.
// `askedIds` are the questions that were sent. A reply-only question that was not sent
// reads as 0, and the breakdown says so instead of showing it as a "no".
export function explain(features, weights = DEFAULT_WEIGHTS, askedIds = Object.keys(QUESTIONS), post = null) {
  const asked = new Set(askedIds);
  const rows = Object.entries(features).map(([id, value]) => {
    const weight = weights.w[id] ?? 0;
    return { id, value, weight, contribution: weight * value, asked: !(id in QUESTIONS) || asked.has(id) };
  });
  rows.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { bias: weights.bias, rows, hardRule: hardRule(features, post), humanVeto: humanVeto(features) };
}

export function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

// The weighted sum, before any hard rule. This is what scripts/fit.mjs fits.
export function weightedProbability(features, weights = DEFAULT_WEIGHTS) {
  let z = weights.bias;
  for (const [id, value] of Object.entries(features)) {
    z += (weights.w[id] ?? 0) * value;
  }
  return sigmoid(z);
}

// The gates, in order. A decisive human tell settles it as human, and the score is one
// minus Jev's confidence in that tell. A hard rule sets the floor at Jev's confidence in
// it. Otherwise the weighted sum decides, and with no tell on either side it lands near
// zero: human by default.
export function probability(features, weights = DEFAULT_WEIGHTS, post = null) {
  const human = humanVeto(features);
  if (human) return Math.min(weightedProbability(features, weights), 1 - human.value);
  return Math.max(weightedProbability(features, weights), hardRule(features, post)?.value ?? 0);
}
