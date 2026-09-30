---
name: slop-filter
description: Install, update, tune, or change Slop Filter, a Chrome and Firefox extension that hides AI-generated posts and comments on X, LinkedIn, Reddit, and YouTube using TypeSafe Jev. Use when the user says "install Slop Filter", "set up slop filter", "update slop filter", "add a tell", "add a question", "add a site", "fit the weights", or is working in a clone of adamnroman/slop-filter.
---

# Slop Filter

A Manifest V3 Chrome and Firefox extension with no application build step and no dependencies. It reads each post, asks TypeSafe Jev a set of narrow questions about the text, combines the answers into one score with weights, and hides posts over the user's threshold. Repo: https://github.com/adamnroman/slop-filter

Pick the section that matches what the user asked for. For anything deeper, read `docs/development.md` in the repo.

## Install it for the user

Chrome does not let a script install an extension. You do the file work, then walk the user through the clicks one step at a time and wait for them to confirm each one.

1. Clone the repo into a new directory inside your current directory. If a clone is already there, run `git pull` in it instead.
2. If Node 20 or newer is installed, run `node --test` in the folder. Tell the user if anything fails. If Node is missing, skip this.
3. Walk the user through the browser:
   - Chrome: open `chrome://extensions`, turn on Developer mode, and click Load unpacked.
   - Firefox: run `node scripts/zip.mjs firefox`, extract the archive, open `about:debugging#/runtime/this-firefox`, click Load Temporary Add-on, and select the extracted root `manifest.json`.
   - In either browser, open the extension's options and paste the TypeSafe API key. It saves on its own. No key yet: send them to https://console.typesafe.ai/keys. If they would rather use OpenRouter credits, pick OpenRouter under "Where to reach Jev" and paste an OpenRouter key from https://openrouter.ai/settings/keys instead. Same model, same answers.
   - Open x.com, linkedin.com, reddit.com, or youtube.com and scroll. On YouTube both comments and videos are scored; the "Score YouTube videos" switch on the options page turns videos off. Every post of 5 or more words gets a small `AI 12%` chip in one corner. Hover the chip for the AI and Human label buttons. Posts over the threshold collapse to `Likely AI · 88% [Show]`.
4. Rules while installing:
   - Never ask the user to paste their API key into the chat. It goes only into the options page.
   - Do not change any files.

If nothing shows up: look for `[xaf]` warnings in the page console. A bar that reads `Upstream API error · HTTP 401 Unauthorized` means the key is wrong.

## Update it

1. `git pull` in the folder.
2. The user opens the extension options and clicks "Reload extension", then reloads their open x.com, linkedin.com, reddit.com, and youtube.com tabs.

Reloading the tab alone is not enough. The browser keeps the extension's page scripts in memory until the extension itself is reloaded. The options page shows a red warning when the files on disk are newer than what the browser is running.

## Change it

Read these before editing:

- `docs/development.md`: how it works, how to tune it, and the traps.
- `src/model.js`: every question, the code-side features, the default weights.
- `src/content.js`: the site-neutral core (finding posts, bars, hiding, Animated mode).
- `src/sites/<site>.js`: one small adapter per site.
- `src/background.js` and `src/jev-client.js`: the only place the API key and the network live.

Rules that keep it working:

- No application build step, no framework, and no dependencies. `node scripts/zip.mjs firefox` builds the Firefox package from the same `manifest.json` as Chrome. Plain scripts are loaded directly by both browsers.
- After any change: run `node --test`, then have the user click "Reload extension" and reload their tabs. You cannot reload it for them. On the user's own copy, also bump a fourth number in `manifest.json` `version` (`0.6.2` to `0.6.2.1`) so the options page can warn about stale code. In a pull request, leave the version alone and add a line under `## [Unreleased]` in `CHANGELOG.md`.
- State on a site's own post element goes in `data-xaf-*` attributes, never classes. X rewrites a post's whole class list on every hover and wipes added classes. Classes are fine on elements the extension creates.
- Shared CSS must not assume a tag name. Site layout fixes go in `src/sites/<site>.css`.
- Constants at the top of each file, no magic strings, small functions.
- Never commit an API key or an exported `labels.json`.

### Add a tell (a question)

1. Add one entry to `QUESTIONS` in `src/model.js`. One narrow judgment per question. Jev reads the words as written, so name the exact pattern, give two or three example phrasings, and use `criteria` to spell out what yes and no mean when the boundary is subtle.
2. Set `needsParent: true` if it only makes sense for a reply. It is then asked only when the post being replied to is known.
3. If plain code can detect the pattern exactly (a character, a regex), add it to `CODE_FEATURES` instead. If it needs judgment about meaning, it is a question, not a word list.
4. Add a starting weight to `DEFAULT_WEIGHTS`. The test suite fails if a feature has no weight.
5. Check the wording against real text: `TYPESAFE_API_KEY=... node scripts/try.mjs "post text" "text it replied to"`.
6. For question design, read the TypeSafe docs index at https://docs.typesafe.ai/llms.txt, mainly the Noul, Score, and "Jev jaggedness" pages.

### Tune the weights

1. The user browses with label buttons on and marks posts `AI` or `Human`. Aim for 100 or more of each.
2. Options page: "Export labels.json".
3. `node scripts/fit.mjs labels.json` fits all sites. Add a site name (`x`, `linkedin`) to fit one.
4. Paste the printed weights JSON into Advanced on the options page and set the threshold the script suggests. A weight near 0 means that question is not helping.

### Add a site

1. Write `src/sites/<site>.js` that sets `globalThis.XAF_SITE` with `name`, `itemSelector`, `extract(element)`, and `parentText(element, post)`. Copy `src/sites/linkedin.js` as the model. `extract` runs often, so keep it cheap, and return `null` for anything that is not a scorable post.
2. Add `src/sites/<site>.css` only if the bar or the collapse needs a layout fix.
3. Add a `content_scripts` entry in `manifest.json` that loads `src/constants.js`, `src/dom-text.js`, the adapter, then `src/content.js`.
4. Inspect the live site before writing selectors. Prefer stable hooks (`data-testid`, `role`, id-like attributes) over class names.

## Report back

Say what you changed, what you ran (`node --test` output, `scripts/try.mjs` results), and what you could not verify. You cannot see the user's browser, so ask them what they see after they reload.
