import { describe, expect, it } from "vitest";
import { createOwner, foundationStatus } from "../src/index.js";

describe("@zaakiyjs/core executable export contract", () => {
  it("reports that the ownership runtime is implemented", () => {
    expect(foundationStatus).toEqual({ package: "@zaakiyjs/core", implemented: true });
  });
  it("exposes callable owner primitives without DOM or compiler imports", () => {
    const owner = createOwner();
    expect(owner.state).toBe("created");
    owner.dispose();
    expect(owner.disposed).toBe(true);
  });
});
