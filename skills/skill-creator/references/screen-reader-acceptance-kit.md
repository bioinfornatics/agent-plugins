> **Historical reference — not a current execution workflow.** Retained for provenance.
> Its commands, schemas and acceptance claims are not supported by the current CLI.
> Use [current evaluation](evaluate-workflow.md), [scenario design](evaluation-design.md),
> [authoring](create-workflow.md) or [report review](review-viewer.md) instead.

# Manual screen-reader acceptance kit

This kit governs the human gate for static and live evaluation reports. It prepares a protocol; it does not claim that testing occurred. Automated browser or synthetic records are not manual evidence.

## Matrix and setup

Use `assets/screen-reader-acceptance/protocol.json` as the fixed task catalog. Complete both required combinations:

1. Windows with an actual NVDA version and either actual Firefox or Chrome version.
2. macOS with actual VoiceOver and Safari versions.

Run every task against both a generated static report and the live-served report from the same identified report build. A combination may be recorded as `unavailable` with a concrete reason, but unavailable never satisfies coverage and the analysis remains `FAIL`. Do not infer or invent versions.

Before each run, enable the screen reader, keyboard-only input, and the platform's forced-colors/high-contrast setting for the noncolor task. Start from a clean browser profile where practical. Record concise paraphrased announcements and focus outcomes, not audio, video, raw transcripts, user paths, URLs, accounts, or personal data.

## Recording rules

Create one record per environment combination using `record.schema.json`:

- use random `SR-XXXXXXXX` record and `REV-...` reviewer codes, never a person's name;
- set `synthetic: false` only for an actual human session;
- copy the canonical protocol version and SHA-256 identity; identify concrete semver-like OS, AT, and browser versions, a lowercase SHA-256 report build, and UTC review time no later than the current instant;
- set `privacy_reviewed: true` only after checking every free-text field;
- set a deletion date on or after the review date and no more than 90 days later; delete the record at that date;
- for each static/live task copy the exact mode-specific expected string from the canonical protocol, record what was observed, a Boolean result, and structured evidence containing a bounded semantic/DOM locator plus a substantive observation;
- list each finding with task, mode, evidence, and severity: P0 blocks use or causes severe harm/data exposure; P1 blocks a required workflow with no reasonable workaround; P2 impairs a workflow with a workaround; P3 is minor.

Do not include direct identifiers, organization names, IP addresses, repository URLs, machine paths, recordings, or verbatim transcripts. Store any separately approved diagnostic artifact outside this record and reference it only with a non-identifying evidence code.

## External attestation and trust

A performed record is not qualifying evidence by itself. The production analyzer trusts only the shipped assets/screen-reader-acceptance/trust-policy.json, whose exact file SHA-256 is pinned in protocol.json. The initial policy intentionally has no qualified reviewers, so no record can qualify and the parent gate remains blocked.

After a real session and privacy review, create a canonical unsigned request:

    skill-creator screen-reader-acceptance --create-attestation-request record.json --issued-at 2026-09-18T15:01:00Z --expires-at 2026-09-19T15:01:00Z -o request.json

The kit never accepts or ships private keys. A qualified reviewer signs the decoded signing_input externally with Ed25519. Verify against the shipped policy only (there is deliberately no policy override):

    skill-creator screen-reader-acceptance --verify-attestation receipt.json --record record.json

### Governance update process

1. Prepare a proposed policy containing reviewed public Ed25519 keys, pseudonymous reviewer codes, and the narrow manual-screen-reader-attest action.
2. Generate an unsigned governance request with --create-policy-signing-request proposed-policy.json -o policy-request.json; governance signs externally and keeps private keys outside the skill and repository.
3. Review qualification, key custody, revocation, and the proposed canonical policy digest out of band.
4. In one reviewed release, replace trust-policy.json, update protocol.json to pin the exact new file SHA-256 (and update protocol identity/fixtures), then run build and tests. Never accept a CLI-provided policy or environment override.
5. Revoke or rotate a reviewer by the same release process. Old packages retain their immutable shipped policy; evidence must be analyzed with the intended released skill version.

The signature identifies the accountable trusted attestor but does not prove participant presence or AT use. Only a witnessed real session can satisfy the human gate. The exported WithTestTrustPolicy APIs are explicit test seams for ephemeral keys; production CLI code does not call them.

## Validate and analyze

```bash
skill-creator screen-reader-acceptance --validate <record-or-directory> --format json
skill-creator screen-reader-acceptance <records-directory> --attestations <receipts-directory> --format json
```

The analyzer returns `PASS` only when each non-synthetic performed record also has exactly one current, signature-valid, trusted, exact-record-bound attestation and records cover both required combinations, every required static and live task passes, all qualifying records identify the same nonempty report-build SHA-256, and there are zero P0/P1 findings. Missing, unavailable, invalid, synthetic, or failed evidence cannot produce PASS. Keep the parent gate open until actual records pass; do not fake results or convert automated checks into manual evidence.
