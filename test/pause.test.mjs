import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTIFY_AGAIN_MS, PAUSE_CODE, RETRY_MS, WHEN_FORMAT, isActive, noticeFor, pauseFor, shouldNotify } from '../src/pause.js';
import { JevError } from '../src/jev-client.js';

const NOW = Date.parse('2026-09-26T15:00:00Z');
const RESET = '2026-10-01T00:00:00.000Z';

test('a cap refusal pauses until the cap lifts', () => {
  const error = new JevError('Monthly limit reached.', { status: 403, code: 'over_monthly', resetsAt: RESET });
  const pause = pauseFor(error, 'slopfilter', NOW);
  assert.equal(pause.code, PAUSE_CODE.OVER_MONTHLY);
  assert.equal(pause.until, Date.parse(RESET));
  assert.equal(pause.resetsAt, RESET);
  assert.ok(isActive(pause, NOW));
  assert.ok(!isActive(pause, Date.parse(RESET)));
});

test('a billing state pauses for the retry interval, so a fixed card picks up on its own', () => {
  const error = new JevError('Payment failed.', { status: 402, code: 'payment_failed' });
  const pause = pauseFor(error, 'slopfilter', NOW);
  assert.equal(pause.code, PAUSE_CODE.PAYMENT_FAILED);
  assert.equal(pause.until, NOW + RETRY_MS);
  assert.equal(pause.resetsAt, null);
});

test('a missing key and a rejected key pause; an outage does not', () => {
  assert.equal(pauseFor(Object.assign(new Error('No key'), { noKey: true }), 'typesafe', NOW).code, PAUSE_CODE.NO_KEY);
  assert.equal(pauseFor(new JevError('HTTP 401 Unauthorized', { status: 401 }), 'typesafe', NOW).code, PAUSE_CODE.BAD_KEY);
  assert.equal(pauseFor(new JevError('HTTP 503 Service Unavailable', { status: 503 }), 'typesafe', NOW), null);
  assert.equal(pauseFor(new JevError('Request timed out after 10s', { status: 0 }), 'typesafe', NOW), null);
  assert.equal(pauseFor(new JevError('HTTP 400 Bad Request', { status: 400 }), 'typesafe', NOW), null);
});

test('an unknown code from the server is not a pause', () => {
  const error = new JevError('Something', { status: 402, code: 'future_code' });
  assert.equal(pauseFor(error, 'slopfilter', NOW), null);
});

test('a bad reset time falls back to the retry interval', () => {
  const error = new JevError('Daily limit', { status: 403, code: 'over_daily', resetsAt: 'soon' });
  assert.equal(pauseFor(error, 'slopfilter', NOW).until, NOW + RETRY_MS);
});

test('the same problem is announced once, then again only after a while', () => {
  const pause = { code: 'over_daily' };
  assert.ok(shouldNotify(pause, null, NOW));
  assert.ok(!shouldNotify(pause, { code: 'over_daily', notifiedAt: NOW - 1000 }, NOW));
  assert.ok(shouldNotify(pause, { code: 'over_daily', notifiedAt: NOW - NOTIFY_AGAIN_MS - 1 }, NOW));
  assert.ok(shouldNotify(pause, { code: 'over_monthly', notifiedAt: NOW - 1000 }, NOW));
});

test('the notice names the reset day and where a click goes', () => {
  const monthly = noticeFor({ code: 'over_monthly', resetsAt: RESET, provider: 'slopfilter' });
  assert.equal(monthly.title, 'Slop Filter paused');
  assert.match(monthly.message, /this month's posts/);
  assert.ok(monthly.message.includes(new Date(RESET).toLocaleString(undefined, WHEN_FORMAT)), 'says when, in local time');
  assert.equal(monthly.url, 'options');

  const card = noticeFor({ code: 'payment_failed', provider: 'slopfilter' });
  assert.match(card.message, /Update your card/);
  assert.equal(card.url, 'https://slop-filter-api.adamnroman.workers.dev/account');

  const key = noticeFor({ code: 'no_key', provider: 'openrouter' });
  assert.equal(key.message, 'No OpenRouter API key set. Open the options to add one.');
  const rejected = noticeFor({ code: 'bad_key', provider: 'typesafe' });
  assert.equal(rejected.message, 'TypeSafe rejected the API key. Check it in the options.');
});
