#!/usr/bin/env node
// Runs one tweet through the question set and prints every answer.
//   TYPESAFE_API_KEY=... node scripts/try.mjs "tweet text" ["text of the post it replies to"]
// Use it to check a new or reworded question before it goes into the extension.
import { askJev } from '../src/jev-client.js';
import {
  JEV_MODEL,
  buildQuestions,
  buildState,
  featureVector,
  probability,
} from '../src/model.js';

const API_KEY_ENV = 'TYPESAFE_API_KEY';

const [text, parentText] = process.argv.slice(2);
const apiKey = process.env[API_KEY_ENV];
if (!text || !apiKey) {
  console.error(`usage: ${API_KEY_ENV}=... node scripts/try.mjs "tweet text" ["parent text"]`);
  process.exit(1);
}

const tweet = { text, parentText: parentText ?? null };
const response = await askJev({
  apiKey,
  model: JEV_MODEL,
  state: buildState(tweet),
  questions: buildQuestions(tweet),
});

const features = featureVector(response.answers, tweet);
for (const [name, value] of Object.entries(features)) {
  console.log(`${name.padEnd(24)} ${value.toFixed(2)}`);
}
console.log(`\np(AI) with default weights: ${probability(features).toFixed(3)}`);
console.log(`model: ${response.model}, input tokens: ${response.usage.input_tokens}`);
