# Slop Filter: development

How the extension works inside, how to tune it, and what to know before changing it. For what it is and how to install it, see the [README](../README.md).

## How it works

1. `src/content.js` is the site-neutral core. It finds posts near the viewport through a site adapter in `src/sites/` and reads their text, plus the post being replied to when the adapter knows it.
2. `src/background.js` sends one request per tweet to Jev with every question in `src/model.js`. It holds the API key. The page never sees it.
3. Jev returns a probability (Noul) or a level (Score) per question. `featureVector` puts each on 0..1.
4. `probability` combines the features with logistic weights. A tweet at or above the threshold is collapsed, animated then collapsed, dimmed, or badged.
5. With labeling on, each scored tweet gets `AI` and `Human` buttons. A click saves the tweet, its features, and your label.

Posts under 5 words are never scored or hidden. The cutoff is `MIN_WORDS` in `src/content.js`.

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

### Sites

Each site is one small adapter in `src/sites/<site>.js` that sets `globalThis.XAF_SITE`:

- `name`: short id, saved on every label.
- `itemSelector`: matches every element that might be a scorable post.
- `extract(element)`: returns `{ id, handle, text }`, or `null` to skip the element. It runs often, so keep it cheap.
- `parentText(element, post)`: text of the post being replied to, or `null`. It runs once per post.
- `chipHosts(element)`: optional. Elements in the site's own header line that the score chip may be mounted in, best spot first. Return an empty list for items that have none. See "Where the score goes" below.

To add a site: write the adapter, add a `src/sites/<site>.css` for layout fixes if needed, and add a `content_scripts` entry in `manifest.json` that loads `constants.js`, `dom-text.js`, the adapter, then `content.js`.

- **X**: posts are `article[data-testid="tweet"]`, ids come from the permalink. A reply's parent is the tweet X draws it joined to: X connects a conversation with a 2 px line through the avatars, and a tweet that answers the one above it has a short piece of that line above its own avatar. That works in timelines and on status pages. A person continuing their own thread gets no parent. Failing that, on a status page, tweets under the opened tweet get it as their parent.
- **LinkedIn**: the React front end has no stable class names. Posts are `role="listitem"` elements whose `componentkey` starts with `update-card`. Comments carry their URN in `componentkey` on several nested wrappers, and only the outermost counts. Text is in `data-testid="expandable-text-box"`, complete even when clamped behind "... more". Posts expose no id, so the id is a hash of author plus text. A comment's parent is the post it sits under.
- **Reddit** (www.reddit.com, not old.reddit.com): posts and comments are sealed web components, `shreddit-post` and `shreddit-comment`. A bar placed directly inside one may not render, and hiding its children leaves its vote and header chrome behind. So the items are the plain containers: the `article` that directly wraps a feed post (the whole card collapses), an opened post's `[slot="text-body"]`, and each comment's `[slot="comment"]` (only the text folds, replies stay). A post's text is its title plus the body on the page. A comment's parent is the comment it is nested under, or the post. These selectors came from other open source Reddit extensions and were tested against fake pages. The maintainer confirmed it working on the live site on 2026-09-20. If scores do not show up, check `SEL` in `src/sites/reddit.js` first.
  - A visible comment's chip is inline in the comment's meta area, `[slot="commentMeta"]`, which holds the username, the time, and Reddit's own badges. `chipHosts` offers three spots, best first: the end of the line that holds Reddit's badges (`shreddit-comment-badges`, `author-flair-event-handler`, `community-achievements-flair`), so the chip sits to their right, then the end of the line with the time (`[noun="comment_time"]`), then the meta area itself. Only the comment's own meta area counts, never a nested reply's.
  - This spot was not inspected live either. It comes from other open source extensions on GitHub: RedditEnhancer (`joelacus/RedditEnhancer`) and Reddit++ (`lnm95/redditPlusPlus`) both insert their own elements inside `[slot="commentMeta"]`, next to the author and the time.
  - A comment with no meta area of its own, feed posts, and opened posts keep the floating chip.
- **YouTube** (comments only): every comment is a `ytd-comment-view-model` with its text in `#content-text`, complete even behind "Read more". The id is the `lc` parameter of the timestamp link. A reply's parent is the top comment of its thread, and a top comment's parent is the video title. The chip goes inline at the end of the header row `#header-author`. YouTube enforces Trusted Types, so never use `innerHTML`. Judging the videos themselves by their scripts is parked on the `feat/youtube` branch.
- LinkedIn's terms restrict extensions that change its pages. Use it on your own account at your own risk.

#### Where the score goes

