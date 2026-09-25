// Owns the API key and every TypeSafe call. The page never sees the key.
import './constants.js';
import { askJev, PROVIDERS } from './jev-client.js';
import {
  DEFAULT_WEIGHTS,
  buildQuestions,
  buildState,
  explain,
  featureVector,
  probability,
  requestCostUsd,
} from './model.js';

const { MSG, STORE, PROVIDER, DEFAULTS } = globalThis.XAF;

const MAX_IN_FLIGHT = 6;
const ERROR_NO_KEY = Object.freeze({
  [PROVIDER.TYPESAFE]: 'No TypeSafe API key set. Open the extension options.',
  [PROVIDER.OPENROUTER]: 'No OpenRouter API key set. Open the extension options.',
});
const KEY_FOR = Object.freeze({
  [PROVIDER.TYPESAFE]: STORE.API_KEY,
  [PROVIDER.OPENROUTER]: STORE.OPENROUTER_KEY,
});

// Post id -> promise of { features, asked, usage }. Holding the promise dedupes concurrent asks.
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
  const stored = await chrome.storage.local.get([STORE.PROVIDER, STORE.API_KEY, STORE.OPENROUTER_KEY]);
  const provider = stored[STORE.PROVIDER] in PROVIDERS ? stored[STORE.PROVIDER] : DEFAULTS.provider;
  const apiKey = stored[KEY_FOR[provider]];
  if (!apiKey) throw new Error(ERROR_NO_KEY[provider]);

  const questions = buildQuestions(post);
  // Timed inside the slot, so waiting in the queue does not count. Retries do.
  const { response, latencyMs } = await withSlot(async () => {
    const startedAt = performance.now();
    const answered = await askJev({ apiKey, provider, state: buildState(post), questions });
    return { response: answered, latencyMs: performance.now() - startedAt };
  });

  const inputTokens = response.usage?.input_tokens ?? 0;
  // OpenRouter reports the charge on every response. TypeSafe does not, so it is computed.
  const reportedCost = Number(response.usage?.cost);
  return {
    features: featureVector(response.answers, post),
    asked: Object.keys(questions),
    usage: {
      inputTokens,
      costUsd: Number.isFinite(reportedCost) ? reportedCost : requestCostUsd(inputTokens),
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
  const { features, asked, usage } = await cachedFeatures(post);
  const { [STORE.WEIGHTS]: stored } = await chrome.storage.local.get(STORE.WEIGHTS);
  const weights = stored ?? DEFAULT_WEIGHTS;
  return {
    features,
    p: probability(features, weights, post),
    why: explain(features, weights, asked, post),
    usage: isFresh ? usage : null,
  };
}

// Blocked accounts, keyed `site:handle`, and how many of each account's posts were flagged.
// Read once, kept here, written on change. Every tab asks this worker, so they agree.
const blockedKey = (site, handle) => `${site}:${handle}`;
let accounts = null;

async function loadAccounts() {
  if (!accounts) {
    const stored = await chrome.storage.local.get([STORE.BLOCKED, STORE.FLAG_COUNTS]);
    accounts = { blocked: stored[STORE.BLOCKED] ?? {}, flagCounts: stored[STORE.FLAG_COUNTS] ?? {} };
  }
  return accounts;
}

const saveAccounts = () =>
  chrome.storage.local.set({ [STORE.BLOCKED]: accounts.blocked, [STORE.FLAG_COUNTS]: accounts.flagCounts });

async function isBlocked({ site, handle }) {
  const { blocked } = await loadAccounts();
  return Boolean(blocked[blockedKey(site, handle)]);
}

async function block({ site, handle }) {
  await loadAccounts();
  accounts.blocked[blockedKey(site, handle)] = { site, handle, blocked_at: Date.now() };
  delete accounts.flagCounts[blockedKey(site, handle)];
  await saveAccounts();
}

async function unblock({ key }) {
  await loadAccounts();
  delete accounts.blocked[key];
  await saveAccounts();
}

// Counts a flagged post against its account. Returns the count, so the page can offer a
// block once it reaches the threshold.
async function countFlag({ site, handle }) {
  await loadAccounts();
  const key = blockedKey(site, handle);
  accounts.flagCounts[key] = (accounts.flagCounts[key] ?? 0) + 1;
  await saveAccounts();
  return accounts.flagCounts[key];
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

// Scores a post and counts a flag against its account. The page checks the block list
// first, before it fetches or sends any text.
async function classifyAndCount({ post, threshold }) {
  const result = await classify(post);
  const isFresh = Boolean(result.usage);
  if (isFresh && post.handle && result.p >= threshold) result.flagCount = await countFlag(post);
  return result;
}

const HANDLERS = {
  [MSG.CLASSIFY]: (message) => classifyAndCount(message),
  [MSG.IS_BLOCKED]: ({ post }) => isBlocked(post),
  [MSG.LABEL]: (message) => saveLabel(message),
  [MSG.BLOCK]: ({ post }) => block(post),
  [MSG.UNBLOCK]: (message) => unblock(message),
  [MSG.BLOCKED_LIST]: async () => (await loadAccounts()).blocked,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message, detail: error.detail }));
  return true;
});
