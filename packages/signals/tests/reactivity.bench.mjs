import { performance } from "node:perf_hooks";
import { batch, computed, effect, flushSync, signal } from "../dist/index.js";

// Run with: pnpm --filter @zaakiyjs/signals build && pnpm --filter @zaakiyjs/signals benchmark
// No cross-framework claims: deterministic synthetic fanout only. Report runtime and platform.
const ITERATIONS = 5_000;
const FANOUT = 1_000;
const source = signal(0);
const derived = computed(() => source.value * 2);
let effectCalls = 0;
const handles = Array.from({ length: FANOUT }, () => effect(() => { void derived.value; effectCalls++; }));
const start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  batch(() => { source.value = i * 2; source.value = i * 2 + 1; });
  flushSync();
}
const elapsed = performance.now() - start;
handles.forEach(h => h.dispose());
console.log(JSON.stringify({ node: process.version, fanout: FANOUT, iterations: ITERATIONS, elapsedMs: Number(elapsed.toFixed(3)), updatesPerSecond: Math.round(ITERATIONS / (elapsed / 1000)), effectCalls }, null, 2));
