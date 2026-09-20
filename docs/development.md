# Slop Filter: development

How the extension works inside, how to tune it, and what to know before changing it. For what it is and how to install it, see the [README](../README.md).

## How it works

1. `src/content.js` finds tweets near the viewport and reads their text. On a tweet page it also reads the post being replied to.
2. `src/background.js` sends one request per tweet to Jev with every question in `src/model.js`. It holds the API key. The page never sees it.
3. Jev returns a probability (Noul) or a level (Score) per question. `featureVector` puts each on 0..1.
4. `probability` combines the features with logistic weights. A tweet at or above the threshold is collapsed, animated then collapsed, dimmed, or badged.
5. With labeling on, each scored tweet gets `AI` and `Human` buttons. A click saves the tweet, its features, and your label.

Tweets under 8 words are never scored or hidden.

### Animated mode

Options page: "When a tweet is flagged" > Animated.

1. A tweet is scored when it comes on screen, not ahead of time. A blue-white scan line runs down the tweet, bounces off the bottom, runs back up, and keeps going while the Jev request is in flight. The first trip down always finishes. After that the line stops wherever it is the moment the answer lands.
2. Below the threshold: green fades in over the whole tweet, holds, fades out. The tweet stays.
3. At or above the threshold: red fades in over the whole tweet, then the container closes in on itself and lands on the collapsed bar.

It plays once per tweet. Reload x.com to replay. Tweets that come on screen together start 150 ms apart, top first. Timings are in `ANIMATION` at the top of `src/content.js`. Colors are the `--xaf-*` variables in `src/content.css`.

### When Jev fails

- One scoring call makes the first attempt plus up to 3 retries, with exponential backoff: 0.5 s, 1 s, 2 s. A `retry-after` header is honored up to 4 s.
- Retried: 429, 500, 502, 503, 504, network errors, and 10 s timeouts. Not retried: 400, 401, 403, 422.
- After the last retry the tweet stays visible and its bar reads `Upstream API error · HTTP 429 Too Many Requests` (or the timeout, network, or missing key message). Hover the bar for the raw response body. The same text goes to the console as `[xaf]`.
- Nothing is cached on failure and nothing pauses. The next tweets are scored as normal, and the failed tweet is scored again the next time X rebuilds it, usually when you scroll away and back.

## Install

1. Open `chrome://extensions`, turn on Developer mode, click Load unpacked, pick this folder.
2. Open the extension's options. Paste your TypeSafe API key. Save.
3. Open x.com.

## Make it accurate

The default weights are guesses. Labels fix that.

1. Browse with labeling on. Label tweets you are sure about, both AI and human. Aim for 100+ of each.
2. Options page: Export `labels.json`.
3. `node scripts/fit.mjs labels.json`
   - Prints precision and recall per threshold, measured on tweets the model did not train on.
   - Prints each feature's weight. A weight near 0 means that question is not helping.
   - Prints the weights JSON on stdout.
4. Paste the weights JSON into the options page. Set the threshold to the one the script suggests. Save.

### Add a tell you noticed

1. Add one question to `QUESTIONS` in `src/model.js`. One narrow judgment per question. Name the exact pattern and give two or three example phrasings. Jev reads the words as written.
2. If code can detect it exactly (a character, a regex), add it to `CODE_FEATURES` instead.
3. Add a starting weight to `DEFAULT_WEIGHTS`.
4. Check it: `TYPESAFE_API_KEY=... node scripts/try.mjs "tweet text" "parent text"`
5. Label more, refit. Keep the question if its weight is not near 0 and precision or recall went up.

Labels saved before a question existed do not have that feature. Relabel or collect new ones before judging it.

## Cost

One request per tweet, about 1k input tokens. Jev 1.13 is $0.042 per million input tokens, so 1,000 tweets costs about 4 cents.

## Commands

```bash
node --test                          # unit tests
node scripts/try.mjs "text" ["parent"]   # one tweet through every question
node scripts/fit.mjs labels.json     # fit weights from labels
```

## Notes

- The model is pinned to `jev-1.13.0` in `src/model.js`. Refit after changing it.
- The API key lives in `chrome.storage.local`. Fine for a personal extension. Do not publish it to the store like this.
- After any code change, reload the extension (options page: Reload extension, or the reload icon on `chrome://extensions`), then reload x.com. Reloading x.com alone keeps the old code. Bump `version` in `manifest.json` with each change so the options page can warn when Chrome is behind.
- X rewrites a tweet element's whole class list on every hover, which wipes any class an extension adds. State on the tweet element goes in data attributes (`DATA` in `src/content.js`). Classes are only for elements the extension creates.
- Outside Animated mode, tweets are scored 1500px before they scroll into view, so flagged ones are already hidden when they arrive. Animated mode scores a tweet only when it enters the top three quarters of the viewport.
- X changes its DOM. Selectors are in `SEL` at the top of `src/content.js`.
