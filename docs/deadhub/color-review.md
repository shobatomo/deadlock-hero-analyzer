# Deadhub section palette review

Base: `bf452e48f1456f54588fd76812e51e7e44f94317` on `deadhub/record-mvp`.

This local revision separates the record sections by hue while retaining muted backgrounds. The calendar remains green; the daily summary is blue, match list warm brown, and monthly trends purple. Labels and borders carry the stronger accents. Section colors are constant across values, wins, losses and missing data.

| Section | Background | Border |
| --- | --- | --- |
| Calendar (unchanged) | `#192720` | `#748b66` |
| Daily summary | `#162b3c` | `#6c9fbe` |
| Match list | `#342820` | `#b58a65` |
| Monthly trends | `#28223b` | `#9381ba` |

The calendar remains first, with its existing fixed cell dimensions and recorded/unrecorded colors. Warning colors and wording remain unchanged in the page-level alert, separate from normal titled record panels. Match outcomes retain a shared neutral badge style. Item category colors, item modal styles, chart series colors and all JavaScript behavior remain unchanged. The more specific trend container selector preserves the purple background despite CSS import order.

## Verification

- Node 22.22.1: all 160 existing Deadhub regression tests passed.
- Vite production build passed.
- Local Chromium: all 12 cases passed (1280, 390 and 320px; complete, partly missing, all missing and zero-plus-missing healing values).
- Calendar cells remained 54 / 48 / 44px high, respectively, with uniform widths of approximately 59.39 / 41.42 / 34px. No horizontal overflow or browser errors occurred.
- Section backgrounds and border hues were checked from computed styles. The closest pair of section border hues was approximately 56.26 degrees apart. Hue checks are supplemental; screenshots at all three widths were also reviewed visually.
- Measured text contrast for section headings, labels, statistics, notes and chart controls/readouts was at least 7.31:1. This is a targeted contrast check, not a complete accessibility certification.
- Synthetic sync failure retained the original alert colors and existing records. Calendar navigation and keyboard/touch date selection continued to work.
- Item modal regression passed at all three widths: desktop click, mobile long press, short-touch rejection, scroll/pointer cancellation, Escape, Enter/Space, close button, outside click, focus containment/restoration, compact dimensions and name/image preservation after detail failure.
- Public bundle verification passed: 138 source files, 55 generated files, zero source maps, zero sensitive-pattern hits and no external calls.
- Direct comparison against the base confirmed unchanged page JSX, trend JSX, item modal JSX/CSS, item text formatter, calendar state rules and alert rules.

## Reproduce

From the repository root, using Node 22 or later and existing dependencies:

```powershell
$cases = Get-ChildItem tests -Filter 'deadhub-*.test.mjs' | ForEach-Object FullName
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs --test $cases
node public-app/frontend/node_modules/vite/bin/vite.js build public-app/frontend
node tests/deadhub-design-browser.mjs <playwright-index.mjs> <chromium.exe> <output-directory>
node public-app/scripts/verify-public-bundle.mjs
```

Screenshots, the local offline modal runner, its results, test logs, unchanged-contract audit and a review patch are stored outside the checkout in `C:/Users/Owner/AppData/Local/Temp/deadhub-colors-review`. Browser data is synthetic; existing item fixtures were used with local substitute images. No real match fetch, authenticated production session, physical mobile device or non-Chromium engine was tested for this revision.

The patch changes two CSS files, their manifest metadata, the existing browser regression script and this review note. No DB, authentication, permissions or environment settings were changed. No commit, push or deployment was performed.
