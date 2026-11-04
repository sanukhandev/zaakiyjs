import { describe, expect, it } from "vitest";
import { foundationStatus, zaakiyPlugin } from "../src/index.js";

describe("@zaakiyjs/vite-plugin public contract", () => {
  it("exports an executable Vite adapter while upstream TSX/CSS integration remains gated", () => {
    expect(foundationStatus).toEqual({ package: "@zaakiyjs/vite-plugin", implemented: true });
    expect(zaakiyPlugin().name).toBe("zaakiy:compiler");
  });
});
