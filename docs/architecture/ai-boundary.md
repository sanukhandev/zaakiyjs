# Optional Gemini Advisor and Verification Boundary

## Trust model

The deterministic compiler is always authoritative. The browser core must not depend on `@zaakiyjs/ai`, load a Gemini SDK, or expose model credentials. Default `ai.enabled = false`. Offline and pinned builds must succeed without any model invocation.

## Two explicit modes (proposed)

- `zaakiy ai analyze --consent`: read-only, schema-bounded reports from redacted compiler/bundle/DOM metrics; may suggest improvements.
- `zaakiy ai optimize --review --consent`: generate structured, allowlisted IR transformation **proposals**; local validator checks schema/IR IDs/semantics/tests/benchmarks; human explicitly approves application.

Similar reviewed proposals may apply to brand recipes, CSS, motion, accessibility and SEO. Never let a model silently edit business logic or produce HTML/CSS for runtime inclusion on each build.

## Proposal envelope

Require schema version, proposal ID, target IR IDs, allowlisted pass ID, rationale, expected benefit, risk, prerequisites, candidate source/version hashes. Allowed compiler passes start with safe static hoisting, dependency narrowing, chunk hinting and CSS deduplication. A model's claimed performance improvements have no authority.

## Guardrails

- Consent before sending private source. Prefer redacted statistics; strip credentials, PII, customer data and proprietary code by default.
- Treat repo source/comments and model output as untrusted, including prompt-injection instructions.
- Never execute model-produced code or shell commands as a trusted step.
- Enforce token/cost budgets, retries, timeouts and provider failures. No auto-apply in initial release.
- Typecheck, semantic/golden tests, real-browser behavior, accessibility, security and paired benchmarks decide acceptance.
- Record model/prompt version, proposal, input hashes, metrics, review decision and artifact hashes; don't log secrets.
- Reject correctness/security/accessibility regressions even if bundle size improves.

## Failure policy

If Gemini is offline or unavailable, produce the exact deterministic build path. An advisory failure can fail an explicit AI command but must not fail ordinary `zaakiy build`.