- By default the chip floats over a corner of the item, so it adds no height. A site moves it with `--xaf-chip-top`, `--xaf-chip-right`, and `--xaf-chip-bottom` in its CSS.
- With `chipHosts`, a visible item's chip is mounted at the end of a host instead, as an inline pill (`.xaf-bar.xaf-inline` in `src/content.css`). It is 14px tall, buttons included, so it fits the 16px line of 12px meta text.
- The core tries the hosts in order. It keeps the first one where the chip shows up and the host stays the same height. A host that grows means the chip wrapped or took a row of its own, so the next one is tried. When none fits, the chip floats over the item as before.
- A host belongs to one item. Before mounting, the core removes any chip already in the hosts, which covers a site that rebuilt the item but kept its header.
- A collapsed item's full row and the error row always go in the item. The row stands in for the hidden text.
- The core tracks each item's bar in a `WeakMap`, because the bar may be outside the item. When the site wipes the chip, the next scan puts it back. A site that wipes it 3 times in a row, each within 2 seconds of the last, gets the floating chip for that item from then on (`HOST_LOSS` in `src/content.js`).
- A click on the chip calls `preventDefault` and `stopPropagation`, so a chip inside a `summary` or a link does not fold the comment or navigate.

## Install

1. Open `chrome://extensions`, turn on Developer mode, click Load unpacked, pick this folder.
2. Open the extension's options. Paste your TypeSafe API key. Settings save on their own.
3. Open x.com.

## Make it accurate

The default weights are guesses. Labels fix that.

1. Browse with labeling on. Label tweets you are sure about, both AI and human. Aim for 100+ of each.
2. Options page: Export `labels.json`.
3. `node scripts/fit.mjs labels.json`
   - Prints precision and recall per threshold, measured on tweets the model did not train on.
   - Prints each feature's weight. A weight near 0 means that question is not helping.
   - Prints the weights JSON on stdout.
4. Paste the weights JSON into Advanced on the options page and click outside the box. Set the threshold to the one the script suggests.

### What the rules judge

Cadence and prose, not meaning. A person can be generic, restate the post they answer, or say nothing new. That is human slop and it must not be flagged as AI. So no rule asks whether a post is generic, engaged, or original.

