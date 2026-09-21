import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crossValidate, fit, precisionRecall, predict } from '../scripts/logistic.mjs';
import {
  DEFAULT_WEIGHTS,
  QUESTIONS,
  buildQuestions,
  buildState,
  explain,
  featureVector,
  probability,
  requestCostUsd,
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

test('the rules judge prose, so the replied-to post is not sent', () => {
  // No current question looks at the parent. Text nobody asks about costs tokens and accuracy.
  assert.ok(Object.values(QUESTIONS).every((question) => !question.needsParent));
  assert.deepEqual(buildState({ text: 'hi' }), { post: { text: 'hi' } });
  assert.deepEqual(buildState({ text: 'hi', parentText: 'the post above' }), { post: { text: 'hi' } });
  assert.deepEqual(Object.keys(buildQuestions({ text: 'hi', parentText: 'p' })), Object.keys(QUESTIONS));
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

test('default weights separate the extremes', () => {
  const human = probability(featureVector(answersAt(0.05), { text: 'lol no' }));
  const ai = probability(featureVector(answersAt(0.9), { text: 'It is not X — it is Y.' }));
  assert.ok(human < 0.1, `human-like scored ${human}`);
  assert.ok(ai > 0.9, `ai-like scored ${ai}`);
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
