import { describe, expect, it } from "vitest";
import { foundationStatus } from "../src/index";

describe("@zaakiyjs/compiler versioned public contract", () => {
  it("reports that the safe compiler vertical slice is present", () => {
    expect(foundationStatus).toEqual({ package: "@zaakiyjs/compiler", implemented: true });
  });
});
