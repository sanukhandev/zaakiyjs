/** The CI gate names are stable because the protected branch requires them. */
export const requiredGates = ["quality / lint", "quality / typecheck", "quality / build"] as const;

export type RequiredGate = (typeof requiredGates)[number];
export type WorkspaceScript = "lint" | "typecheck" | "build";

export interface QualityContract {
  readonly checks: readonly RequiredGate[];
  readonly scripts: readonly WorkspaceScript[];
  readonly requiresLockfileForSourcePackages: boolean;
}

export const qualityContract = {
  checks: requiredGates,
  scripts: ["lint", "typecheck", "build"],
  requiresLockfileForSourcePackages: true
} as const satisfies QualityContract;
