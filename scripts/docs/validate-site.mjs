import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const siteRoot = join(root, 'docs', 'site');
const tick = String.fromCharCode(96);
const errors = [];
const apiCache = new Map();

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
function fail(file, message) {
  errors.push(relative(root, file) + ': ' + message);
}
function hasExport(statement) {
  return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}
function publicExports(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    } else if (hasExport(statement)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
    }
  }
  return names;
}
function readApi(packageName, exportPath) {
  const cacheKey = packageName + '/' + exportPath;
  if (apiCache.has(cacheKey)) return apiCache.get(cacheKey);
  const pkgDir = join(root, 'packages', packageName);
  const manifestPath = join(pkgDir, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = manifest.exports?.[exportPath];
  if (!entry) return undefined;
  const pathOf = (value) => typeof value === 'string' ? value : value?.import ?? value?.node?.import;
  const output = pathOf(entry);
  if (!output) return new Set();
  if (output.endsWith('.css')) return new Set();
  const sourcePath = join(pkgDir, output.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'));
  if (!existsSync(sourcePath)) {
    fail(manifestPath, 'export ' + exportPath + ' has no source at ' + relative(root, sourcePath));
    return new Set();
  }
  const text = readFileSync(sourcePath, 'utf8');
  const parsed = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = publicExports(parsed);
  apiCache.set(cacheKey, names);
  return names;
}
function checkImports(page, snippet, language, startLine) {
  const parsed = ts.createSourceFile(page + '#' + startLine, snippet, ts.ScriptTarget.Latest, true, language === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const diagnostic of parsed.parseDiagnostics) {
    const location = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    fail(page, 'code fence line ' + (startLine + location.line) + ': TypeScript parse error ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  }
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('@zaakiyjs/')) continue;
    const parts = specifier.split('/');
    const packageName = parts[1];
    const exportPath = parts.length > 2 ? './' + parts.slice(2).join('/') : '.';
    const exports = readApi(packageName, exportPath);
    if (!exports) { fail(page, 'line ' + startLine + ': unavailable module ' + specifier); continue; }
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!exports.has(imported)) fail(page, 'line ' + startLine + ': ' + imported + ' is not exported by ' + specifier);
      }
    }
  }
}
function checkPage(page) {
  const contents = readFileSync(page, 'utf8');
  const lines = contents.split(/\r?\n/);
  if (!['README.md', 'CONTRIBUTING.md'].includes(page.split(sep).at(-1))) {
    if (lines[0] !== '---' || !contents.startsWith('---\n') || !contents.includes('\n---\n', 4)) {
      fail(page, 'missing YAML frontmatter');
    }
  }
  const fence = new RegExp('^ {0,3}(' + tick + '{3,}|~{3,})([A-Za-z0-9_-]*)\\s*$');
  let open = null;
  let code = [];
  let codeCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.match(fence);
    if (marker && (!open || (marker[1][0] === open.marker[0] && marker[1].length >= open.marker.length))) {
      if (!open) { open = { marker: marker[1], language: marker[2], line: i + 1 }; code = []; }
      else {
        codeCount++;
        if (['ts', 'tsx', 'js', 'jsx', 'mjs'].includes(open.language)) checkImports(page, code.join('\n'), open.language, open.line + 1);
        open = null;
      }
      continue;
    }
    if (open) { code.push(line); continue; }
    if (line.includes('\\' + tick + tick + tick)) fail(page, 'line ' + (i + 1) + ': escaped code fence will not render');
    const matches = line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);
    for (const match of matches) {
      const url = match[1].trim().split('#')[0];
      if (!url || /^(?:[a-z]+:|\/\/)/i.test(url)) continue;
      const target = resolve(dirname(page), decodeURIComponent(url));
      if (!target.startsWith(root + sep) || !existsSync(target)) fail(page, 'line ' + (i + 1) + ': broken relative link ' + match[1]);
    }
  }
  if (open) fail(page, 'unclosed code fence opened at line ' + open.line);
  const suffix = relative(siteRoot, page).replaceAll('\\', '/');
  if (suffix.startsWith('packages/') && suffix.endsWith('.md')) {
    const packageName = suffix.slice('packages/'.length, -'.md'.length);
    const implemented = existsSync(join(root, 'packages', packageName, 'package.json'));
    if (implemented) {
      if (!contents.includes('## Public API index')) fail(page, 'implemented package lacks public API index');
      const section = contents.split('## Public API index')[1]?.split('## Detailed feature guide')[0] ?? '';
      const actual = readApi(packageName, '.') ?? new Set();
      const listed = new Set([...section.matchAll(new RegExp('^- ' + tick + '([A-Za-z][A-Za-z0-9_]*)' + tick + '$', 'gm'))].map(m => m[1]));
      for (const name of actual) if (!listed.has(name)) fail(page, 'missing exported symbol: ' + name);
      for (const name of listed) if (!actual.has(name)) fail(page, 'symbol not exported: ' + name);
    } else if (!/^> \*\*Status:.*(?:Not|Design|Planning|Proposed)/mi.test(contents)) {
      fail(page, 'planned package is not explicitly marked as unimplemented');
    }
  }
  return codeCount;
}

if (!existsSync(siteRoot)) throw new Error('docs/site directory not found');
const pages = walk(siteRoot).filter(path => path.endsWith('.md'));
const present = new Set(pages.map(path => relative(siteRoot, path).replaceAll('\\', '/')));
for (const name of readdirSync(join(root, 'packages'))) {
  if (existsSync(join(root, 'packages', name, 'package.json')) && !present.has('packages/' + name + '.md')) {
    fail(siteRoot, 'missing documentation for source package ' + name);
  }
}
for (const name of ['seo', 'analytics', 'ai', 'devtools', 'testing']) {
  if (!present.has('packages/' + name + '.md')) fail(siteRoot, 'missing planned guide ' + name);
}
let snippets = 0;
for (const page of pages) snippets += checkPage(page);
if (errors.length) {
  console.error('Documentation validation failed (' + errors.length + ' issues):\n' + errors.join('\n'));
  process.exitCode = 1;
} else console.log('Documentation validated: ' + pages.length + ' Markdown files; ' + snippets + ' balanced code fences; local links and ZaakiyJS exports checked.');
