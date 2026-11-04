import type { BrowserFamily, BrowserTarget, CompatMode, CompatibilityProfile, TargetConfiguration } from "./types.js";

const families: readonly BrowserFamily[] = ["chrome", "edge", "firefox", "safari"];
/** These are fixed target sets, NOT a moving "latest" alias. */
const profiles: Readonly<Record<CompatibilityProfile, readonly string[]>> = {
  "modern-2024": ["chrome >=124", "edge >=124", "firefox >=124", "safari >=17.4"],
  "legacy-2020": ["chrome >=80", "edge >=80", "firefox >=78", "safari >=13.1"]
};
/** Avoid extrapolation beyond this package's pinned compatibility-data snapshot. */
const knownBounds: Readonly<Record<BrowserFamily, { readonly min: string; readonly max: string }>> = {
  chrome: { min: "80", max: "156" },
  edge: { min: "80", max: "156" },
  firefox: { min: "78", max: "160" },
  safari: { min: "13.1", max: "27" }
};

export function parseMode(value: string | undefined): CompatMode {
  if (value === undefined) return "off";
  if (value === "off" || value === "auto" || value === "strict") return value;
  throw new TypeError("Invalid compatibility mode: " + value);
}
function versionTuple(value: string): readonly number[] {
  if (!/^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){0,2}$/.test(value)) {
    throw new TypeError("Invalid browser version: " + value);
  }
  const parts = value.split(".").map(Number);
  if (parts.some(x => !Number.isSafeInteger(x))) throw new TypeError("Invalid browser version: " + value);
  return parts;
}
export function compareVersions(a: string, b: string): number {
  const left = versionTuple(a);
  const right = versionTuple(b);
  for (let i = 0; i < 3; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return delta > 0 ? 1 : -1;
  }
  return 0;
}
function canonicalVersion(version: string): string {
  const parts = [...versionTuple(version)];
  while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
  return parts.join(".");
}
function oneTarget(text: string): BrowserTarget {
  const match = /^(chrome|edge|firefox|safari)\s+(?:>=\s*)?(\d+(?:\.\d+){0,2})(?:\s*\.\.\s*(\d+(?:\.\d+){0,2}))?$/.exec(text.trim().toLowerCase());
  if (!match) throw new TypeError("Invalid or ambiguous browser target: " + text);
  const browser = match[1] as BrowserFamily;
  const minimum = canonicalVersion(match[2]!);
  const maximum = match[3] ? canonicalVersion(match[3]) : undefined;
  if (maximum && compareVersions(minimum, maximum) > 0) throw new TypeError("Reversed browser range: " + text);
  const bounds = knownBounds[browser];
  if (compareVersions(minimum, bounds.min) < 0 || compareVersions(minimum, bounds.max) > 0 ||
      (maximum && compareVersions(maximum, bounds.max) > 0)) {
    throw new TypeError("Browser target outside pinned compatibility data: " + text);
  }
  return maximum === undefined ? { browser, minimum } : { browser, minimum, maximum };
}
export function resolveTargets(config: TargetConfiguration | undefined, mode: CompatMode): readonly BrowserTarget[] {
  if (!config) {
    if (mode !== "off") throw new TypeError("Compatibility " + mode + " mode requires explicit browser targets or a pinned profile.");
    return [];
  }
  if ((config.profile !== undefined) === (config.browsers !== undefined)) {
    throw new TypeError("Supply exactly one of profile or browsers.");
  }
  const inputs: readonly string[] = config.profile !== undefined
    ? profiles[config.profile] ?? (() => { throw new TypeError("Unknown profile: " + config.profile); })()
    : config.browsers ?? [];
  if (!inputs.length) throw new TypeError("Browser target list cannot be empty.");
  const unique = new Map<BrowserFamily, BrowserTarget>();
  for (const input of inputs) {
    const target = oneTarget(input);
    if (unique.has(target.browser)) throw new TypeError("Ambiguous duplicate browser family: " + target.browser);
    unique.set(target.browser, target);
  }
  return families.flatMap(family => {
    const target = unique.get(family);
    return target ? [target] : [];
  });
}
export function targetLabel(target: BrowserTarget): string {
  return target.browser + " " + target.minimum + (target.maximum ? ".." + target.maximum : "+");
}
export const COMPAT_DATA_VERSION = "zaakiy-compat-2026-11-04.1" as const;
