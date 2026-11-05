// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as motion from "../src/index.js";

describe("DOM-free ESM module import", () => {
  it("exposes optional controllers without requiring global document", () => {
    expect(typeof motion.animateElement).toBe("function");
    expect(typeof motion.createPresence).toBe("function");
    expect(typeof motion.createSpring).toBe("function");
  });
});
