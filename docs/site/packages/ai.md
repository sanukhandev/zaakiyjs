---
title: "@zaakiyjs/ai (planned)"
description: "Consent-based Gemini advisory and locally verified compiler optimization"
sidebar_position: 24
---

# @zaakiyjs/ai — planned advisory package

> **Status: Design only.** There is no verified `@zaakiyjs/ai` package on the documented main revision. The commands and proposal formats below are intended design, not shipped CLI commands.

## Why a separate AI package

ZaakiyJS must compile and run **deterministically with AI disabled**. Model assistance can suggest optimizations but may not authorize a transformation. The compiler, TypeScript semantics, security tests, accessibility requirements and paired benchmarks remain authoritative.

The browser runtime never imports Gemini, model API keys or this proposed package.

## Two proposed opt-in workflows

| Mode | Intended command | Permitted action |
| --- | --- | --- |
| Advisory | `zaakiy ai analyze --consent` | Read-only suggestions from redacted bundle/DOM/compiler metrics |
| Reviewed candidate | `zaakiy ai optimize --review --consent` | Schema-validated proposal for an allowlisted pass; explicit human review required |

**Neither command is implemented or guaranteed by this page.** Ordinary `zaakiy build` must not require AI, consent to model use or network access.

## Proposed optimization lifecycle

1. Developer enables an explicit advisory command and approves sending the minimum necessary data.
2. Local tool removes credentials, PII and private source unless separately authorized. Prefer metric summaries and IR digests.
3. Model returns a schema-constrained proposal, not arbitrary executable source.
4. Local validation checks schema version, proposal identifier, candidate hash and **existing IR node identities**.
5. Allowlisted local compiler passes construct candidates. Unknown passes and unknown node references are rejected.
6. Run typecheck, golden semantic fixtures, DOM/browser behavior, security/accessibility and paired performance benchmarks.
7. Developer reviews change, risk and evidence and explicitly accepts or rejects it.
8. Record audit metadata without secrets; ensure the pinned offline build remains fully reproducible.

## Proposed allowlisted opportunities

Static hoisting, dependency narrowing, safe chunk hinting, CSS deduplication and narrowly scoped component simplifications. Side-effect order, ownership/disposal, element identity and deterministic output must be preserved. Unknown calls are impure until locally proven otherwise.

## Threat and failure model

Repository text, comments, prompts and model responses are untrusted. Never run generated shell commands, dynamic code or `eval`. Enforce cost/token/retry/time budgets. Model failure may fail the explicit AI operation but **must not fail or alter the standard build**. Any correctness, security or accessibility regression rejects an optimization even if the bundle shrinks.

## Acceptance before publishing

- Offline builds produce byte-identical output with AI disabled.
- Zero AI SDK/client key bytes enter browser bundles.
- Consent is explicit and private inputs are redacted by default.
- Invalid proposals/IR identifiers/unknown passes fail closed.
- Candidate acceptance requires local tests and repeatable benchmarking with disclosed configuration.
- Human approval is necessary for application of a candidate.

## References

- [AI trust boundary architecture](../../architecture/ai-boundary.md)
- [Compiler package](./compiler.md)
- [Compatibility package](./compat.md)
- [Testing and quality gates](../../development/testing-and-quality.md)
