---
"@zaakiyjs/vite-plugin": minor
"@zaakiyjs/compat": patch
---

Integrate approved compiler-emitted JavaScript compatibility analysis into opt-in Vite production builds. Strict mode rejects unsupported features; auto reports them. Apply reviewed ES2019 transforms before output hashing, fail closed when source maps cannot be preserved, emit versioned compat-manifest.json, and analyze Compiler IR v2 named-slot feature nodes. No global polyfills or browser-side Compat analyzer.
