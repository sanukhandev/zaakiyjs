export interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean>;
}
const valueFlags = new Set(["project", "template", "architecture", "path", "package-manager", "cwd"]);
const booleanFlags = new Set(["dry-run", "force", "workspace", "json", "help", "version"]);
export class CliError extends Error {
  constructor(public readonly code: string, message: string, public readonly exitCode = 1) {
    super(message);
    this.name = "CliError";
  }
}
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  let literal = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!literal && token === "--") { literal = true; continue; }
    if (!literal && token.startsWith("--")) {
      const separator = token.indexOf("=");
      const key = token.slice(2, separator === -1 ? undefined : separator);
      if (!valueFlags.has(key) && !booleanFlags.has(key)) throw new CliError("UNKNOWN_OPTION", "Unknown option --" + key);
      if (Object.hasOwn(options, key)) throw new CliError("REPEATED_OPTION", "Repeated option --" + key);
      if (booleanFlags.has(key)) {
        if (separator !== -1) throw new CliError("INVALID_OPTION", "Option --" + key + " takes no value");
        options[key] = true;
      } else {
        const value = separator === -1 ? argv[++i] : token.slice(separator + 1);
        if (!value || value.startsWith("--")) throw new CliError("MISSING_OPTION", "Option --" + key + " requires a value");
        options[key] = value;
      }
      continue;
    }
    if (!literal && token.startsWith("-") && token !== "-") throw new CliError("UNKNOWN_OPTION", "Unknown option " + token);
    positionals.push(token);
  }
  return {command: positionals.shift() ?? "", positionals, options};
}
export function valueOption(options: ParsedArgs["options"], key: string, fallback?: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}
export function flagOption(options: ParsedArgs["options"], key: string): boolean {
  return options[key] === true;
}
export function assertOptions(args: ParsedArgs, allowed: readonly string[], maxPositionals: number): void {
  const unsupported = Object.keys(args.options).filter(key => !allowed.includes(key) && key !== "help" && key !== "version");
  if (unsupported.length) throw new CliError("INVALID_OPTION", "Unsupported option for " + args.command + ": --" + unsupported.join(", --"));
  if (args.positionals.length > maxPositionals) throw new CliError("TOO_MANY_ARGUMENTS", "Unexpected arguments: " + args.positionals.slice(maxPositionals).join(" "));
}
