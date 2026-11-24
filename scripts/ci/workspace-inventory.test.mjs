import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectWorkspace } from './workspace-inventory.mjs';

function fixture(definitions, callback) {
  const root = mkdtempSync(join(tmpdir(), 'zaakiy-inventory-'));
  try {
    for (const [name, dependencies] of Object.entries(definitions)) {
      const dir = join(root, 'packages', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@zaakiyjs/' + name, version: '0.0.0', exports: { '.': './dist/index.js' }, scripts: { lint: 'echo lint', typecheck: 'echo types', build: 'echo build', test: 'echo test' }, dependencies: Object.fromEntries(dependencies.map(d => ['@zaakiyjs/' + d, 'workspace:^'])) }));
    }
    callback(inspectWorkspace(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('counts and sorts packages with resolved dependencies', () => fixture({ beta: ['alpha'], alpha: [] }, result => {
  assert.equal(result.packageCount, 2);
  assert.deepEqual(result.packages.map(p => p.directory), ['alpha', 'beta']);
  assert.deepEqual(result.findings, []);
}));

test('reports unresolved workspace dependencies', () => fixture({ alpha: ['missing'] }, result => {
  assert.ok(result.findings.some(f => f.message.includes('Unresolved workspace dependency')));
}));

test('detects dependency cycles', () => fixture({ alpha: ['beta'], beta: ['alpha'] }, result => {
  assert.ok(result.findings.some(f => f.message.includes('Dependency cycle')));
}));
