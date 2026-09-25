import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JevError, PROVIDERS, askJev } from '../src/jev-client.js';

const REQUEST = { apiKey: 'k', model: 'm', state: 's', questions: {} };
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const reply = (status, body = '', headers = {}) => new Response(body, { status, headers });

// Replaces fetch with a script of outcomes. A function entry is called, so it can throw.
function stubFetch(outcomes) {
  let calls = 0;
  globalThis.fetch = async () => {
    const outcome = outcomes[Math.min(calls++, outcomes.length - 1)];
    return typeof outcome === 'function' ? outcome() : outcome;
  };
  return () => calls;
}

function recordingWait() {
  const waits = [];
  return { waits, wait: async (ms) => waits.push(ms) };
}

test('a failing upstream gets the first attempt plus 3 retries, with exponential backoff', async () => {
  const calls = stubFetch([() => reply(503, 'overloaded')]);
  const { waits, wait } = recordingWait();

  await assert.rejects(askJev(REQUEST, wait), (error) => {
    assert.ok(error instanceof JevError);
    assert.equal(error.message, 'HTTP 503 Service Unavailable');
    assert.equal(error.detail, 'overloaded');
    return true;
  });
  assert.equal(calls(), 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
});

test('a retry that succeeds returns the answer', async () => {
  const calls = stubFetch([
    () => reply(429),
    () => reply(200, JSON.stringify({ answers: { q: { noul: 0.9 } } })),
  ]);
  const { wait } = recordingWait();

  const result = await askJev(REQUEST, wait);
  assert.equal(result.answers.q.noul, 0.9);
  assert.equal(calls(), 2);
});

test('a bad key fails at once, with no retry', async () => {
  const calls = stubFetch([() => reply(401, '{"error":"invalid api key"}')]);
  const { waits, wait } = recordingWait();

  await assert.rejects(askJev(REQUEST, wait), { message: 'HTTP 401 Unauthorized' });
  assert.equal(calls(), 1);
  assert.deepEqual(waits, []);
});

test('network errors and timeouts are retried too', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const calls = stubFetch([
    () => {
      throw new TypeError('Failed to fetch');
    },
    () => {
      throw timeout;
    },
  ]);
  const { wait } = recordingWait();

  await assert.rejects(askJev(REQUEST, wait), { message: 'Request timed out after 10s' });
  assert.equal(calls(), 4);
});

test('retry-after is honored, up to the cap', async () => {
  stubFetch([
    () => reply(429, '', { 'retry-after': '1' }),
    () => reply(429, '', { 'retry-after': '60' }),
    () => reply(200, '{}'),
  ]);
  const { waits, wait } = recordingWait();

  await askJev(REQUEST, wait);
  assert.deepEqual(waits, [1000, 4000]);
});

test('the provider picks the endpoint and the model id, and nothing else changes', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, model: JSON.parse(options.body).model, auth: options.headers.Authorization });
    return reply(200, JSON.stringify({ answers: {}, usage: { input_tokens: 10, cost: 0.00042 } }));
  };
  await askJev({ ...REQUEST, apiKey: 'ts-key' });
  await askJev({ ...REQUEST, apiKey: 'or-key', provider: 'openrouter' });
  const viaOpenRouter = await askJev({ ...REQUEST, apiKey: 'or-key', provider: 'openrouter' });
  assert.deepEqual(calls[0], { url: PROVIDERS.typesafe.endpoint, model: 'jev-1.13.0', auth: 'Bearer ts-key' });
  assert.deepEqual(calls[1], { url: PROVIDERS.openrouter.endpoint, model: 'typesafe/jev-1.13', auth: 'Bearer or-key' });
  assert.equal(viaOpenRouter.usage.cost, 0.00042, 'OpenRouter reports the charge on the response');
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/systemone');
});

test('a prototype key from storage is not a provider', async () => {
  for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(url); return reply(200, '{}'); };
    await askJev({ ...REQUEST, provider: bad });
    assert.equal(urls[0], PROVIDERS.typesafe.endpoint, `${bad} fell back to TypeSafe`);
  }
});

test('an unknown provider falls back to TypeSafe', async () => {
  const calls = stubFetch([() => reply(200, '{}')]);
  const urls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, options) => { urls.push(url); return real(url, options); };
  await askJev({ ...REQUEST, provider: 'nope' });
  assert.equal(urls[0], PROVIDERS.typesafe.endpoint);
  assert.equal(calls(), 1);
});
