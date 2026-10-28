# Review viewer accessibility and large-report protocol

The static and live review viewer targets **WCAG 2.2 Level AA**. Automated checks are necessary but do not constitute a human accessibility conformance claim.

## Implemented behavior

- One page heading, ordered section headings, banner/main/search landmarks, a skip link, named native controls and disclosures, and a captioned comparison table with row and column headers.
- Every verdict and scenario condition has text plus a symbol; color is supplementary. Text, muted text, pass, fail, warning, and focus tokens are checked at **4.5:1 or greater** against their surface. Focus is always visible and reduced-motion preferences are honored.
- Search covers scenario IDs/prompts, run IDs/configurations, grades, and textual outputs. Its eager index contains metadata only; transcript text is scanned in place on demand rather than copied into a second full-text index. Search/filter changes announce both matching and currently rendered counts. Clear returns focus to search. “Show more” moves focus to the first newly rendered scenario. Evidence links reveal off-page scenarios and focus the target.
- The initial DOM contains at most 25 scenarios. Runs, grades, provenance, output lists, and output bodies are created only when their native disclosure opens. This keeps at least 100 runs and multi-megabyte transcripts usable without placing every transcript in the DOM.
- Output is untrusted. Embedded JSON escapes HTML-significant script delimiters; displayed content uses `textContent`, not HTML parsing. Raster images use data URLs, other binary content is download-only, and a restrictive CSP disables remote/default sources, objects, frames, forms, and navigation bases. CSP does not reliably impose a document sandbox from a meta element. Any host that embeds the viewer must put it in a sandboxed iframe (for example, start with `sandbox="allow-scripts allow-downloads"` and add capabilities only when required).

## Automated gate

Run:

```bash
(cd apps/skill-creator-cli && npm run build && npm test)
```

`check_review_accessibility` is an honest project-specific static audit: axe-core is not vendored or available in this package. It validates static semantics, status/announcement patterns, focus support, lazy rendering, safe DOM APIs, CSP, and token contrast; it must not be reported as an axe result. Browser coverage drives the generated report through the Chrome DevTools Protocol in installed Chromium/Chrome when available, including keyboard focus order, filter announcements, load-more focus, disclosure activation, an initially unrendered assertion deep link; environments without a supported browser report an explicit skipped test rather than a pass.

The generated large-report test fixture is 120 scenarios (240 paired runs) with a 2 MiB transcript. The Node gate requires IR plus HTML generation in under 10 seconds. The browser gate requires no more than 25 scenario articles and no transcript body before expansion, then measures a late transcript search and verifies interactions. This is a regression budget, not a universal device-performance guarantee.

## Required manual screen-reader gate — status: NOT RUN

A human tester must run this protocol before claiming the manual acceptance criterion. Record date, tester, OS, browser, assistive technology and version, report fixture, results per step, defects, and final PASS/FAIL. Do not convert an automated result into a human pass.

Test at minimum one desktop pairing (NVDA + Firefox/Chrome, JAWS + Chrome, or VoiceOver + Safari):

1. Start at the document top. Confirm title, one h1, banner/main/search landmarks, section heading hierarchy, and skip-link destination are announced coherently.
2. Traverse only with keyboard. Confirm focus order follows visual/logical order and every link, checkbox, search field, disclosure, load-more action is operable with standard keys; confirm focus is visible at 200% zoom and reflow at 400%/320 CSS px.
3. Read the verdict, metrics table, regressions, and flags. Confirm symbols and full status words are announced and table row/column relationships are understandable without color.
4. Search for a late scenario, toggle each filter, clear filters, and load more. Confirm count changes are announced once, focus remains on the edited control, clear focuses search, and load-more focuses the first new heading.
5. Follow a regression link to an initially unrendered assertion. Confirm its scenario/disclosures are revealed and focus reaches the exact evidence.
6. Open a run, grades, a large transcript, and provenance. Confirm disclosure name/state and literal transcript text; verify markup-looking output is not interpreted or announced as controls.
7. Repeat with forced colors/high contrast and reduced motion. Confirm statuses, focus indicator, controls, and content remain perceivable.

A release gate is satisfied only when the completed record says PASS and all blocking defects are resolved or explicitly waived by the responsible human reviewer.
