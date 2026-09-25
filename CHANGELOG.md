# Changelog

Every release of Slop Filter. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Each release is a git tag `vX.Y.Z` that matches `version` in `manifest.json`, with a GitHub Release that carries the extension as a zip.

## [Unreleased]

### Added

- YouTube videos, on the home grid and in search results. A video is judged by its script: an excerpt of its captions from the first minute, scored with the questions about typing and punctuation left out. Videos without English captions are left alone.
- Blocked accounts. After three flagged posts from one account, the flagged post offers to block it. A blocked account's posts fold on sight and are never scored. Hover any score for a Block button. The options page lists blocked accounts with unblock, export, and import. Works on every site.

## [0.8.0] - 2026-09-24

### Changed

- Human first. Human tells now settle a post on their own: an invented word, a joke, repetition for emphasis, a stretched word, a typo, or unpolished prose, when Jev is confident of it, makes the post human and no AI rule can override it. Then the AI hard rules, then the weighted sum. With no tell on either side a post is human. Three real human posts flagged as AI in one day prompted this.

### Added

- Word formation tells: a compressed coinage used as a known term ("keep rate", "review-rejection rate"), a reference to a frame the reader never saw ("the missing one is..."), and the spotlight praise formula ("is the part that jumps out"). The first and last are hard rules. An engagement close ("Curious if anyone...") is back as a phrasing tell, and a coined metaphor treated as an established category counts as an invented label.

### Changed

- The starting point leans toward flagging. A short post shows one or two tells at most, and a false positive costs less than a miss.
- Performed casualness now covers lowercase over precise prose, not only over polished prose.
- Human cadence tells. Repetition for emphasis, expression through the typing itself (stretched letters, stacked punctuation, caps, typed laughs), and slips now pull a score down, and a confident one stops any hard rule from flagging the post alone. Casual slang by itself does not count.
- The contrast pivot is narrower: a comparison, a recommendation, a preference, or a correction is not a pivot.

## [0.7.0] - 2026-09-22

### Added

- YouTube comments. The score chip sits in the comment's header row, after the time. A flagged comment folds to one row and its replies stay visible.

### Changed

- Hard rules. A few tells are decisive alone: a contrast pivot nobody prompted, chatbot leftovers, and an announced insight. When Jev is fairly confident of one, the post is flagged on that alone, however short it is, and the hover breakdown says which rule fired. A pivot that rejects something the replied-to post really said is an answer, not a tell, and Jev checks for that when the post is known.
- The detection rules were replaced. They now judge cadence and prose, not meaning, so a person being generic or restating the post they answer is no longer held against them. The new rules follow the unpolish-ai-writing skill's three buckets (assistant residue, false profundity, machine cadence) and its word tiers, plus a circumvention group: colons, semicolons, and spaced hyphens standing in for the em dash, and casual markers bolted onto polished prose. The contrast pivot is recognized in every order ("X, not Y", "Y instead of X", "less X, more Y"), and a post that announces its own insight ("The catch is...") is a tell. Weights fitted to the old rules no longer apply. Labels saved under the old rules carry the old scores and need collecting again.
- On X, a reply shown under the post it answers, in the home timeline or on a status page, is now linked to that post. The link is saved with labels. The current rules judge prose only, so it is not sent to Jev. A person continuing their own thread is not treated as a reply.

## [0.6.5] - 2026-09-20

### Added

- Reddit support: feed posts, opened posts, and comments on www.reddit.com. A flagged comment folds its own text and leaves its replies visible.
- A tell for the insight reframe: "the hard part is...", "the real work is...", "what most people miss...". It runs on every post and carries a heavy starting weight.
- Hover a post's percentage to see why it got that score: each check's pull, strongest first, and any reply-only questions that were not asked.
- Live stats panel for demos: posts scanned, slop caught, last and average request time, questions answered, tokens, total cost, and cost per 1,000 posts. Off by default, on the options page.
- A privacy policy, and a demo clip at the top of the README.

### Changed

- The score is a small chip instead of a full row under every post, so scoring a post no longer makes it taller. The AI and Human label buttons appear when the chip is hovered. A collapsed post still gets the full row.
- Each site places the chip where it has room. On X it sits in the header row. On Reddit comments it sits inline, to the right of Reddit's own badges under the username.
- Posts of 5 or more words are scored. The cutoff was 8, which let one and two phrase slop through.
- The options page saves each setting the moment it changes. The Save button is gone.

## [0.6.4] - 2026-09-20

### Changed

- New extension icon, by HideMaru from Flaticon, credited in the README, the options page, and `assets/icons/ATTRIBUTION.txt`.

## [0.6.3] - 2026-09-20

### Added

- Extension icons, made from the options page mascot. The Chrome Web Store requires them.

## [0.6.2] - 2026-09-19

### Added

- MIT license, `CONTRIBUTING.md`, and `SKILL.md`, which teaches a coding agent to install, update, tune, and change the extension.
- This changelog, release tags, and a GitHub Action that publishes a release with an extension zip when a version tag is pushed.

### Changed

- The qualifier tell is now narrower: calling something "real" when no fake or surface version of it was mentioned. A contrast that was set up first, and fixed terms like "real estate", do not count.
- The README install prompt is one sentence that points an agent at `SKILL.md`.

### Removed

- The filler adverb word list. It flagged words people use all the time.

## [0.6.1] - 2026-09-19

### Added

- A reply-only tell: does the reply turn the post into a general lesson that would fit under almost any post on the topic.
- A tell for emphasis words that add no meaning.
- A filler adverb word list (removed again in 0.6.2).

## [0.6.0] - 2026-09-19

### Added

- LinkedIn support: feed posts and comments. A comment is judged against the post it sits under.
- Per-site adapters in `src/sites/`. The core is site-neutral, so a new site is one small file.
- Tells common on LinkedIn: "thrilled to announce" framing, emoji bullet lists, and a pile of hashtags at the end.
- Labels record their site, and `scripts/fit.mjs` can fit the weights for one site.
- A redesigned options page: bundled Fredoka font, flat colors, light and dark.

### Changed

- The state sent to Jev calls the text `post.text` instead of `tweet.text`.

## [0.5.2] - 2026-09-19

### Changed

- Renamed from X AI Filter to Slop Filter.

## [0.5.1] - 2026-09-19

The first version in this repository. Versions 0.1.0 to 0.5.0 were development builds from before the repository existed.

### Added

- Scores every post on X with TypeSafe Jev: a set of narrow questions per post, combined into one probability with logistic weights.
- Four ways to treat a flagged post: Collapse, Animated, Dim, and Badge.
- Animated mode: a scan line bounces over the post while Jev decides, then the post turns green and stays, or turns red and closes in on itself.
- AI and Human label buttons on every scored post, with export, and `scripts/fit.mjs` to fit the weights from the labels.
- Retries with exponential backoff, then an `Upstream API error` line in the bar in place of the score.
- An options page with the API key, threshold, flag mode, weights, a Reload extension button, and a warning when Chrome is running older code than the files on disk.

[Unreleased]: https://github.com/adamnroman/slop-filter/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/adamnroman/slop-filter/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/adamnroman/slop-filter/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/adamnroman/slop-filter/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/adamnroman/slop-filter/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/adamnroman/slop-filter/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/adamnroman/slop-filter/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/adamnroman/slop-filter/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/adamnroman/slop-filter/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/adamnroman/slop-filter/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/adamnroman/slop-filter/releases/tag/v0.5.1
