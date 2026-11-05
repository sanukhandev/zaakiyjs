// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as primitives from "../src/index.js";

describe("server-safe import", () => {
  it("does not touch DOM globals at module evaluation", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof primitives.createDialog).toBe("function");
    expect(typeof primitives.createPortal).toBe("function");
  });
});
