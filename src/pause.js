// When scoring cannot go on, the extension pauses instead of showing an error on every
// post: nothing is sent, nothing is drawn, and one notification says why. Pure logic
// here; the background worker owns the timer, the storage, and the notification.
import './constants.js';

const { ACCOUNT_ERROR, PROVIDER, SLOPFILTER_ORIGIN } = globalThis.XAF;

export const PAUSE_CODE = Object.freeze({
  ...ACCOUNT_ERROR,
  NO_KEY: 'no_key',
  BAD_KEY: 'bad_key',
  OUT_OF_CREDITS: 'out_of_credits',
});
// A pause with no reset time is tried again this often, so a fixed card or a new key
// picks up without a reload.
export const RETRY_MS = 15 * 60 * 1000;
// A reset time from the server is trusted only within these bounds: never shorter than
// a minute (a time already past would hammer the server with no pause) and never longer
// than a day and an hour (a daily cap can need no more; a bad value must not stick).
export const MIN_PAUSE_MS = 60 * 1000;
export const MAX_PAUSE_MS = 25 * 60 * 60 * 1000;
// The same problem is not announced again sooner than this.
export const NOTIFY_AGAIN_MS = 6 * 60 * 60 * 1000;
const REJECTED_KEY_STATUS = new Set([401, 403]);
const OUT_OF_CREDITS_STATUS = 402;
const ACCOUNT_PAGE = `${SLOPFILTER_ORIGIN}/account`;
const OPTIONS_PAGE = 'options';

// Caps reset at midnight UTC, which is some other hour locally, so date and time both show.
export const WHEN_FORMAT = Object.freeze({ month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const whenOf = (iso) => new Date(iso).toLocaleString(undefined, WHEN_FORMAT);
const resumesText = (resetsAt) => (resetsAt ? `Scoring resumes ${whenOf(resetsAt)}.` : 'Scoring tries again in about 15 minutes.');
const KEY_NAME = Object.freeze({
  [PROVIDER.TYPESAFE]: 'TypeSafe',
  [PROVIDER.OPENROUTER]: 'OpenRouter',
  [PROVIDER.SLOPFILTER]: 'Slop Filter',
});

// What the notification says, and where a click goes. `options` means the options page.
const NOTICE = Object.freeze({
  [PAUSE_CODE.OVER_MONTHLY]: ({ resetsAt }) => ({
    message: `You've used this month's posts. ${resumesText(resetsAt)} Or switch to your own API key in the options.`,
    url: OPTIONS_PAGE,
  }),
  [PAUSE_CODE.OVER_DAILY]: ({ resetsAt }) => ({
    message: `You've used today's posts. ${resumesText(resetsAt)} Or switch to your own API key in the options.`,
    url: OPTIONS_PAGE,
  }),
  // Reached only when the charge for the paid period did not go through: the server
  // starts the subscription itself at the 100th post when the card works.
  [PAUSE_CODE.TRIAL_OVER]: () => ({
    message: "Your 100 free posts are used up and the $3.99 charge didn't go through. Check your card on your account page.",
    url: ACCOUNT_PAGE,
  }),
  [PAUSE_CODE.PAYMENT_FAILED]: () => ({
    message: "Your payment didn't go through. Update your card on your account page to keep scoring.",
    url: ACCOUNT_PAGE,
  }),
  [PAUSE_CODE.CANCELED]: () => ({
    message: 'Your subscription is canceled. Resubscribe on your account page, or use your own API key.',
    url: ACCOUNT_PAGE,
  }),
  [PAUSE_CODE.NO_CARD]: () => ({
    message: 'Start your free trial on your account page to begin scoring.',
    url: ACCOUNT_PAGE,
  }),
  [PAUSE_CODE.SIGNED_OUT]: () => ({
    message: "This browser isn't paired with your Slop Filter account. Open the options to pair it.",
    url: OPTIONS_PAGE,
  }),
  [PAUSE_CODE.NO_KEY]: ({ provider }) => ({
    message: `No ${KEY_NAME[provider] ?? ''} API key set. Open the options to add one.`.replace('  ', ' '),
    url: OPTIONS_PAGE,
  }),
  [PAUSE_CODE.BAD_KEY]: ({ provider }) => ({
    message: `${KEY_NAME[provider] ?? 'The provider'} rejected the API key. Check it in the options.`,
    url: OPTIONS_PAGE,
  }),
  [PAUSE_CODE.OUT_OF_CREDITS]: ({ provider }) => ({
    message: `${KEY_NAME[provider] ?? 'The provider'} says the account is out of credits. Top up, or pick "Use mine" in the options.`,
    url: OPTIONS_PAGE,
  }),
});

export const NOTICE_TITLE = 'Slop Filter paused';

/**
 * The pause an error calls for, or null when the error is passing (Jev down, a timeout)
 * and the next post should simply try again.
 */
export function pauseFor(error, provider, now = Date.now()) {
  const isPaid = provider === PROVIDER.SLOPFILTER;
  let code = null;
  if (error?.code && Object.hasOwn(NOTICE, error.code)) code = error.code;
  else if (error?.noKey) code = isPaid ? PAUSE_CODE.SIGNED_OUT : PAUSE_CODE.NO_KEY;
  else if (REJECTED_KEY_STATUS.has(error?.status)) code = PAUSE_CODE.BAD_KEY;
  else if (error?.status === OUT_OF_CREDITS_STATUS && !isPaid) code = PAUSE_CODE.OUT_OF_CREDITS;
  if (!code) return null;

  const resetsAt = typeof error.resetsAt === 'string' && !Number.isNaN(Date.parse(error.resetsAt)) ? error.resetsAt : null;
  const wanted = resetsAt ? Date.parse(resetsAt) : now + RETRY_MS;
  return {
    code,
    provider,
    message: error.message,
    resetsAt,
    until: Math.min(Math.max(wanted, now + MIN_PAUSE_MS), now + MAX_PAUSE_MS),
  };
}

export function isActive(pause, now = Date.now()) {
  return Boolean(pause) && now < pause.until;
}

/** A new pause is announced unless the same problem was announced recently. */
export function shouldNotify(pause, previous, now = Date.now()) {
  if (!previous || previous.code !== pause.code) return true;
  return now - (previous.notifiedAt ?? 0) > NOTIFY_AGAIN_MS;
}

export function noticeFor(pause) {
  const { message, url } = NOTICE[pause.code](pause);
  return { title: NOTICE_TITLE, message, url };
}
