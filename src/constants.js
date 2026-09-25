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
  }),
  STORE: Object.freeze({
    API_KEY: 'apiKey',
    PROVIDER: 'provider',
    OPENROUTER_KEY: 'openrouterKey',
    THRESHOLD: 'threshold',
    MODE: 'mode',
    LABELING: 'labeling',
    STATS: 'stats',
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
  // Where Jev is reached. Both take the same request and return the same answers.
  PROVIDER: Object.freeze({ TYPESAFE: 'typesafe', OPENROUTER: 'openrouter' }),
  LABEL: Object.freeze({ AI: 1, HUMAN: 0 }),
  // Flagged posts from one account before the extension offers to block it.
  BLOCK_AFTER_FLAGS: 3,
  DEFAULTS: Object.freeze({
    threshold: 0.75,
    mode: 'collapse',
    labeling: true,
    provider: 'typesafe',
    stats: false,
  }),
});
