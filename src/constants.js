// Shared by the content script (classic script) and the background worker (module),
// so it attaches to globalThis instead of exporting.
globalThis.XAF = Object.freeze({
  MSG: Object.freeze({
    CLASSIFY: 'xaf/classify',
    LABEL: 'xaf/label',
    IS_BLOCKED: 'xaf/is-blocked',
    BLOCK: 'xaf/block',
    UNBLOCK: 'xaf/unblock',
    BLOCKED_LIST: 'xaf/blocked-list',
    ACCOUNT: 'xaf/account',
    PAIR: 'xaf/pair',
    TEST_NOTICE: 'xaf/test-notice',
  }),
  STORE: Object.freeze({
    API_KEY: 'apiKey',
    PROVIDER: 'provider',
    OPENROUTER_KEY: 'openrouterKey',
    SESSION_TOKEN: 'sessionToken',
    PAUSE: 'pause',
    THRESHOLD: 'threshold',
    MODE: 'mode',
    LABELING: 'labeling',
    STATS: 'stats',
    YOUTUBE_VIDEOS: 'youtubeVideos',
    WEIGHTS: 'weights',
    LABELS: 'labels',
    BLOCKED: 'blocked',
    FLAG_COUNTS: 'flagCounts',
  }),
  MODE: Object.freeze({
    COLLAPSE: 'collapse',
    ANIMATED: 'animated',
    DIM: 'dim',
    BADGE: 'badge',
  }),
  // Where Jev is reached. All three take the same request and return the same answers.
  PROVIDER: Object.freeze({ TYPESAFE: 'typesafe', OPENROUTER: 'openrouter', SLOPFILTER: 'slopfilter' }),
  // Slop Filter's own server: scores on its key, meters, and bills. The session token
  // it issues is sent exactly where an API key would be.
  SLOPFILTER_ORIGIN: 'https://slop-filter-api.adamnroman.workers.dev',
  // Error types the server answers with. Their messages are written for the chip.
  ACCOUNT_ERROR: Object.freeze({
    SIGNED_OUT: 'signed_out',
    NO_CARD: 'no_card',
    TRIAL_OVER: 'trial_over',
    PAYMENT_FAILED: 'payment_failed',
    CANCELED: 'canceled',
    OVER_DAILY: 'over_daily',
    OVER_MONTHLY: 'over_monthly',
  }),
  LABEL: Object.freeze({ AI: 1, HUMAN: 0 }),
  // Flagged posts from one account before the extension offers to block it.
  BLOCK_AFTER_FLAGS: 3,
  DEFAULTS: Object.freeze({
    threshold: 0.75,
    mode: 'collapse',
    labeling: true,
    provider: 'typesafe',
    stats: false,
    // Scoring a video means fetching its captions: two requests to YouTube and about
    // half a megabyte each. On by default; the toggle is for people who only want comments.
    youtubeVideos: true,
  }),
});
