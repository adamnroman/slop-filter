# Contributing to Slop Filter

Thanks for helping. The most useful contributions, in order:

1. **A tell you noticed.** A pattern that gives away AI-written posts, turned into one question.
2. **A new site.** Reddit and YouTube are next. Anything with a feed works.
3. **Fixes.** Sites change their pages often, so selectors break.

## Set up

1. Fork and clone the repo.
2. Open `chrome://extensions`, turn on Developer mode, click Load unpacked, pick the folder.
3. Open the extension's options and paste your [TypeSafe API key](https://console.typesafe.ai/keys).
4. Run the tests: `node --test` (Node 20 or newer).

There is no build step and there are no dependencies. Please keep it that way.

Using a coding agent? Point it at [SKILL.md](SKILL.md). It covers setup and every kind of change below.

## Make a change

1. Branch from `main`.
2. Make one focused change.
3. Bump `version` in `manifest.json`.
4. Run `node --test`.
5. Click "Reload extension" on the options page, then reload your open tabs. Reloading the tab alone keeps the old code running.
6. Open a pull request. Say what you changed, which sites and flag modes you tried it on, and what you could not check. Add a screenshot or a short clip for anything visual.

Commit titles follow `feat:`, `fix:`, `docs:`, `chore:`.

## Add a tell

A tell is one entry in `QUESTIONS` in `src/model.js`.

- One narrow judgment per question. "Does it open with praise?" is good. "Does it sound like AI?" is not.
- Jev reads the words as written. Name the exact pattern, give two or three example phrasings, and use `criteria` when the line between yes and no is subtle.
- Set `needsParent: true` if it only makes sense for a reply.
- If plain code can detect the pattern exactly, add it to `CODE_FEATURES` instead. If it needs judgment about meaning, make it a question. Word lists flag normal writing.
- Give it a modest starting weight in `DEFAULT_WEIGHTS`. The tests fail if a feature has no weight.
- In the pull request, show it working: the output of `node scripts/try.mjs "post text" "text it replied to"` on a few posts it should catch and a few it should leave alone. Paraphrase the posts or use your own. Do not paste other people's posts with their names.

## Add a site

A site is one adapter in `src/sites/<site>.js`. Copy `src/sites/linkedin.js`. The contract is in [docs/development.md](docs/development.md).

- Inspect the live site first. Prefer stable hooks (`data-testid`, `role`, id-like attributes) over class names.
- `extract` runs often. Keep it cheap, and return `null` for anything that is not a scorable post.
- Add a `content_scripts` entry in `manifest.json`, and a `src/sites/<site>.css` only if the bar or the collapse needs a layout fix.
- Some sites restrict extensions that change their pages. Say so in the adapter's notes in `docs/development.md`.

## House rules

- State on a site's own post element goes in `data-xaf-*` attributes, never classes. X rewrites a post's class list on every hover. Classes are fine on elements the extension creates.
- Shared CSS must not assume a tag name.
- Constants at the top of each file, no magic strings, small functions.
- The API key and all network calls stay in `src/background.js` and `src/jev-client.js`. The page never sees the key.
- Never commit an API key. Never commit an exported `labels.json`: it holds other people's posts and handles.

## Report a bug

Open an issue with:

- The site and the flag mode (Collapse, Animated, Dim, Badge).
- The version shown at the top of the options page.
- Any `[xaf]` warnings from the page console.
- What you expected and what happened.

Never paste your API key into an issue.

## License

Slop Filter is [MIT licensed](LICENSE). By contributing, you agree that your contributions are licensed under the same terms. The bundled Fredoka font is under the SIL Open Font License, in `assets/fonts/fredoka-OFL.txt`.
