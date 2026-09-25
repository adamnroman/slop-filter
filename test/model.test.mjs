import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crossValidate, fit, precisionRecall, predict } from '../scripts/logistic.mjs';
import {
  DEFAULT_WEIGHTS,
  HARD_RULES,
  HUMAN_TELLS,
  QUESTIONS,
  buildQuestions,
  buildState,
  explain,
  featureVector,
  hardRule,
  humanVeto,
  probability,
  requestCostUsd,
  weightedProbability,
} from '../src/model.js';

const MAX_SCORE_LEVELS = 10; // API limit

function answersAt(level) {
  return Object.fromEntries(
    Object.entries(QUESTIONS).map(([id, question]) => [
      id,
      question.type === 'noul'
        ? { type: 'noul', noul: level }
        : { type: 'score', score: level * (question.criteria.length - 1) },
    ]),
  );
}

test('the replied-to post is sent only because one question checks the pivot against it', () => {
  const needsParent = Object.entries(QUESTIONS).filter(([, question]) => question.needsParent).map(([id]) => id);
  assert.deepEqual(needsParent, ['pivot_answers_parent']);
  assert.deepEqual(buildState({ text: 'hi' }), { post: { text: 'hi' } });
  assert.deepEqual(buildState({ text: 'hi', parentText: 'the post above' }).parent, { text: 'the post above' });
  assert.ok(!('pivot_answers_parent' in buildQuestions({ text: 'hi' })));
  assert.ok('pivot_answers_parent' in buildQuestions({ text: 'hi', parentText: 'p' }));
});

const noul = (values) => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { type: 'noul', noul: value }]));

test('a hard rule flags a short post on Jev\'s confidence alone', () => {
  // The real answers Jev gave for "Grok is starting to compete on economics, not just benchmarks".
  const post = { text: 'Grok is starting to compete on economics, not just benchmarks' };
  const features = featureVector({ ...noul({ contrast_pivot: 0.86, reads_as_model: 0.38, stakes_inflation: 0.26, paint_words: 0.12 }), uniform_cadence: { type: 'score', score: 0.55 * 3 } }, post);
  assert.ok(weightedProbability(features) < 0.86, 'the sum alone would have scored it lower than Jev\'s confidence in the pivot');
  assert.deepEqual(hardRule(features, post), { id: 'unprompted_pivot', value: 0.86 });
  assert.equal(probability(features, DEFAULT_WEIGHTS, post), 0.86);
  assert.equal(explain(features, DEFAULT_WEIGHTS, undefined, post).hardRule.id, 'unprompted_pivot');
});

test('a pivot that answers something the post really said is not a hard rule', () => {
  const reply = { text: 'it is economics, not benchmarks', parentText: 'Grok wins because of its benchmark scores.' };
  const answering = featureVector(noul({ contrast_pivot: 0.9, pivot_answers_parent: 0.9 }), reply);
  assert.ok(Math.abs(answering.unprompted_pivot - 0.09) < 1e-9);
  assert.equal(hardRule(answering, reply), null);
  assert.ok(probability(answering, DEFAULT_WEIGHTS, reply) < 0.1);

  const unprompted = featureVector(noul({ contrast_pivot: 0.9, pivot_answers_parent: 0.05 }), reply);
  assert.equal(hardRule(unprompted, reply).id, 'unprompted_pivot');
  assert.ok(probability(unprompted, DEFAULT_WEIGHTS, reply) > 0.85);
});

test('a reply whose parent is not on the page cannot be checked, so the pivot is not decisive there', () => {
  const blind = { text: 'it is economics, not benchmarks', isReply: true };
  const features = featureVector(noul({ contrast_pivot: 0.9 }), blind);
  assert.equal(hardRule(features, blind), null);
  assert.ok(features.unprompted_pivot > 0, 'it still counts through the weighted sum');
  assert.equal(hardRule(features, { text: blind.text }).id, 'unprompted_pivot', 'an original post has nothing to answer');
});

