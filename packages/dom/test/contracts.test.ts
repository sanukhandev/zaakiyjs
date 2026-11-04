import { describe, expect, it } from "vitest";
import { foundationStatus } from "../src/index";

describe("@zaakiyjs/dom M0 contract", () => {
  it("clearly reports that framework behavior is unimplemented", () => {
    expect(foundationStatus).toEqual({ package: "@zaakiyjs/dom", implemented: false });
  });
});
