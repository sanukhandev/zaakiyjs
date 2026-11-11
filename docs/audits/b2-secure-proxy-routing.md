# B2 — Secure Proxy Routing Performance

This change is based on draft PR #63 (`7c5370d4`) and **does not modify PRs #61–#63**.

## Profiling basis

The previous B0 benchmark showed increasing per-request costs for secure 404
responses as a route table grew: 10 routes ~0.01003ms p50, 100 routes ~0.01178ms
p50, 500 routes ~0.02239ms p50. That is a diagnostic for the existing
`routes.filter(item => item.regex.test(path))` linear scan.

## Optimization

Build a startup-only index from each route's **longest fully literal leading
path prefix**, after `compileRoutes` validates route definitions. A request
looks up its literal URL path prefixes from longest to shortest, including the
root bucket. Candidate indices retain compiler order before all original regex
checks are executed.

Routes starting with `/:param` or `/*` always remain in the root bucket;
`/api/:id` is indexed under `/api`; `/api/items/*` under
`/api/items`. Prefix lookup never replaces validation or authorization.

No new external dependencies, runtime global state or public API/ABI changes.

## Security/compatibility invariants

- The original URL parser rejects traversal, malformed encoding and authority overrides.
- The original `compileRoutes` rejects ambiguous route intersections, unauthorized
  public policies, invalid method sets, and unsafe upstream targets.
- The original RegExp validates every indexed candidate; no match is assumed.
- The original stable route ranking is retained, including multi-method 405 Allow
  ordering; unknown paths remain 404.
- Authentication/authorization, pinned DNS SSRF policy, headers, streaming,
  abort/timeout and diagnostic callbacks are unchanged.
- Added tests cover 500 literal routes, a dynamic first segment, parameterized
  route fallback, wildcard routes, 405 ordering, malformed paths and successful
  forwarding through a local allowed upstream.

## Benchmark contract

`benchmarks/microbench-proxy-routing.mjs` compares original PR #63 versus
candidate on the same Node 22 runner. It runs 10/100/500 disjoint route tables
with secure 404 misses and 405 method rejection: 5 warmups and 30 raw samples,
100 requests per sample. No external network; response bodies are verified.

Report raw samples, p50/p95 and changes; do not claim real request throughput
or higher-level latency improvements until repeated independent samples and
full upstream/concurrency tests confirm them.

## Acceptance

Pass focused proxy tests, workspace lint/typecheck/build, existing release
hardening, browser and SSRF tests; reject any security, correctness, size or
latency regression. Do **not** merge with PR #63 automatically.
