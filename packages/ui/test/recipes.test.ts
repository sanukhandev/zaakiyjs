import { describe, expect, it } from "vitest";
import { badgeClasses, buttonClasses } from "../src/recipes.js";

describe("Zaakiy UI brand recipes", () => {
  it("returns deterministic static class tokens for all supported button variants", () => {
    for (const variant of ["primary", "secondary", "outline", "ghost", "danger"] as const) {
      expect(buttonClasses(variant, "lg")).toBe("zui-button zui-button--lg zui-button--" + variant);
    }
  });

  it("deduplicates external classes and preserves first-occurrence order", () => {
    expect(buttonClasses("primary", "md", "custom custom zui-button")).toBe(
      "zui-button zui-button--md zui-button--primary custom"
    );
  });

  it("uses a single brand-token-backed badge recipe", () => {
    expect(badgeClasses("success")).toBe("zui-badge zui-badge--success");
  });
});