test('a confident human tell vetoes a hard rule: the Opus 5.5 post', () => {
  // Jev's real answers, with the pivot misread at 0.87. Then what the human questions should add.
  const post = { text: 'Opus 5.5 is way, way, way better than Opus 5. Sorry about that model, please try this one.', isReply: true };
  const jev = { contrast_pivot: 0.87, reads_as_model: 0.34, paint_words: 0.69, assistant_residue: 0.18, parallel_triad: 0.28, stakes_inflation: 0.27, manufactured_punchlines: 0.21, performed_casualness: 0.13 };
  const before = featureVector({ ...noul(jev), uniform_cadence: { type: 'score', score: 0.21 * 3 } }, { text: post.text });
  assert.equal(before.repeated_word, 1, 'code sees way, way, way');
  const withHuman = featureVector({ ...noul({ ...jev, emphatic_repetition: 0.9 }), uniform_cadence: { type: 'score', score: 0.21 * 3 } }, { text: post.text });
  assert.deepEqual(humanVeto(withHuman), { id: 'emphatic_repetition', value: 0.9 });
  assert.equal(hardRule(withHuman, { text: post.text }), null, 'the pivot cannot be decisive against a human tell');
  assert.ok(probability(withHuman, DEFAULT_WEIGHTS, { text: post.text }) < 0.2, 'the sum lands low once the human tells pull it down');
  assert.equal(explain(withHuman, DEFAULT_WEIGHTS, undefined, { text: post.text }).humanVeto.id, 'emphatic_repetition');
});

test('human typing shape is counted by code, casual vocabulary is not', () => {
  const code = (text) => featureVector({}, { text });
  assert.equal(code('way, way, way better').repeated_word, 1);
  assert.equal(code('no no no').repeated_word, 1);
  assert.equal(code('the the typo').repeated_word, 0, 'twice is a typo, not emphasis');
  assert.equal(code('soooo good').stretched_letters, 1);
  assert.equal(code('see https://www.example.com/aaa now').stretched_letters, 0, 'URLs are ignored');
  assert.equal(code('Hello, good evening!').stretched_letters, 0, 'double letters are English');
  assert.equal(code('what?!').stacked_punctuation, 1);
  assert.equal(code('lmaooo this').typed_laugh, 1);
  assert.equal(code('tbh ngl kinda honestly').typed_laugh, 0, 'slang is vocabulary');
  for (const id of ['repeated_word', 'stretched_letters', 'stacked_punctuation', 'typed_laugh', ...HUMAN_TELLS]) {
    assert.ok(DEFAULT_WEIGHTS.w[id] < 0, `${id} pulls the score down`);
  }
});

test('compressed coinages are a hard rule, and the word formation tells carry weight', () => {
  const post = { text: 'evals measure pass rate. the missing one is keep rate: how much generated code survives the week.' };
  const jev = { compressed_coinage: 0.88, frame_presupposition: 0.8, performed_casualness: 0.7, reads_as_model: 0.4, colon_semicolon_pivot: 0.5 };
  const features = featureVector(noul(jev), post);
  assert.deepEqual(hardRule(features, post), { id: 'compressed_coinage', value: 0.88 });
  assert.ok(probability(features, DEFAULT_WEIGHTS, post) >= 0.88, 'the hard rule is the floor');
  const below = featureVector(noul({ ...jev, compressed_coinage: 0.6 }), post);
  assert.equal(hardRule(below, post), null, 'under the bar it is an ordinary weight');
  assert.ok(probability(below, DEFAULT_WEIGHTS, post) > 0.5, 'the other tells still carry it over half');
  for (const id of ['compressed_coinage', 'frame_presupposition', 'spotlight_formula', 'engagement_close']) {
    assert.ok(id in QUESTIONS && DEFAULT_WEIGHTS.w[id] > 0, `${id} is asked and weighted`);
  }
  assert.ok(HARD_RULES.includes('compressed_coinage'));
});

test('a human tell still vetoes the coinage hard rule', () => {
  const post = { text: 'the keep rate on this thing is sooooo bad lmao' };
  const features = featureVector(noul({ compressed_coinage: 0.85, stretched_typing: 0.9 }), post);
  assert.equal(hardRule(features, post), null);
  assert.ok(probability(features, DEFAULT_WEIGHTS, post) < 0.5);
});

test('below the bar a hard rule is just a weight, and the other hard rules work the same way', () => {
  const post = { text: 'x' };
  assert.equal(hardRule(featureVector(noul({ contrast_pivot: 0.6 }), post), post), null);
  assert.equal(hardRule(featureVector(noul({ assistant_residue: 0.95 }), post), post).id, 'assistant_residue');
  assert.equal(hardRule(featureVector(noul({ announced_insight: 0.8, contrast_pivot: 0.9 }), post), post).id, 'unprompted_pivot', 'the strongest one is reported');
  for (const id of HARD_RULES) assert.ok(id in DEFAULT_WEIGHTS.w, `${id} still has a weight for when it is below the bar`);
});

