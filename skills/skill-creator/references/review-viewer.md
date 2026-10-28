# Decision-oriented evaluation review

The review viewer derives a canonical Review IR from run metadata, grading, timing, outputs, and benchmark artifacts. Static and live modes call the same IR builder and HTML renderer, so they have identical semantics.

The initial view answers the decision: candidate and baseline IDs, verdict, paired effect size, variance/95% confidence, critical regressions, time/token/cost evidence, missing evidence, and required human action. A **blocked** or **inconclusive** result is never styled or described as passing.

The failed-scenario filter means candidate failure or regression; baseline-only weakness is labeled separately and does not enter that filter. The disagreement filter includes candidate-versus-baseline differences as well as repeated-run or grader/model differences. Use these filters to triage evidence. Every decision summary, critical regression, missing-evidence item, and key metric links through a stable anchor to its scenario, run, assertion, or provenance evidence. Expand scenarios for grades, raw outputs, and provenance. Missing resource measurements remain “Unavailable”; the viewer does not infer them.

The self-contained HTML has no remote dependencies. Embedded artifact text is JSON-escaped and rendered with text nodes. A restrictive CSP permits only embedded images, inline styles, and the embedded viewer script. When a host embeds the report, the host must use an iframe `sandbox` attribute with the minimum capabilities needed; a meta CSP is not claimed to provide iframe-equivalent sandboxing. Keyboard users can operate every action through named native controls and disclosures. Search/filter results and navigation are announced, while pagination and lazy disclosure rendering bound the DOM for large reports. Statuses use symbols and text as well as color. See [Accessibility and large-report protocol](review-viewer-accessibility.md) for automated gates, the benchmark, and the required manual screen-reader checklist (not yet a human pass).

## Commands

```bash
# live
skill-creator review WORKSPACE --benchmark WORKSPACE/benchmark.json
# static
skill-creator review WORKSPACE --benchmark WORKSPACE/benchmark.json --static WORKSPACE/review.html
```
