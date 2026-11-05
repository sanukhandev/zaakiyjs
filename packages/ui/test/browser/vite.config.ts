import { defineConfig } from "vite";
import { zaakiyPlugin } from "@zaakiyjs/vite-plugin";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const fixture = dirname(fileURLToPath(new URL("./fixture/index.html", import.meta.url)));
export default defineConfig({
  root: fixture,
  plugins: [zaakiyPlugin()],
  build: { target:"es2022", outDir:resolve(fixture,"dist"),emptyOutDir:true,sourcemap:true }
});
