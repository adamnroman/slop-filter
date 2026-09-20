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

test('parent questions are only asked when the parent is known', () => {
  const alone = buildQuestions({ text: 'hi' });
  const reply = buildQuestions({ text: 'hi', parentText: 'original post' });
  assert.ok(!('restates_parent' in alone));
  assert.ok('restates_parent' in reply);
  assert.deepEqual(buildState({ text: 'hi' }), { post: { text: 'hi' } });
  assert.deepEqual(buildState({ text: 'hi', parentText: 'p' }).parent, { text: 'p' });
});

test('questions sent to the API carry no internal fields', () => {
  for (const question of Object.values(buildQuestions({ text: 'hi', parentText: 'p' }))) {
    assert.deepEqual(Object.keys(question).filter((key) => key === 'needsParent'), []);
    if (question.type === 'score') assert.ok(question.criteria.length <= MAX_SCORE_LEVELS);
  }
});

test('every feature has a default weight and lands on 0..1', () => {
  const features = featureVector(answersAt(1), { text: 'Polished — text.' });
  for (const [name, value] of Object.entries(features)) {
    assert.ok(name in DEFAULT_WEIGHTS.w, `missing weight for ${name}`);
    assert.ok(value >= 0 && value <= 1, `${name} = ${value}`);
  }
  assert.equal(features.em_dash, 1);
  assert.equal(featureVector({}, { text: 'all lower' }).all_lowercase, 1);
});

test('code features catch LinkedIn formatting tells', () => {
  const bullets = '\u2705 Ship fast\n\u2705 Learn faster\n\u{1F680} Repeat\n\nAgree? #growth #mindset #leadership';
  const plain = 'we shipped the thing on friday and it broke twice #oops';
  assert.equal(featureVector({}, { text: bullets }).emoji_bullets, 1);
  assert.equal(featureVector({}, { text: bullets }).hashtag_pile, 1);
  assert.equal(featureVector({}, { text: plain }).emoji_bullets, 0);
  assert.equal(featureVector({}, { text: plain }).hashtag_pile, 0);
});

test('reply-only questions include the generic lesson check', () => {
  assert.ok(!('generic_lesson' in buildQuestions({ text: 'hi' })));
  assert.ok('generic_lesson' in buildQuestions({ text: 'hi', parentText: 'original post' }));
  assert.ok('unearned_real' in buildQuestions({ text: 'hi' }));
});

test('cost is input tokens at the per-million price', () => {
  assert.equal(requestCostUsd(0), 0);
  assert.ok(Math.abs(requestCostUsd(1_000_000) - 0.042) < 1e-12);
  assert.ok(Math.abs(requestCostUsd(1000) * 1000 - 0.042) < 1e-9, 'about 4 cents per 1,000 posts of 1k tokens');
});

test('explain lists each pull, strongest first, and marks questions that were not asked', () => {
  const post = { text: 'plain text here' };
  const features = featureVector({ holistic_ai: { noul: 0.8 }, rule_of_three: { noul: 0.2 } }, post);
  const { bias, rows } = explain(features, DEFAULT_WEIGHTS, Object.keys(buildQuestions(post)));
  assert.equal(bias, DEFAULT_WEIGHTS.bias);
  assert.equal(rows[0].id, 'holistic_ai');
  assert.ok(Math.abs(rows[0].contribution - 0.8 * DEFAULT_WEIGHTS.w.holistic_ai) < 1e-9);
  const total = rows.reduce((sum, row) => sum + row.contribution, bias);
  assert.ok(Math.abs(1 / (1 + Math.exp(-total)) - probability(features)) < 1e-9, 'the pulls add up to the score');
  assert.equal(rows.find((row) => row.id === 'generic_lesson').asked, false);
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
