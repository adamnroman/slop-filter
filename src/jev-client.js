// Minimal client for POST /v1/systemone. Works in the extension worker and in Node.
//
// Jev is reachable at TypeSafe directly, through OpenRouter, which resells it in the
// same request format and bills the caller's OpenRouter credits, or through Slop
// Filter's own server, which scores on its key and bills a subscription. The endpoint,
// the model id, and what goes in the Authorization header are the only differences.
import './constants.js';

const { SLOPFILTER_ORIGIN, ACCOUNT_ERROR } = globalThis.XAF;

export const PROVIDERS = Object.freeze({
  typesafe: Object.freeze({ endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0' }),
  openrouter: Object.freeze({ endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.13' }),
  slopfilter: Object.freeze({ endpoint: `${SLOPFILTER_ORIGIN}/v1/systemone`, model: 'jev-1.13.0' }),
});
const DEFAULT_PROVIDER = 'typesafe';
const ACCOUNT_ERROR_TYPES = new Set(Object.values(ACCOUNT_ERROR));
const TIMEOUT_MS = 10_000;
// One call makes the first attempt plus at most this many retries, then gives up.
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_AFTER_HEADER = 'retry-after';
const TIMEOUT_ERROR = 'TimeoutError';
// HTTP/2 responses carry no reason phrase, so the common ones are spelled out here.
const STATUS_TEXT = Object.freeze({
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `message` is short enough to show in the page. `detail` is the raw response body.
// `status` is the HTTP status, 0 for a transport failure. `code` and `resetsAt` are set
// when Slop Filter's server refused for an account reason, so the caller can tell a
// billing state or a cap from an outage, and knows when a cap lifts.
export class JevError extends Error {
  constructor(message, { detail = '', status = 0, code = null, resetsAt = null } = {}) {
    super(message);
    this.name = 'JevError';
    this.detail = detail;
    this.status = status;
    this.code = code;
    this.resetsAt = resetsAt;
  }
}

// Slop Filter's server answers `{ error: { type, message } }`. Only its own account
// types are adopted; any other provider's error body stays in `detail`.
function accountError(detail) {
  try {
    const { error } = JSON.parse(detail);
    if (ACCOUNT_ERROR_TYPES.has(error?.type) && typeof error.message === 'string') return error;
  } catch {
    // Not JSON, or not shaped like the server's errors.
  }
  return null;
}

async function httpFailure(response) {
  const reason = STATUS_TEXT[response.status] ?? response.statusText;
  const detail = await response.text().catch(() => '');
  const account = accountError(detail);
  return {
    message: account?.message ?? `HTTP ${response.status} ${reason}`.trim(),
    detail,
    status: response.status,
    code: account?.type ?? null,
    resetsAt: typeof account?.resets_at === 'string' ? account.resets_at : null,
    isRetryable: RETRYABLE_STATUS.has(response.status),
    retryAfterMs: Number(response.headers.get(RETRY_AFTER_HEADER)) * 1000,
  };
}

function transportFailure(error) {
  const message =
    error.name === TIMEOUT_ERROR
      ? `Request timed out after ${TIMEOUT_MS / 1000}s`
      : `Network error: ${error.message}`;
  return { message, detail: '', status: 0, code: null, resetsAt: null, isRetryable: true, retryAfterMs: 0 };
}

// Exponential: 0.5s, 1s, 2s. A retry-after header wins, up to the cap.
function backoffMs(failure, retry) {
  const wanted = failure.retryAfterMs > 0 ? failure.retryAfterMs : BASE_BACKOFF_MS * 2 ** retry;
  return Math.min(wanted, MAX_BACKOFF_MS);
}

// `wait` is injectable so tests do not sit through real backoff.
export async function askJev({ apiKey, provider = DEFAULT_PROVIDER, state, questions }, wait = sleep) {
  const { endpoint, model } = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : PROVIDERS[DEFAULT_PROVIDER];
  const body = JSON.stringify({ model, state, questions });

  for (let retry = 0; ; retry++) {
    let failure;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return await response.json();
      failure = await httpFailure(response);
    } catch (error) {
      failure = transportFailure(error);
    }

    if (!failure.isRetryable || retry === MAX_RETRIES) {
      throw new JevError(failure.message, failure);
    }
    await wait(backoffMs(failure, retry));
  }
}
