/**
 * Node-only, build-scoped TypeScript program reuse for ZaakiyJS TSX transforms.
 * This service belongs to one compiler/Vite plugin instance. Standalone
 * compile() remains independent and uses its existing single-file semantics.
 */
import * as ts from "typescript";
import { typeDiagnostics, diagnosticCompilerOptions } from "./generate.js";
import type { Analysis } from "./analysis.js";
import type { CompileRequest, CompilerDiagnostic } from "./index.js";

export interface TypeDiagnosticsSession {
  diagnose(request: CompileRequest, analysis: Analysis): CompilerDiagnostic[];
  invalidate(fileName: string): void;
  dispose(): void;
}

type Snapshot = { source: string; version: number };

/**
 * The host reads external declarations from disk and in-memory TSX from Vite.
 * No program, source or cached diagnostic is shared across project instances.
 */
export function createTypeDiagnosticsSession(rootDir: string): TypeDiagnosticsSession {
  const root = ts.sys.resolvePath(rootDir);
  const options = diagnosticCompilerOptions();
  const roots = new Map<string, Snapshot>();
  const invalidated = new Map<string, number>();
  let nextVersion = 0;
  let disposed = false;
  const fileNameOf = (file: string): string => ts.sys.resolvePath(file);
  const ensureLive = (): void => {
    if (disposed) throw new Error("Compiler diagnostics session has been disposed");
  };
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getCurrentDirectory: () => root,
    getDefaultLibFileName: config => ts.getDefaultLibFilePath(config),
    getScriptFileNames: () => [...roots.keys()],
    getScriptVersion: file => {
      const name = fileNameOf(file);
      const entry = roots.get(name);
      if (entry) return "source:" + entry.version;
      // External files and type-only imports must invalidate when modified.
      // Vite file-watcher notifications cover same-tick filesystem edits.
      let metadata = "missing";
      if (ts.sys.fileExists(name)) {
        metadata = (ts.sys.getModifiedTime?.(name)?.getTime() ?? 0) +
          ":" + (ts.sys.getFileSize?.(name) ?? 0);
      }
      return metadata + ":" + (invalidated.get(name) ?? 0);
    },
    getScriptSnapshot: file => {
      const name = fileNameOf(file);
      const source = roots.get(name)?.source ?? ts.sys.readFile(file);
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
    },
    fileExists: ts.sys.fileExists,
    readFile: file => roots.get(fileNameOf(file))?.source ?? ts.sys.readFile(file),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry(
    ts.sys.useCaseSensitiveFileNames,
    root
  ));
  return {
    diagnose(request, analysis) {
      ensureLive();
      const name = fileNameOf(request.fileName);
      const prior = roots.get(name);
      if (!prior || prior.source !== request.source) {
        roots.set(name, { source: request.source, version: ++nextVersion });
      }
      const program = service.getProgram();
      if (!program || !program.getSourceFile(name)) {
        throw new Error("Cannot typecheck TSX source in compiler session: " + name);
      }
      return typeDiagnostics(request, analysis, program);
    },
    invalidate(fileName) {
      ensureLive();
      const name = fileNameOf(fileName);
      const current = roots.get(name);
      if (current) {
        // Use the newest disk source until the next transform supplies its
        // authoritative in-memory text. Unlinks remove former program roots.
        const fresh = ts.sys.readFile(name);
        if (fresh === undefined) roots.delete(name);
        else roots.set(name, { source: fresh, version: ++nextVersion });
      }
      invalidated.set(name, ++nextVersion);
      if (!current) {
        // TypeScript cannot observe a newly restored import when the absent
        // dependency is missing from its prior Program. Invalidate in-memory
        // importers conservatively so module resolution runs again.
        for (const [rootName, snapshot] of roots) {
          roots.set(rootName, { source: snapshot.source, version: ++nextVersion });
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      service.dispose();
      roots.clear();
      invalidated.clear();
    }
  };
}
