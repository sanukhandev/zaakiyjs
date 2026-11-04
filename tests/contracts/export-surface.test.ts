import { describe, expect, it } from "vitest";
import * as signals from "@zaakiyjs/signals";
import * as core from "@zaakiyjs/core";
import * as dom from "@zaakiyjs/dom";
import * as compiler from "@zaakiyjs/compiler";
import * as styles from "@zaakiyjs/styles";
import * as vitePlugin from "@zaakiyjs/vite-plugin";
import * as cli from "@zaakiyjs/cli";
describe("Independent packages: implemented or M0 contract-only", () => {
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
      expect(api.foundationStatus.package).toBe(name);
      const exports = Object.keys(api).sort();
      if (api.foundationStatus.implemented) {
        // Implemented packages must expose runtime behavior, not merely a status marker.
        expect(exports.filter(symbol => symbol !== "foundationStatus").length).toBeGreaterThan(0);
      } else {
        expect(exports).toEqual(name === "@zaakiyjs/compiler" ? ["IR_SCHEMA_VERSION", "foundationStatus"] : ["foundationStatus"]);
      }
    });
  }
  it("pins the serialized IR schema", () => expect(compiler.IR_SCHEMA_VERSION).toBe(1));
});
