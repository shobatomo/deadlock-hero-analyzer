# Final item description modal — local review

Base: `deadhub/record-mvp` at `b0be252a8377dec938a1da2d4cbd9fa3d144c806`.
Verified on 2026-10-16. Local implementation only; no commit, push or deployment.

## Changes

- Removed 「選択すると名前を確認できます」. Mouse click, Enter/Space and touch/pen hold (550 ms) open a compact item modal, at most 380 px wide and 560 px high.
- The native modal dialog contains the saved icon/name, effect sections, a close button and a small current-base-values disclaimer. Escape, backdrop click, focus trapping/restoration and a keyboard-scrollable effects region are supported.
- Touch movement over 10 px, scrolling, pointer cancellation/leaving, another pointer, window blur, visibility changes, resync and unmount cancel an unfinished hold. A release click from a completed hold is suppressed even when the newly opened close button sits under the finger. A new pointer or keyboard action immediately restores ordinary interaction.
- Details load on demand from `GET https://api.deadlock-api.com/v1/assets/items/{id}?language=japanese`, without credentials/referrer. The public endpoint returned HTTP 200 and `Access-Control-Allow-Origin: *` for the inspected basic-magazine ID. Successes are cached for six hours; failures for one minute; both caches share a 100-entry bound. Requests time out after eight seconds, are aborted on close, and reject bodies over 512 KiB or mismatched item identities/types.
- Section/attribute order is retained. Only referenced `properties`, `important_properties`, `elevated_properties` and `important_properties_with_icon` are displayed. There is no property-dictionary enumeration. Description fields `desc`, `desc2`, `passive`, `active` fill gaps without repeating identical section text.
- HTML is parsed in an inert document and returned as text only. Script/style/SVG and other non-content subtrees are removed; line breaks and decoded entities are retained. No `innerHTML` or `dangerouslySetInnerHTML` insertion is used. Zero values, existing signs and units are preserved. Unresolved text is omitted with an incomplete-data notice; conditional properties retain their condition or a conditional/unknown-condition label.
- Saved names and images remain visible during loading, empty details and request failure. Current API values are never substituted for saved identity. No description columns or DB writes were added. `public-app/backend/deadhub/item-assets.js` was inspected and needed no change.
- The public source manifest is updated only for the two UI files and the new details module.
- Final review fixes: Frenzy's `4m` plus ` m／秒` is rendered as `4m／秒`; aborted late responses cannot overwrite a newer cache entry. Unknown affixes are treated as incomplete instead of silently losing a unit/sign. Icon-property reference objects resolve their names against the top-level dictionary, without trusting an icon URL or inventing a missing value.

## Validation

Node 22.22.1; repository lockfiles installed with `npm ci --ignore-scripts`. No runtime/dev dependencies or package/lockfile changes. Playwright was installed only in a separate temporary verification-tools directory, not added to the repository.

```sh
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs \
  --test --test-reporter=spec tests/deadhub-*.test.mjs \
  public-app/scripts/test-feedback-store.mjs \
  public-app/scripts/test-windows-usage-probe.mjs
```