test('no rule judges meaning: the old meaning-based checks are gone', () => {
  for (const gone of ['restates_parent', 'ignores_parent_detail', 'generic_lesson', 'generic_content', 'missing_voice']) {
    assert.ok(!(gone in QUESTIONS), `${gone} should be gone`);
  }
});

test('questions sent to the API carry no internal fields', () => {
  for (const question of Object.values(buildQuestions({ text: 'hi', parentText: 'p' }))) {
    assert.deepEqual(Object.keys(question).filter((key) => key === 'needsParent'), []);
    if (question.type === 'score') assert.ok(question.criteria.length <= MAX_SCORE_LEVELS);
  }
});

test('every feature has a default weight and lands on 0..1', () => {
  const features = featureVector(answersAt(1), { text: 'Polished \u2014 text; with a pivot: here.' });
  for (const [name, value] of Object.entries(features)) {
    assert.ok(name in DEFAULT_WEIGHTS.w, `missing weight for ${name}`);
    assert.ok(value >= 0 && value <= 1, `${name} = ${value}`);
  }
  for (const name of Object.keys(DEFAULT_WEIGHTS.w)) assert.ok(name in features, `weight for a feature that does not exist: ${name}`);
});

test('punctuation tells and the dodges around the em dash', () => {
  const code = (text) => featureVector({}, { text });
  assert.equal(code('It works \u2014 mostly.').em_dash, 1);
  assert.equal(code('It works - mostly.').spaced_hyphen_dash, 1);
  assert.equal(code('a well-known state-of-the-art tool').spaced_hyphen_dash, 0, 'hyphenated words are not dashes');
  assert.equal(code('Speed is easy; trust is hard.').semicolon, 1);
  assert.equal(code('ok ;) see you').semicolon, 0, 'an emoticon is not a semicolon');
  assert.equal(code("Here's the thing: it works. The result: fewer bugs.").colon_clauses, 1);
  assert.equal(code('Here is the thing: it works').colon_clauses, 0.5);
  assert.equal(code('meet at 3:30, link https://example.com :)').colon_clauses, 0, 'times, URLs, and emoticons do not count');
});

test('word tiers follow their counting rules: a pile of tells, not one hit', () => {
  const code = (text) => featureVector({}, { text });
  assert.equal(code('lol the landing page is fundamentally broken again').vocab_always, 0, 'sense-dependent words are left to Jev');
  assert.equal(code('we should leverage this').vocab_always, 0.5, 'one always-tier word is half the signal');
  assert.equal(code('We leverage a seamless, holistic approach to delve in.').vocab_always, 1);
  assert.equal(code('this will empower the team').vocab_cluster, 0, 'the cluster tier needs two');
  assert.equal(code('Tools that empower teams, streamline work, and foster trust.').vocab_cluster, 1);
  assert.equal(code('that is an interesting point').vocab_density, 0, 'one density word is not soaked');
  assert.equal(code('A significant and compelling result. Remarkable, interesting work.').vocab_density, 1);
});

test('cost is input tokens at the per-million price', () => {
  assert.equal(requestCostUsd(0), 0);
  assert.ok(Math.abs(requestCostUsd(1_000_000) - 0.042) < 1e-12);
  assert.ok(Math.abs(requestCostUsd(1000) * 1000 - 0.042) < 1e-9, 'about 4 cents per 1,000 posts of 1k tokens');
});

test('explain lists each pull, strongest first, and marks questions that were not asked', () => {
  const post = { text: 'plain text here' };
  const features = featureVector({ reads_as_model: { noul: 0.8 }, parallel_triad: { noul: 0.2 } }, post);
  const asked = Object.keys(buildQuestions(post)).filter((id) => id !== 'subject_drop');
  const { bias, rows } = explain(features, DEFAULT_WEIGHTS, asked);
  assert.equal(bias, DEFAULT_WEIGHTS.bias);
  assert.equal(rows[0].id, 'reads_as_model');
  assert.ok(Math.abs(rows[0].contribution - 0.8 * DEFAULT_WEIGHTS.w.reads_as_model) < 1e-9);
  const total = rows.reduce((sum, row) => sum + row.contribution, bias);
  assert.ok(Math.abs(1 / (1 + Math.exp(-total)) - probability(features)) < 1e-9, 'the pulls add up to the score');
  assert.equal(rows.find((row) => row.id === 'subject_drop').asked, false);
  assert.equal(rows.find((row) => row.id === 'em_dash').asked, true);
});

