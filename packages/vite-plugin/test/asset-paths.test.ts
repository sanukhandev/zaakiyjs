import { describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { cssSourceMapComment, portableSourceFile } from "../src/asset-paths.js";

describe("deterministic, non-leaking Vite asset paths", () => {
  const checkoutA = resolve("build-machine-A", "work", "example");
  const checkoutB = resolve("other-build-machine", "checkout", "example");

  it("normalizes source paths relative to the project, independent of checkout root", () => {
    expect(portableSourceFile(join(checkoutA, "src", "App.tsx"), checkoutA))
      .toBe("src/App.tsx");
    expect(portableSourceFile(join(checkoutB, "src", "App.tsx"), checkoutB))
      .toBe("src/App.tsx");
  });

  it("omits virtual IDs and paths outside the project instead of leaking host data", () => {
    expect(portableSourceFile(null, checkoutA)).toBeUndefined();
    expect(portableSourceFile("\u0000virtual:zaakiy-styles.css", checkoutA)).toBeUndefined();
    expect(portableSourceFile("src/App.tsx", checkoutA)).toBeUndefined();
    expect(portableSourceFile(join(dirname(checkoutA), "secrets", "config.ts"), checkoutA))
      .toBeUndefined();
    expect(portableSourceFile(checkoutA, checkoutA)).toBeUndefined();
  });

  it("links custom CSS source maps relative to the generated CSS file", () => {
    expect(cssSourceMapComment("assets/zaakiy-styles.css"))
      .toBe("/*# sourceMappingURL=zaakiy-styles.css.map */");
    expect(cssSourceMapComment("assets/theme.css"))
      .toBe("/*# sourceMappingURL=theme.css.map */");
    expect(cssSourceMapComment("assets/brand/compiled.css"))
      .toBe("/*# sourceMappingURL=compiled.css.map */");
  });
});
