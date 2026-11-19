import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectWorkspace(root) {
  const packagesDir = join(root, 'packages');
  const findings = [];
  const packages = [];
  const entries = readdirSync(packagesDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  for (const directory of entries) {
    const path = join(packagesDir, directory, 'package.json');
    if (!existsSync(path)) { findings.push({ severity: 'error', package: directory, message: 'Missing package.json' }); continue; }
    let manifest;
    try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
    catch { findings.push({ severity: 'error', package: directory, message: 'Invalid package.json' }); continue; }
    if (manifest.name !== '@zaakiyjs/' + directory) findings.push({ severity: 'error', package: directory, message: 'Package name does not match directory' });
    if (!manifest.exports || !manifest.exports['.']) findings.push({ severity: 'error', package: directory, message: 'Missing public root export' });
    for (const command of ['lint', 'typecheck', 'build', 'test']) if (!manifest.scripts?.[command]) findings.push({ severity: 'error', package: directory, message: 'Missing ' + command + ' script' });
    packages.push({ directory, name: manifest.name, version: manifest.version, dependencies: Object.keys(manifest.dependencies ?? {}).filter(x => x.startsWith('@zaakiyjs/')).sort(), exports: Object.keys(manifest.exports ?? {}).sort(), scripts: Object.keys(manifest.scripts ?? {}).sort() });
  }
  const names = new Set(packages.map(p => p.name));
  for (const pkg of packages) for (const dependency of pkg.dependencies) if (!names.has(dependency)) findings.push({ severity: 'error', package: pkg.directory, message: 'Unresolved workspace dependency ' + dependency });
  const byName = new Map(packages.map(p => [p.name, p]));
  const visiting = new Set(), visited = new Set();
  function visit(name, chain) {
    if (visiting.has(name)) { findings.push({ severity: 'error', package: name, message: 'Dependency cycle: ' + [...chain, name].join(' -> ') }); return; }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of byName.get(name)?.dependencies ?? []) if (byName.has(dependency)) visit(dependency, [...chain, name]);
    visiting.delete(name); visited.add(name);
  }
  for (const pkg of packages) visit(pkg.name, []);
  return { schemaVersion: 1, packageCount: packages.length, packages, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = inspectWorkspace(resolve(process.argv[2] ?? '.'));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.findings.some(f => f.severity === 'error')) process.exitCode = 1;
}
