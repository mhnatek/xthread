# CLAUDE.md — xthread

## Project overview

Vanilla JS Microsoft Edge browser extension (Manifest V3) that extracts X/Twitter threads from the DOM into plain text. No build step, no npm, no framework — all files are loaded directly as unpacked extension.

## Architecture

- **content/content.js** — injected into x.com tabs; does all DOM work and sends result via `chrome.runtime.sendMessage`
- **popup/popup.js** — orchestrates injection via `chrome.scripting.executeScript`, receives message, handles UI and clipboard/download
- **background.js** — stub only, not used in core flow

## Key technical facts

- X.com uses a virtualized list — only ~10-15 tweets are in the DOM at once. The extractor uses a scroll-and-harvest loop: scroll in `window.innerHeight` steps, harvest visible tweets into a `Map` keyed by tweet ID before X removes them, repeat until stable.
- Thread author is identified from the focal tweet (`/status/<id>` in URL), then all articles are filtered by matching handle. Nested quoted tweet articles are skipped when extracting the handle.
- `data-testid` attributes are used exclusively for selectors — more stable than hashed class names.
- "Show more" / "Mehr anzeigen" buttons are clicked automatically before harvesting each batch.
- Zero Width Space (U+200B) is stripped from all extracted text.
- `xx/yy` markers are scanned from both start and end of tweet text. All candidates are collected; preference order: matches `knownTotal` → end-of-text candidate → smallest total. This prevents false positives like `9/11` (date reference) overriding `5/7` (thread marker).
- `knownTotal` is derived from already-accumulated tweets at each harvest step and passed to `extractNumberMarker`.
- Each harvested tweet is `console.log`-ged to the x.com tab's DevTools console for debugging.
- No early stop on `knownTotal` — scroll continues until DOM count stabilises, to catch follow-up tweets posted after the numbered series.
- Off-thread author replies (replies to other people) are not filtered — X's DOM has no reliable stable selector to distinguish them. This is a known limitation.

## Conventions

- No bundler, no TypeScript, no framework — keep it vanilla JS
- Do not add npm/package.json unless the user explicitly asks for a build step
- All DOM selectors use `data-testid` attributes
- The scroll loop hard limit is 40 rounds (~24s); popup timeout is 35s
- Filename for saved files: `{author}_{date}_{statusId}.txt`
- Do not attempt to filter off-thread replies via DOM heuristics — previous attempts were all unreliable and caused regressions

## Extension permissions

- `activeTab`, `scripting`, `clipboardWrite`
- Host permissions: `https://x.com/*`, `https://twitter.com/*`

## Testing

Load unpacked at `edge://extensions/`. Test against a real X thread URL.
On managed machines, `HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist` must not contain `*`.
