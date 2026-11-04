import {test} from "node:test";
import {strict as assert} from "node:assert";
import {URL} from "node:url";
import {readFile} from "node:fs/promises";

test("generated starter declares a strict TypeScript native-DOM app", async () => {
  const ts = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.equal(ts.compilerOptions.strict, true);
  assert.equal(ts.compilerOptions.jsxImportSource, "@zaakiyjs/core");
  assert.equal(typeof pkg.dependencies["@zaakiyjs/dom"], "string");
  assert.match(main, /mount/);
  assert.doesNotMatch(main, /@zaakiyjs\/ai|@zaakiyjs\/proxy/);
});
