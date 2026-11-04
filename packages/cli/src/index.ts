/** M0 TYPE CONTRACT ONLY. No CLI bin/commands are implemented. */
export const foundationStatus = { package: "@zaakiyjs/cli", implemented: false } as const;
export type CliCommandName = "start" | "dev" | "build" | "test" | "generate" | "doctor";
export interface CliInvocation { readonly command: CliCommandName; readonly argv: readonly string[]; readonly cwd: string; readonly dryRun?: boolean }
export interface CliDiagnostic { readonly code: string; readonly message: string; readonly severity: "error" | "warning" }
export interface CliResult { readonly exitCode: number; readonly diagnostics: readonly CliDiagnostic[] }
