import { describe, expect, it } from "vitest";
import { foundationStatus } from "../src/index.js";

describe("@zaakiyjs/dom implementation marker", () => {
  it("identifies the DOM package independently of compiler status", () => {
    expect(foundationStatus).toEqual({ package: "@zaakiyjs/dom", implemented: true });
  });
});
