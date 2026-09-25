#!/usr/bin/env node
// Runs one post through the question set and prints every answer.
//   TYPESAFE_API_KEY=... node scripts/try.mjs "post text" ["text of the post it replies to"]
//   OPENROUTER_API_KEY=... JEV_PROVIDER=openrouter node scripts/try.mjs "post text"
// Use it to check a new or reworded question before it goes into the extension.
import { askJev } from '../src/jev-client.js';
import {
  buildQuestions,
  buildState,
  featureVector,
  hardRule,
  probability,
  weightedProbability,
} from '../src/model.js';

const PROVIDER = process.env.JEV_PROVIDER ?? 'typesafe';
const API_KEY_ENV = PROVIDER === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY';

const [text, parentText] = process.argv.slice(2);
const apiKey = process.env[API_KEY_ENV];
if (!text || !apiKey) {
  console.error(`usage: ${API_KEY_ENV}=... node scripts/try.mjs "post text" ["parent text"]`);
  process.exit(1);
}

const post = { text, parentText: parentText ?? null };
const response = await askJev({
  apiKey,
  provider: PROVIDER,
  state: buildState(post),
  questions: buildQuestions(post),
});

const features = featureVector(response.answers, post);
for (const [name, value] of Object.entries(features)) {
  console.log(`${name.padEnd(24)} ${value.toFixed(2)}`);
}
const decisive = hardRule(features, post);
console.log(`\nweighted sum with default weights: ${weightedProbability(features).toFixed(3)}`);
console.log(decisive ? `hard rule fired: ${decisive.id} (Jev ${decisive.value.toFixed(2)})` : 'no hard rule fired');
console.log(`p(AI): ${probability(features, undefined, post).toFixed(3)}`);
console.log(`model: ${response.model}, input tokens: ${response.usage.input_tokens}`);
