// L2-regularized logistic regression by batch gradient descent. Features are all 0..1
// and there are a few hundred rows, so nothing fancier is needed.
import { sigmoid } from '../src/model.js';

const DEFAULTS = Object.freeze({ l2: 0.01, learningRate: 0.5, iterations: 4000 });

export function fit(X, y, options = {}) {
  const { l2, learningRate, iterations } = { ...DEFAULTS, ...options };
  const n = X.length;
  const weights = new Array(X[0].length).fill(0);
  let bias = 0;

  for (let step = 0; step < iterations; step++) {
    const gradient = new Array(weights.length).fill(0);
    let biasGradient = 0;
    for (let i = 0; i < n; i++) {
      const error = predict(X[i], { bias, weights }) - y[i];
      biasGradient += error;
      for (let j = 0; j < weights.length; j++) gradient[j] += error * X[i][j];
    }
    bias -= (learningRate * biasGradient) / n;
    for (let j = 0; j < weights.length; j++) {
      weights[j] -= learningRate * (gradient[j] / n + l2 * weights[j]);
    }
  }
  return { bias, weights };
}

export function predict(x, { bias, weights }) {
  let z = bias;
  for (let j = 0; j < weights.length; j++) z += weights[j] * x[j];
  return sigmoid(z);
}

// Out-of-fold probability for every row: each row is scored by a model that never saw it.
export function crossValidate(X, y, folds = 5, options = {}) {
  const probabilities = new Array(X.length);
  for (let fold = 0; fold < folds; fold++) {
    const isTest = (i) => i % folds === fold;
    const trainX = X.filter((_, i) => !isTest(i));
    const trainY = y.filter((_, i) => !isTest(i));
    const model = fit(trainX, trainY, options);
    X.forEach((x, i) => {
      if (isTest(i)) probabilities[i] = predict(x, model);
    });
  }
  return probabilities;
}

export function precisionRecall(probabilities, y, threshold) {
  let truePositives = 0;
  let flagged = 0;
  let positives = 0;
  probabilities.forEach((p, i) => {
    if (y[i] === 1) positives++;
    if (p >= threshold) {
      flagged++;
      if (y[i] === 1) truePositives++;
    }
  });
  return {
    flagged,
    precision: flagged ? truePositives / flagged : NaN,
    recall: positives ? truePositives / positives : NaN,
  };
}