**135 passed, 0 failed, 0 skipped**. This covers all 121 tests in the previous release's recorded scope plus 14 new modal tests. The previous release's `validation-support/lock-tests-results.json` establishes the count as 107 Deadhub tests + 8 feedback-store tests + 6 Windows usage-probe tests. The exact base SHA was also tested in a separate extracted copy: all 107 Deadhub tests passed (only the review loader's dependency paths were pointed to the same unchanged locked packages).

The first modal report's 71 was a narrower run: 31 item-related tests + 40 record/trend tests. It excluded 46 existing tests (auth 11, database initialization 9, profile 15, runtime 11), and the two auxiliary suites (14 tests). Final coverage is 35 item-related + 40 record/trend + 46 other Deadhub + 14 auxiliary = 135.

The existing store/DB/auth tests use synthetic fixtures, mocks and idle pools; they make no real database or authentication connection. Added cases include script/style/SVG subtree removal, decoded entities/line breaks, section references, zero/units/conditions, unknown affixes, object references, abort/cache behavior, rapid repeated clicks, close-then-late-response, switching/reopening items, image fallback, hold cancellation/release, focus trap and restoration.

```sh
cd public-app/frontend
node node_modules/vite/bin/vite.js build
cd ..
node scripts/verify-public-bundle.mjs
```

Production build passed. Public bundle validation passed: 136 source files, 55 artifacts, zero source maps, zero sensitive-pattern hits, local route checks passed, zero external calls. `git diff --check` passed.

```sh
node tests/deadhub-item-modal-browser.mjs <path-to-playwright/index.mjs> <path-to-chromium> <output-directory> --live-api
```

Chromium browser checks passed at **1280, 390 and 320 px**, including touch input via the browser's input pipeline at mobile widths. Checked short tap versus long hold, movement/scroll and pointercancel, focus containment/restoration, Enter/Space/Tab/Shift+Tab/Escape, backdrop and close button, cache reuse, scrollable long effects, API failure with saved name/image, no horizontal overflow, and no page exceptions. Nine screenshots show basic, long/active and failed descriptions across all three widths; representative screenshots were visually inspected. Match records are synthetic. Item descriptions are public API snapshots; no real account/session/records were used.

Additional desktop browser cases confirm safe HTML/SVG removal, conditional `4m／秒`, zero retention and exclusion of unreferenced properties. With `--live-api`, the real application also successfully fetched and rendered the unmocked item endpoint from localhost: HTTP 200, `Access-Control-Allow-Origin: *`, no Cookie, Authorization or Referer request headers. A separate live-API screenshot records this result.

The existing `tests/deadhub-browser.mjs` also passed at all three widths: month navigation, keyboard selection, partial totals, sync completion/error retention, reload, no horizontal overflow and disconnected gate. Its Linux-only executable/module/screenshot paths were adapted in a temporary runner; the test assertions and application source were unchanged.

`tests/fixtures/deadhub-item-details-ja.json` contains the minimal referenced fields of four public Japanese assets captured on 2026-10-16: basic magazine, monster rounds, sacrifice and opening rounds. The fixture does not contain private match/player data. The browser test serves only built static files and intercepts record APIs, without importing the backend.

## Limits and handoff

- Browser verification uses Chromium touch emulation; physical iOS/Android devices and Safari were not tested. Native `<dialog>` and Pointer Events are required.
- Displayed effects are current, unscaled API base values, not historical patch values or the player's in-match adjusted values. Missing or unresolved API fields are deliberately not guessed.
- Browser fixtures use fixed responses for reproducibility; the explicit live-API case uses the real public endpoint. Neither uses a production login/session.
- `tests/deadhub.test.mjs` (10 disposable PostgreSQL/Docker integration groups) was not run. It creates schema/roles and writes DB fixtures, Docker is unavailable here, and this task excludes DB changes. It was also outside the previous 121-test scope. Physical-device and production deployment/real-login checks remain unperformed. All tests in the previous 121-test scope were run; none were skipped.
- The original workspace's uncommitted changes were preserved. Neither checkout contained `.agents/skills`; existing `docs/deadhub/handoff.md`, `public-app/README.md` and offline test loader instructions were used.
- DB, authentication, permissions, environment configuration and secrets were not changed or inspected. There is no deployment, publication or real login validation in this task.

Review the patch against the exact base SHA above before applying it to the target branch. No outstanding implementation blocker remains.

## Independent review

A separate reviewer inspected the diff and new files, found the Frenzy speed-unit defect, then re-reviewed the correction and abort/cache fix. They independently reran all 19 details/UI cases successfully and verified the HTML converter in Chromium with script/style/SVG foreignObject/math/iframe/img-event payloads: scripts executed 0, live image elements 0, external requests 0. Public data from 764 assets was checked for referenced units. No unresolved P1/P2 finding remains. The reviewer did not edit implementation files, commit, push or deploy.

Changed files: `public-app/frontend/src/pages/Deadhub/FinalItems.jsx`, `public-app/frontend/src/pages/Deadhub/FinalItems.css`, `public-app/frontend/src/pages/Deadhub/item-details.mjs`, `public-app/public-manifest.json`, `tests/deadhub-items-ui.test.mjs`, `tests/deadhub-item-details.test.mjs`, `tests/deadhub-item-modal-browser.mjs`, `tests/fixtures/deadhub-item-details-ja.json`, and this document.
