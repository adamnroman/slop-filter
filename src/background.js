// Owns the API key and every TypeSafe call. The page never sees the key.
import './constants.js';
import { askJev, PROVIDERS } from './jev-client.js';
import { isActive, noticeFor, pauseFor, shouldNotify } from './pause.js';
import {
  DEFAULT_WEIGHTS,
  buildQuestions,
  buildState,
  explain,
  featureVector,
  probability,
  requestCostUsd,
} from './model.js';

const { MSG, STORE, PROVIDER, DEFAULTS, SLOPFILTER_ORIGIN } = globalThis.XAF;

const MAX_IN_FLIGHT = 6;
const ERROR_NO_KEY = Object.freeze({
  [PROVIDER.TYPESAFE]: 'No TypeSafe API key set. Open the extension options.',
  [PROVIDER.OPENROUTER]: 'No OpenRouter API key set. Open the extension options.',
  [PROVIDER.SLOPFILTER]: 'Not signed in to Slop Filter. Open the extension options.',
});
// What goes in the Authorization header for each provider: a key, or the session token
// Slop Filter's server issued.
const KEY_FOR = Object.freeze({
  [PROVIDER.TYPESAFE]: STORE.API_KEY,
  [PROVIDER.OPENROUTER]: STORE.OPENROUTER_KEY,
  [PROVIDER.SLOPFILTER]: STORE.SESSION_TOKEN,
});
const ACCOUNT_PATH = '/v1/me';
const PAIR_PATH = '/pair';
const NOTICE_ID = 'xaf-paused';
const NOTICE_ICON = 'assets/icons/icon-128.png';
const OPTIONS_URL = 'options';
// While paused, every post gets this answer and nothing is sent.
const PAUSED = Object.freeze({ paused: true });
// A change to any of these ends a pause: the fix may be in.
const UNPAUSE_KEYS = new Set([STORE.PROVIDER, STORE.API_KEY, STORE.OPENROUTER_KEY, STORE.SESSION_TOKEN]);
// Counts those changes. A refusal of a request made before one is not a pause: it was
// answered for a provider or key the person has since changed.
let generation = 0;
// Messages only the extension's own pages may send, never a content script on a site.
const EXTENSION_ONLY = new Set([MSG.PAIR, MSG.ACCOUNT, MSG.TEST_NOTICE]);
const SESSION_TOKEN_PREFIX = 'sf_';

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

async function chosenProvider() {
  const { [STORE.PROVIDER]: stored } = await chrome.storage.local.get(STORE.PROVIDER);
  return Object.hasOwn(PROVIDERS, stored) ? stored : DEFAULTS.provider;
}

async function fetchFeatures(post) {
  const provider = await chosenProvider();
  const { [KEY_FOR[provider]]: apiKey } = await chrome.storage.local.get(KEY_FOR[provider]);
  if (!apiKey) throw Object.assign(new Error(ERROR_NO_KEY[provider]), { noKey: true });

  const questions = buildQuestions(post);
  // Timed inside the slot, so waiting in the queue does not count. Retries do.
  const { response, latencyMs } = await withSlot(async () => {
    const startedAt = performance.now();
    const answered = await askJev({ apiKey, provider, state: buildState(post), questions });
    return { response: answered, latencyMs: performance.now() - startedAt };
  });

  const inputTokens = response.usage?.input_tokens ?? 0;
  // OpenRouter reports the charge on every response. TypeSafe does not, so it is computed.
  const reportedCost = typeof response.usage?.cost === 'number' && response.usage.cost >= 0 ? response.usage.cost : null;
  return {
    features: featureVector(response.answers, post),
    asked: Object.keys(questions),
    usage: {
      inputTokens,
      costUsd: reportedCost ?? requestCostUsd(inputTokens),
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

// The pause: kept in storage so it survives worker restarts and the options page can
// show it. Read once, then held here.
let pausePromise = null;
function currentPause() {
  if (!pausePromise) {
    pausePromise = chrome.storage.local.get(STORE.PAUSE).then((stored) => stored[STORE.PAUSE] ?? null);
  }
  return pausePromise;
}

async function setPause(pause) {
  pausePromise = Promise.resolve(pause);
  if (pause) await chrome.storage.local.set({ [STORE.PAUSE]: pause });
  else await chrome.storage.local.remove(STORE.PAUSE);
}

// Resolves to null when the notification was shown, or to the reason it was not.
// Never throws: a notification that fails must not stop the pause from taking hold.
function notify({ title, message }) {
  return new Promise((resolve) => {
    try {
      const options = { type: 'basic', iconUrl: chrome.runtime.getURL(NOTICE_ICON), title, message };
      chrome.notifications.create(NOTICE_ID, options, () => resolve(chrome.runtime.lastError?.message ?? null));
    } catch (error) {
      resolve(error.message);
    }
  });
}

// An error that means "stop asking": the account, the key, or a cap. Passing errors
// (Jev down, a timeout) are not, and the next post simply tries again. `asOf` is the
// generation the request was made in; a change since then makes the refusal stale.
async function pauseIfCalledFor(error, asOf) {
  if (asOf !== generation) return false;
  const pause = pauseFor(error, await chosenProvider());
  if (!pause) return false;
  // An earlier pause for the same problem, expired or not, carries when it was announced.
  const previous = await currentPause();
  pause.notifiedAt = previous?.notifiedAt ?? null;
  if (asOf !== generation) return false;
  // The pause holds from here on, whatever the notification does.
  await setPause(pause);
  console.warn('[xaf] paused:', pause.code, pause.message);
  if (shouldNotify(pause, previous)) {
    const failure = await notify(noticeFor(pause));
    if (failure) console.warn('[xaf] notification failed:', failure);
    else if (asOf === generation) await setPause({ ...pause, notifiedAt: Date.now() });
  }
  return true;
}

// For the options page: proves notifications reach the screen.
const TEST_NOTICE = Object.freeze({ title: 'Slop Filter', message: 'Notifications work. A pause will look like this.' });
async function testNotice() {
  const failure = await notify(TEST_NOTICE);
  if (failure) throw new Error(`Notification failed: ${failure}`);
  return null;
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== NOTICE_ID) return;
  chrome.notifications.clear(id);
  const pause = await currentPause();
  const url = pause ? noticeFor(pause).url : OPTIONS_URL;
  if (url === OPTIONS_URL) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url });
});

