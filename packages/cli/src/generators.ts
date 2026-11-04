import {CliError} from "./args.js";
import {safeRelativePath, writeGenerated, type PlannedWrite} from "./fs-safe.js";

const supported = ["component", "view", "viewmodel", "model", "feature", "service", "provider", "context"] as const;
const future = ["page", "layout", "store", "resource", "task", "interceptor", "proxy"] as const;
type Generator = typeof supported[number];
export interface GenerateOptions {
  type: string;
  name: string;
  cwd: string;
  path?: string;
  architecture?: string;
  dryRun: boolean;
  force: boolean;
}
export function supportedGenerators(): readonly string[] { return supported; }
function words(value: string): string[] {
  const path = safeRelativePath(value);
  if (path.includes("/")) throw new CliError("INVALID_NAME", "Generator name must be a single TypeScript identifier or kebab-case name.");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(path)) throw new CliError("INVALID_NAME", "Invalid TypeScript generator name: " + value);
  const separated = path.replace(/([a-z0-9])([A-Z])/g, "$1-$2").split(/[-_]/).filter(Boolean);
  if (!separated.length) throw new CliError("INVALID_NAME", "Empty generator name.");
  return separated.map(item => item.toLowerCase());
}
function capitalize(input: string): string { return input.slice(0, 1).toUpperCase() + input.slice(1); }
function names(value: string): {pascal: string; camel: string; kebab: string} {
  const parts = words(value);
  const pascal = parts.map(capitalize).join("");
  return {pascal, camel: pascal.slice(0, 1).toLowerCase() + pascal.slice(1), kebab: parts.join("-")};
}
function file(name: string, content: string): PlannedWrite {return {path: name, content};}
export function generatorPlan(type: string, name: string, architecture?: string, outputPath?: string): PlannedWrite[] {
  if (!supported.includes(type as Generator)) {
    if (future.includes(type as typeof future[number])) throw new CliError("GENERATOR_UNAVAILABLE", type + " requires a package contract that is not implemented. No files were created.");
    throw new CliError("UNKNOWN_GENERATOR", "Unknown generator " + type + ". Supported: " + supported.join(", "));
  }
  if (architecture && (type !== "feature" || architecture !== "mvvm")) throw new CliError("UNSUPPORTED_ARCHITECTURE", "Only feature --architecture mvvm is supported.");
  const n = names(name);
  const defaultFolder: Record<Generator, string> = {
    component: "src/components", view: "src/views", viewmodel: "src/viewmodels",
    model: "src/models", feature: "src/features", service: "src/services",
    provider: "src/providers", context: "src/contexts"
  };
  const folder = outputPath ? safeRelativePath(outputPath) : defaultFolder[type as Generator];
  const at = (relative: string) => folder + "/" + relative;
  const entity = n.pascal;
  switch (type) {
    case "component":
      return [file(at(entity + ".tsx"), [
        "export interface " + entity + "Props {",
        "  readonly label: string;",
        "  readonly onClick?: () => void;",
        "}",
        "export function " + entity + "({label, onClick}: " + entity + "Props) {",
        "  return <button type=\"button\" onClick={() => onClick?.()}>{label}</button>;",
        "}",
        ""
      ].join("\n"))];
    case "view":
      return [file(at(entity + "View.tsx"), [
        "export interface " + entity + "ViewProps {readonly title: string}",
        "export function " + entity + "View({title}: " + entity + "ViewProps) {",
        "  return <main><h1>{title}</h1></main>;",
        "}",
        ""
      ].join("\n"))];
    case "model":
      return [file(at(n.camel + ".ts"), [
        "export interface " + entity + " {",
        "  readonly id: string;",
        "  readonly name: string;",
        "}",
        ""
      ].join("\n"))];
    case "viewmodel":
      return [file(at("create" + entity + "ViewModel.ts"), [
        "import {signal} from \"@zaakiyjs/core\";",
        "export function create" + entity + "ViewModel() {",
        "  const value = signal(\"\");",
        "  return {value, setValue(next: string) {value.value = next;}};",
        "}",
        "export type " + entity + "ViewModel = ReturnType<typeof create" + entity + "ViewModel>;",
        ""
      ].join("\n"))];
    case "service":
      return [file(at(n.camel + "Service.ts"), [
        "export interface " + entity + "Reader<T> {read(): Promise<T>}",
        "export function create" + entity + "Service<T>(reader: " + entity + "Reader<T>) {",
        "  return {read: () => reader.read()};",
        "}",
        ""
      ].join("\n"))];
    case "provider":
      return [file(at(n.camel + "Provider.ts"), [
        "// Application adapters choose the lifetime and owner scope of this provider.",
        "export interface " + entity + "Dependencies {readonly service: unknown}",
        "export function create" + entity + "Provider<T extends " + entity + "Dependencies>(dependencies: T) {",
        "  return {dependencies};",
        "}",
        ""
      ].join("\n"))];
    case "context":
      return [file(at(n.camel + "Context.ts"), [
        "// Typed context value only; registration uses the approved core owner API.",
        "export interface " + entity + "Context<T> {readonly value: T}",
        "export function create" + entity + "Context<T>(value: T): " + entity + "Context<T> {",
        "  return {value};",
        "}",
        ""
      ].join("\n"))];
    case "feature": {
      const base = at(n.kebab);
      const item = entity + "Item";
      const repository = entity + "Repository";
      const vm = entity + "ViewModel";
      return [
        file(base + "/model/" + n.kebab + ".ts", [
          "export interface " + item + " {readonly id: string; readonly label: string}",
          "export interface " + repository + " {list(): Promise<readonly " + item + "[]>}",
          ""
        ].join("\n")),
        file(base + "/viewmodel/create" + entity + "ViewModel.ts", [
          "import {signal} from \"@zaakiyjs/core\";",
          "import type {" + item + ", " + repository + "} from \"../model/" + n.kebab + "\";",
          "export function create" + entity + "ViewModel(repository: " + repository + ") {",
          "  const items = signal<readonly " + item + "[]>([]);",
          "  const loading = signal(false);",
          "  const error = signal<string | null>(null);",
          "  async function load(): Promise<void> {",
          "    loading.value = true;",
          "    error.value = null;",
          "    try {items.value = await repository.list();}",
          "    catch (cause: unknown) {error.value = cause instanceof Error ? cause.message : String(cause);}",
          "    finally {loading.value = false;}",
          "  }",
          "  return {items, loading, error, load};",
          "}",
          "export type " + vm + " = ReturnType<typeof create" + entity + "ViewModel>;",
          ""
        ].join("\n")),
        file(base + "/view/" + entity + "View.tsx", [
          "import type {" + vm + "} from \"../viewmodel/create" + entity + "ViewModel\";",
          "export function " + entity + "View({vm}: {readonly vm: " + vm + "}) {",
          "  return <main>",
          "    <h1>" + entity + "</h1>",
          "    <p>Items: {vm.items.value.length}</p>",
          "    <button type=\"button\" onClick={() => {void vm.load();}}>Refresh</button>",
          "  </main>;",
          "}",
          ""
        ].join("\n")),
        file(base + "/services/create" + entity + "Repository.ts", [
          "import type {" + item + ", " + repository + "} from \"../model/" + n.kebab + "\";",
          "export interface " + entity + "Gateway {list(): Promise<readonly " + item + "[]>}",
          "export function create" + entity + "Repository(gateway: " + entity + "Gateway): " + repository + " {",
          "  return {list: () => gateway.list()};",
          "}",
          ""
        ].join("\n")),
        file(base + "/adapters/create" + entity + "Adapter.ts", [
          "import type {" + repository + "} from \"../model/" + n.kebab + "\";",
          "import {create" + entity + "ViewModel} from \"../viewmodel/create" + entity + "ViewModel\";",
          "export function create" + entity + "Adapter(repository: " + repository + ") {",
          "  return create" + entity + "ViewModel(repository);",
          "}",
          ""
        ].join("\n"))
      ];
    }
    default: throw new CliError("UNKNOWN_GENERATOR", "Unsupported generator " + type);
  }
}
export async function generateFiles(options: GenerateOptions): Promise<string[]> {
  return writeGenerated(options.cwd, generatorPlan(options.type, options.name, options.architecture, options.path),
    {dryRun: options.dryRun, force: options.force});
}