// Every AI question at `level`, every human question at 0.
function aiAnswersAt(level) {
  const answers = answersAt(level);
  for (const id of HUMAN_TELLS) answers[id] = { type: 'noul', noul: 0 };
  answers.firsthand_specifics = { type: 'noul', noul: 0 };
  return answers;
}

test('default weights separate the extremes, and an empty post is human', () => {
  const nothing = probability(featureVector(aiAnswersAt(0.05), { text: 'plain words here' }));
  const ai = probability(featureVector(aiAnswersAt(0.9), { text: 'It is not X \u2014 it is Y.' }));
  assert.ok(nothing < 0.05, `no tells on either side scored ${nothing}, should be human`);
  assert.ok(ai > 0.9, `ai-like scored ${ai}`);
});

test('the gates run in order: human tell, then hard rule, then the sum', () => {
  const post = { text: 'x' };
  // Gate 1 beats gate 2, and the score is one minus the human confidence.
  const both = featureVector(noul({ compressed_coinage: 0.95, invented_words: 0.8 }), post);
  assert.equal(hardRule(both, post), null);
  assert.ok(probability(both, DEFAULT_WEIGHTS, post) <= 0.2);
  // Gate 2 alone.
  const onlyAi = featureVector(noul({ compressed_coinage: 0.95 }), post);
  assert.equal(probability(onlyAi, DEFAULT_WEIGHTS, post), 0.95);
  // Firsthand specifics never settle it on their own: they only count through the sum.
  const specifics = featureVector(noul({ compressed_coinage: 0.95, firsthand_specifics: 0.95 }), post);
  assert.equal(hardRule(specifics, post).id, 'compressed_coinage');
  assert.ok(!HUMAN_TELLS.includes('firsthand_specifics'));
});

test('this week\'s real posts, with Jev answers as guessed from the tells that fire', () => {
  const verdict = (text, guess) => probability(featureVector(noul(guess), { text }), DEFAULT_WEIGHTS, { text });
  // Human. Each one was flagged before the human tells existed.
  assert.ok(verdict('Born to jestermaxx, forced to jevmaxx', { invented_words: 0.95, humor: 0.9, parallel_triad: 0.7, compressed_coinage: 0.8 }) < 0.1, 'jevmaxx');
  assert.ok(verdict("I find the conversation around 'slop' code so fascinating because people have been slop-infrastructuring since the advent of cloud APIs.", { invented_words: 0.85, humor: 0.8, compressed_coinage: 0.79, paint_words: 0.5 }) < 0.25, 'slop-infrastructuring');
  assert.ok(verdict('Opus 5.5 is way, way, way better than Opus 5. Sorry about that model, please try this one.', { emphatic_repetition: 0.9, contrast_pivot: 0.87, paint_words: 0.69 }) < 0.15, 'opus');
  // AI. No human tell fires, so they fall through to the hard rules.
  assert.ok(verdict('Grok is starting to compete on economics, not just benchmarks', { contrast_pivot: 0.86, reads_as_model: 0.38 }) >= 0.86, 'grok');
  assert.ok(verdict('evals measure pass rate. the missing one is keep rate: how much generated code survives the week.', { compressed_coinage: 0.85, frame_presupposition: 0.8, performed_casualness: 0.7, unpolished_prose: 0.3 }) >= 0.85, 'keep rate');
  assert.ok(verdict('2 seconds per restyle is the part that jumps out. design systems usually feel slow right when you need to try 10 directions', { spotlight_formula: 0.85, unpolished_prose: 0.4 }) >= 0.85, 'restyle');
  // Ambiguous: a plain human update with nothing on either side stays human.
  assert.ok(verdict('We moved the launch to Tuesday because the vendor slipped. Ping me if that breaks anything.', { reads_as_model: 0.3, firsthand_specifics: 0.6 }) < 0.1, 'plain update');
});

test('logistic fit learns a separable signal and ignores noise', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 200; i++) {
    const label = i % 2;
    X.push([label ? 0.8 : 0.2, (i * 37) % 10 / 10]);
    y.push(label);
  }
  const model = fit(X, y);
  assert.ok(Math.abs(model.weights[0]) > Math.abs(model.weights[1]) * 5);
  assert.ok(predict([0.8, 0.5], model) > 0.5);

  const { precision, recall } = precisionRecall(crossValidate(X, y), y, 0.5);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});
