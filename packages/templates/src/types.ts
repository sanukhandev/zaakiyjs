export type TemplateId = "dashboard" | "authentication" | "settings" | "crud";
export type TemplateStatus = "draft" | "runnable";
export type TemplateCategory = "dashboard" | "authentication" | "settings" | "data-management";
export type Appearance = "light" | "dark" | "system";
export type Radius = "sm" | "md" | "lg";
export interface TemplateOptions {
  readonly brandName?: string;
  readonly primaryColor?: string;
  readonly appearance?: Appearance;
  readonly radius?: Radius;
}
export interface TemplateOptionSpec {
  readonly name: keyof TemplateOptions;
  readonly type: "string" | "enum" | "color";
  readonly required: boolean;
  readonly values?: readonly string[];
}
export interface TemplateManifest {
  readonly schemaVersion: 1;
  readonly id: TemplateId;
  readonly name: string;
  readonly description: string;
  readonly category: TemplateCategory;
  readonly status: TemplateStatus;
  readonly requiredPackages: readonly string[];
  readonly minimumVersions: Readonly<Record<string, string>>;
  readonly requiredFeatures: readonly string[];
  readonly optionSchema: readonly TemplateOptionSpec[];
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly generatedFiles: readonly string[];
  readonly limitations: readonly string[];
}
export interface PlannedTemplateFile {
  readonly path: string;
  /** Static packaged asset path, NOT a user-supplied filesystem path. */
  readonly asset: string;
}
export interface TemplatePlan {
  readonly schemaVersion: 1;
  readonly template: TemplateId;
  readonly status: TemplateStatus;
  readonly projectName: string;
  readonly options: Required<TemplateOptions>;
  readonly files: readonly PlannedTemplateFile[];
  readonly requiredPackages: readonly string[];
  readonly minimumVersions: Readonly<Record<string, string>>;
}
export interface TemplateRequest {
  readonly template: TemplateId;
  readonly projectName: string;
  readonly options?: TemplateOptions;
  /** Optional relative path within the approved project root; never absolute. */
  readonly basePath?: string;
}
export interface MaterializedFile { readonly path: string; readonly content: string }
export class TemplateError extends Error {
  override readonly name = "TemplateError";
  constructor(readonly code: "INVALID_PROJECT_NAME" | "INVALID_OPTION" | "UNKNOWN_TEMPLATE" |
    "UNSAFE_PATH" | "DUPLICATE_PATH" | "INVALID_ASSET", message: string) { super(message); }
}
