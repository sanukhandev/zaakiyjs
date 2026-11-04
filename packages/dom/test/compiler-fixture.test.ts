// @vitest-environment jsdom
/**
 * Executable compiled TSX -> DOM smoke.
 * Skips only while the compiler package is still the M0 type-only scaffold;
 * production DOM runtime never imports @zaakiyjs/compiler.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as compiler from "@zaakiyjs/compiler";
import { flushSync } from "@zaakiyjs/signals";
import { mount } from "../src/index.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

type CompileFunction = (input: { fileName: string; source: string }) => {
  diagnostics: readonly { severity: string; message: string }[];
  js: readonly { code: string }[];
};
const compile = (compiler as unknown as { compile?: CompileFunction }).compile;
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

afterEach(() => document.body.replaceChildren());

describe("generated TypeScript/TSX DOM integration", () => {
  it.skipIf(typeof compile !== "function")(
    "compiles an executable Counter and mutates only its bound text",
    async () => {
      const folder = mkdtempSync(join(packageRoot, "test", ".generated-"));
      try {
        const fileName = join(folder, "counter.tsx");
        const source = [
          'import { signal } from "@zaakiyjs/signals";',
          "export function Counter() {",
          "  const count = signal(0);",
          "  return <main><span>{count.value}</span><button onClick={() => count.value++}>Increment</button></main>;",
          "}"
        ].join("\n");
        const generated = compile!({ fileName, source });
        expect(generated.diagnostics.filter(d => d.severity === "error")).toEqual([]);
        expect(generated.js).toHaveLength(1);
        const js = generated.js[0]?.code;
        expect(js).toBeDefined();
        expect(js).toContain('@zaakiyjs/dom/compiler');
        const path = join(folder, "counter.mjs");
        writeFileSync(path, js!);
        const module = await import(pathToFileURL(path).href) as {
          Counter: () => Node;
        };
        const host = document.createElement("div");
        document.body.append(host);
        const app = mount(() => module.Counter(), host);
        const span = host.querySelector("span");
        const button = host.querySelector("button");
        expect(span?.textContent).toBe("0");
        expect(button).not.toBeNull();
        const text = span?.firstChild;
        const records: MutationRecord[] = [];
        const observer = new MutationObserver(list => records.push(...list));
        observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
        button!.click();
        flushSync();
        await Promise.resolve();
        expect(span?.textContent).toBe("1");
        expect(span?.firstChild).toBe(text);
        expect(records).toHaveLength(1);
        expect(records[0]?.target).toBe(text);
        expect(records[0]?.type).toBe("characterData");
        observer.disconnect();
        app.dispose();
        expect(host.childNodes).toHaveLength(0);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  );
});
