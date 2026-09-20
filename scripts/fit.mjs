#!/usr/bin/env node
// Fits weights from the labels exported on the options page.
//   node scripts/fit.mjs labels.json [site]
// Pass a site (x, linkedin) to fit on that site's labels only. Tells differ per site.
// Prints cross-validated precision/recall per threshold, then the weights JSON to
// paste into the options page.
import { readFileSync } from 'node:fs';
import { crossValidate, fit, precisionRecall } from './logistic.mjs';

const MIN_PER_CLASS = 30;
// Hiding a human's tweet is the costly mistake, so the threshold is picked on precision.
const TARGET_PRECISION = 0.95;
const THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

// Labels saved before sites existed carry no site. They all came from X.
const DEFAULT_SITE = 'x';

const [path, site] = process.argv.slice(2);
if (!path) {
  console.error('usage: node scripts/fit.mjs labels.json [site]');
  process.exit(1);
}

// Shuffle with a fixed seed so folds are not ordered by labeling session.
function shuffled(rows, seed = 1) {
  const out = [...rows];
  let state = seed;
  const random = () => (state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const allRows = Object.values(JSON.parse(readFileSync(path, 'utf8')));
const rows = shuffled(allRows.filter((row) => !site || (row.site ?? DEFAULT_SITE) === site));
if (site) console.error(`site: ${site}`);
const names = [...new Set(rows.flatMap((row) => Object.keys(row.features)))].sort();
const X = rows.map((row) => names.map((name) => row.features[name] ?? 0));
const y = rows.map((row) => row.label);

const aiCount = y.filter((label) => label === 1).length;
console.error(`${rows.length} labels: ${aiCount} AI, ${rows.length - aiCount} human`);
if (Math.min(aiCount, rows.length - aiCount) < MIN_PER_CLASS) {
  console.error(`Warning: fewer than ${MIN_PER_CLASS} labels in one class. Weights will be noisy.`);
}

const outOfFold = crossValidate(X, y);
console.error('\nthreshold  flagged  precision  recall   (5-fold, out of fold)');
let suggested = null;
for (const threshold of THRESHOLDS) {
  const { flagged, precision, recall } = precisionRecall(outOfFold, y, threshold);
  console.error(
    `${threshold.toFixed(2).padEnd(10)} ${String(flagged).padEnd(8)} ${precision.toFixed(3).padEnd(10)} ${recall.toFixed(3)}`,
  );
  if (suggested === null && precision >= TARGET_PRECISION) suggested = threshold;
}
console.error(
  suggested === null
    ? `\nNo threshold reaches ${TARGET_PRECISION} precision yet. Label more, or add questions.`
    : `\nLowest threshold with precision >= ${TARGET_PRECISION}: ${suggested}`,
);

const model = fit(X, y);
const weights = Object.fromEntries(names.map((name, j) => [name, Number(model.weights[j].toFixed(3))]));

console.error('\nFeatures by weight (near 0 = not pulling its weight):');
for (const [name, weight] of Object.entries(weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
  console.error(`  ${name.padEnd(24)} ${weight}`);
}

console.log(JSON.stringify({ bias: Number(model.bias.toFixed(3)), w: weights }, null, 2));