The rules in `src/model.js` follow the three buckets of the [unpolish-ai-writing](https://github.com/wilu222/unpolish-ai-writing) skill (MIT), plus one group of our own:

- **Assistant residue**: chatbot leftovers, flattery openers, and the contrast pivot in every order: "It's not X, it's Y", "X, not Y", "Y instead of X", "less X, more Y". Jev reads literally, so each order has to be named. Two real posts were missed when only the first form was.
- **False profundity**: announcing its own insight ("The catch is...", "This is a useful inversion:"), invented concept labels, stakes inflation, unnamed authorities, three matching beats, verbless fragments, rhythm so uniform it reads rehearsed.
- **Machine cadence**: synonym cycling, stacked one-line punchlines, dropped subjects, tidy bows, significance paint.
- **Circumvention**: what a model does when told to avoid the known tells. The em dash becomes a colon, a semicolon, or a spaced hyphen, which people rarely use in casual posts. Polished prose gets a lone "lol" or all-lowercase letters bolted on.

**Hard rules.** A weighted sum suits tells that add up. Some tells do not add up: they are decisive alone. `HARD_RULES` in `src/model.js` lists them (`unprompted_pivot`, `assistant_residue`, `announced_insight`). When Jev's confidence in one reaches `HARD_RULE_BAR` (0.75), the post is flagged on that alone, however short it is, and Jev's confidence becomes the score. Below the bar the same tell is an ordinary weight. The hover breakdown names the hard rule that fired.

The pivot is only decisive when nobody raised the alternative it rejects. "It's economics, not benchmarks" is a real answer to a post about benchmarks, and a tell everywhere else. So when the replied-to post is known, a second question, `pivot_answers_parent`, asks whether that post actually says or implies the rejected idea, and code discounts the pivot by Jev's confidence that it does (`unprompted_pivot`). The two judgments are separate questions because Jev is weaker when one question needs two steps. This is the only reason the replied-to post is sent to Jev. A reply whose parent is not on the page (X labels these "Replying to") cannot be checked, so the pivot is not decisive there.

**Human tells.** The mirror of a hard rule. Three questions ask whether a person typed the post, judged by the shape of the words and not the vocabulary: repetition for emphasis ("way, way, way better"), expression through the typing (stretched letters, stacked punctuation, caps, typed laughs), and slips (typos, self-corrections, trailing thoughts). Casual slang alone does not count: a model reaches for "tbh" when told to sound casual, a person stretches and mistypes. When Jev's confidence in one reaches `HUMAN_VETO_BAR` (0.75), no hard rule may flag the post; the weighted sum still runs, with the human tells pulling it down. Code counts the same shapes as negative-weight features. This came from a real human post flagged at 87%: Jev misread "sorry about that one, try this one" as a pivot and the hard rule took it as decisive.

`scripts/fit.mjs` fits the weighted sum only. Hard rules and the human veto sit on top of it.

`src/vocab.js` holds the skill's word tables as three tiers with its counting rules: one always-tier word is a nudge and two is the full signal, the cluster tier needs two together, and the density tier only counts when the text is soaked, about 3% of its words. Words that are only a tell in one sense ("quietly", "landscape", "robust", "lands") are not counted by code. They are examples in the `paint_words` question, where Jev can tell the senses apart.

The old meaning-based rules (generic content, missing voice, restates the post, generic lesson, insight reframe, unearned "real") were removed on 2026-09-21 as an experiment. They are in the git history before that date.

### Add a tell you noticed

1. Add one question to `QUESTIONS` in `src/model.js`. One narrow judgment per question. Name the exact pattern and give two or three example phrasings. Jev reads the words as written.
2. If code can detect it exactly (a character, a regex), add it to `CODE_FEATURES` instead.
3. Add a starting weight to `DEFAULT_WEIGHTS`.
4. Check it: `TYPESAFE_API_KEY=... node scripts/try.mjs "tweet text" "parent text"`
5. Label more, refit. Keep the question if its weight is not near 0 and precision or recall went up.

Labels saved before a question existed do not have that feature. Relabel or collect new ones before judging it.

## Cost

One request per tweet, about 1k input tokens. Jev 1.13 is $0.042 per million input tokens, so 1,000 tweets costs about 4 cents.

## Versions and releases

- A release is three numbers (`0.7.0`), follows [Semantic Versioning](https://semver.org/), and has a git tag `v0.7.0`, a section in `CHANGELOG.md`, and a GitHub Release with the extension as a zip.
- Between releases, bump a fourth number in `manifest.json` (`0.6.2.1`, `0.6.2.2`) when you change code. That is what lets the options page warn that Chrome is running older code. Leave `package.json` alone. Chrome allows four numbers, and the release script refuses them, so a development build can never be tagged by mistake.
- Every change adds a line under `## [Unreleased]` in `CHANGELOG.md`.

To cut a release:

1. Set the new three-number version in `manifest.json` and `package.json`.
2. In `CHANGELOG.md`, move the Unreleased notes under `## [x.y.z] - yyyy-mm-dd`, and add the compare link at the bottom.
3. Commit.
4. `node scripts/release.mjs`. It checks the branch, a clean tree, matching versions, the changelog section, and the tests, then creates the annotated tag. It never pushes.
5. `git push origin main vX.Y.Z`. The Release workflow (`.github/workflows/release.yml`) checks the tag against the manifest, runs the tests, builds the zip, and publishes the GitHub Release with that version's notes.

## Commands

```bash
node --test                          # unit tests
node scripts/try.mjs "text" ["parent"]   # one tweet through every question
node scripts/fit.mjs labels.json [site]  # fit weights from labels, all sites or one
node scripts/release.mjs                 # check everything and tag a release (never pushes)
```

## Notes

- The model is pinned to `jev-1.13.0` in `src/model.js`. Refit after changing it.
- Each user brings their own TypeSafe API key. It lives in `chrome.storage.local` in their browser and is only ever sent to `api.typesafe.ai`. No key ships with the extension.
- Chrome Web Store upload: `node scripts/zip.mjs` builds `dist/slop-filter-<version>.zip` with only the files Chrome needs. The store wants a higher `version` on every upload.
- After any code change, reload the extension (options page: Reload extension, or the reload icon on `chrome://extensions`), then reload x.com. Reloading x.com alone keeps the old code. Bump the fourth number of `version` in `manifest.json` with each change (see Versions and releases) so the options page can warn when Chrome is behind.
- X rewrites a tweet element's whole class list on every hover, which wipes any class an extension adds. State on the tweet element goes in data attributes (`DATA` in `src/content.js`). Classes are only for elements the extension creates.
- Outside Animated mode, tweets are scored 1500px before they scroll into view, so flagged ones are already hidden when they arrive. Animated mode scores a tweet only when it enters the top three quarters of the viewport.
- The score is a chip that floats over a corner of the post (`.xaf-bar` in `src/content.css`), so scoring never changes a post's height. A site moves it with `--xaf-chip-top`, `--xaf-chip-right`, and `--xaf-chip-bottom` in its CSS: on X the free space is in the header row, left of the Grok and menu icons. On Reddit comments the chip is inline in the comment's meta line instead (see "Where the score goes"). Only a collapsed post and an error get a full row.
- X changes its DOM. Selectors are in `SEL` at the top of `src/content.js`.