chrome.storage.onChanged.addListener((changes) => {
  // The options page can end a pause too ("Resume now"): keep the copy here in step.
  if (changes[STORE.PAUSE]) pausePromise = Promise.resolve(changes[STORE.PAUSE].newValue ?? null);
  if (Object.keys(changes).some((key) => UNPAUSE_KEYS.has(key))) {
    generation += 1;
    setPause(null);
  }
});

// Weights are read per request, so new fitted weights apply without re-asking Jev.
// `usage` is null when the answer came from the cache, so nothing is counted twice.
async function classify(post) {
  // An expired pause stays in storage: it remembers when its problem was last announced.
  if (isActive(await currentPause())) return PAUSED;

  const isFresh = !featureCache.has(post.id);
  const asOf = generation;
  let answer;
  try {
    answer = await cachedFeatures(post);
  } catch (error) {
    if (await pauseIfCalledFor(error, asOf)) return PAUSED;
    throw error;
  }
  const { features, asked, usage } = answer;
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
  if (result.paused) return result;
  const isFresh = Boolean(result.usage);
  if (isFresh && post.handle && result.p >= threshold) result.flagCount = await countFlag(post);
  return result;
}

// The signed-in Slop Filter account, for the options page. The server's own error
// message is thrown when it refuses, so the page can show it as is.
async function account() {
  const { [STORE.SESSION_TOKEN]: token } = await chrome.storage.local.get(STORE.SESSION_TOKEN);
  if (!token) throw new Error(ERROR_NO_KEY[PROVIDER.SLOPFILTER]);
  const response = await fetch(`${SLOPFILTER_ORIGIN}${ACCOUNT_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}

// Trades the pairing code from the account page for a session token, and keeps it.
async function pair({ code }) {
  const response = await fetch(`${SLOPFILTER_ORIGIN}${PAIR_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  if (typeof body?.token !== 'string' || !body.token.startsWith(SESSION_TOKEN_PREFIX)) {
    throw new Error('The server did not return a session token.');
  }
  await chrome.storage.local.set({ [STORE.SESSION_TOKEN]: body.token });
  return account();
}

const HANDLERS = {
  [MSG.CLASSIFY]: (message) => classifyAndCount(message),
  [MSG.ACCOUNT]: () => account(),
  [MSG.PAIR]: (message) => pair(message),
  [MSG.TEST_NOTICE]: () => testNotice(),
  [MSG.IS_BLOCKED]: ({ post }) => isBlocked(post),
  [MSG.LABEL]: (message) => saveLabel(message),
  [MSG.BLOCK]: ({ post }) => block(post),
  [MSG.UNBLOCK]: (message) => unblock(message),
  [MSG.BLOCKED_LIST]: async () => (await loadAccounts()).blocked,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;
  if (EXTENSION_ONLY.has(message.type) && !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message, detail: error.detail, code: error.code }));
  return true;
});
