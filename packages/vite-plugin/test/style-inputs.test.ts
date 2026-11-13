import { describe, expect, it } from "vitest";
import { equalStyleInputs } from "../src/style-inputs.js";

describe("incremental TSX CSS contributions", () => {
  const base = {
    tokens: [{ token: "flex", file: "app.tsx", offset: 20 }],
    additionalCss: ["button { color: var(--accent); }"]
  };
  it("skips global CSS regeneration after a JS-only change", () => {
    expect(equalStyleInputs(base, {
      tokens: [{ ...base.tokens[0]! }],
      additionalCss: [...base.additionalCss]
    })).toBe(true);
  });
  it("recompiles CSS when tokens, origins, or emitted styles change", () => {
    expect(equalStyleInputs(base, { ...base, tokens: [] })).toBe(false);
    expect(equalStyleInputs(base, { ...base, tokens: [{ ...base.tokens[0]!, token: "grid" }] })).toBe(false);
    expect(equalStyleInputs(base, { ...base, tokens: [{ ...base.tokens[0]!, offset: 32 }] })).toBe(false);
    expect(equalStyleInputs(base, { ...base, additionalCss: ["button { color: red }"] })).toBe(false);
  });
});
