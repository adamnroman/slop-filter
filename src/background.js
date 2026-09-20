// Owns the API key and every TypeSafe call. The page never sees the key.
import './constants.js';
import { askJev } from './jev-client.js';
import {
  DEFAULT_WEIGHTS,
  JEV_MODEL,
  buildQuestions,
  buildState,
  featureVector,
  probability,
  requestCostUsd,
} from './model.js';

const { MSG, STORE } = globalThis.XAF;

const MAX_IN_FLIGHT = 6;
const ERROR_NO_KEY = 'No API key set. Open the extension options.';

// Post id -> promise of { features, usage }. Holding the promise dedupes concurrent asks.
const featureCache = new Map();

let inFlight = 0;
const waiting = [];

async function withSlot(task) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await task();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function fetchFeatures(post) {
  const { [STORE.API_KEY]: apiKey } = await chrome.storage.local.get(STORE.API_KEY);
  if (!apiKey) throw new Error(ERROR_NO_KEY);

  const questions = buildQuestions(post);
  // Timed inside the slot, so waiting in the queue does not count. Retries do.
  const { response, latencyMs } = await withSlot(async () => {
    const startedAt = performance.now();
    const answered = await askJev({ apiKey, model: JEV_MODEL, state: buildState(post), questions });
    return { response: answered, latencyMs: performance.now() - startedAt };
  });

  const inputTokens = response.usage?.input_tokens ?? 0;
  return {
    features: featureVector(response.answers, post),
    usage: {
      inputTokens,
      costUsd: requestCostUsd(inputTokens),
      latencyMs,
      questions: Object.keys(questions).length,
    },
  };
}

function cachedFeatures(post) {
  if (!featureCache.has(post.id)) {
    const pending = fetchFeatures(post);
    pending.catch(() => featureCache.delete(post.id));
    featureCache.set(post.id, pending);
  }
  return featureCache.get(post.id);
}

// Weights are read per request, so new fitted weights apply without re-asking Jev.
// `usage` is null when the answer came from the cache, so nothing is counted twice.
async function classify(post) {
  const isFresh = !featureCache.has(post.id);
  const { features, usage } = await cachedFeatures(post);
  const { [STORE.WEIGHTS]: weights } = await chrome.storage.local.get(STORE.WEIGHTS);
  return {
    features,
    p: probability(features, weights ?? DEFAULT_WEIGHTS),
    usage: isFresh ? usage : null,
  };
}

// Label writes are read-modify-write on one key, so they run one at a time.
let labelWrites = Promise.resolve();

function saveLabel({ post, features, label }) {
  labelWrites = labelWrites.then(async () => {
    const { [STORE.LABELS]: labels = {} } = await chrome.storage.local.get(STORE.LABELS);
    labels[post.id] = { ...post, features, label, labeled_at: Date.now() };
    await chrome.storage.local.set({ [STORE.LABELS]: labels });
  });
  return labelWrites;
}

const HANDLERS = {
  [MSG.CLASSIFY]: ({ post }) => classify(post),
  [MSG.LABEL]: (message) => saveLabel(message),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message, detail: error.detail }));
  return true;
});
