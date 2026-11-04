import { describe, expect, it } from "vitest";
import * as signals from "@zaakiyjs/signals";
import * as core from "@zaakiyjs/core";
import * as dom from "@zaakiyjs/dom";
import * as compiler from "@zaakiyjs/compiler";
import * as styles from "@zaakiyjs/styles";
import * as vitePlugin from "@zaakiyjs/vite-plugin";
import * as cli from "@zaakiyjs/cli";
describe("M0 public ESM exports, explicitly unimplemented", () => {
  const entries = [
    ["@zaakiyjs/signals", signals],
    ["@zaakiyjs/core", core],
    ["@zaakiyjs/dom", dom],
    ["@zaakiyjs/compiler", compiler],
    ["@zaakiyjs/styles", styles],
    ["@zaakiyjs/vite-plugin", vitePlugin],
    ["@zaakiyjs/cli", cli]
  ] as const;
  for (const [name, api] of entries) {
    it(name, () => {
      expect(api.foundationStatus).toEqual({ package: name, implemented: false });
      expect(Object.keys(api).sort()).toEqual(name === "@zaakiyjs/compiler" ? ["IR_SCHEMA_VERSION", "foundationStatus"] : ["foundationStatus"]);
    });
  }
  it("pins the serialized IR schema", () => expect(compiler.IR_SCHEMA_VERSION).toBe(1));
});
