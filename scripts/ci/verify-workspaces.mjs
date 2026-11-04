import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Verify that new workspace packages cannot silently skip required commands.
// The framework has no implemented packages yet; the root tooling is checked
// separately by ESLint and TypeScript in CI during bootstrap.
const requiredScripts = ["lint", "typecheck", "build"];
const workspaceGroups = ["packages", "apps", "examples"];
let sourcePackages = 0;
let errors = 0;

for (const group of workspaceGroups) {
  if (!existsSync(group)) continue;
  for (const entry of readdirSync(group)) {
    const dir = join(group, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) {
      console.error(`Missing package.json in workspace: ${dir}`);
      errors++;
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      console.error(`Invalid package.json: ${manifestPath}`);
      errors++;
      continue;
    }
    if (group === "packages") {
      sourcePackages++;
      if (!manifest.name?.startsWith("@zaakiyjs/")) {
        console.error(`Publishable workspace must be named @zaakiyjs/*: ${dir}`);
        errors++;
      }
    }
    for (const script of requiredScripts) {
      if (typeof manifest.scripts?.[script] !== "string" || !manifest.scripts[script].trim()) {
        console.error(`Missing required ${script} script in ${manifestPath}`);
        errors++;
      }
    }
  }
}
if (sourcePackages > 0 && !existsSync("pnpm-lock.yaml")) {
  console.error("pnpm-lock.yaml is mandatory once a source package is added.");
  errors++;
}
if (errors > 0) process.exit(1);
console.log(`Workspace quality contract valid (${sourcePackages} source packages).`);
if (sourcePackages === 0) {
  console.log("Bootstrap only: root tooling is compiled; framework package builds are not implemented yet.");
}
