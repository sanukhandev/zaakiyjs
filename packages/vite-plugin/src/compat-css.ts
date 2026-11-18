import postcss from "postcss";
import type { CssFeatureEvidence } from "@zaakiyjs/compat";

const MAX_CSS_CHARS = 1_048_576;
const MAX_CSS_NODES = 100_000;
const KNOWN_FEATURES = new Set(["css.selector-has", "css.container-query", "css.nesting", "css.color-mix"]);

/**
 * Build-only semantic CSS evidence for the existing Compat planner.
 * Parse CSS syntax rather than searching comments, quoted declarations or
 * arbitrary JavaScript source. This does not generate compatibility fallbacks.
 */
export function detectEmittedCssFeatures(css: string, fileName: string): readonly CssFeatureEvidence[] {
  if (typeof css !== "string" || css.length > MAX_CSS_CHARS) {
    throw new RangeError("ZV4010: CSS compatibility input exceeds the analysis size limit.");
  }
  if (!/^(?:assets\/)?(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.css$/.test(fileName)) {
    throw new TypeError("ZV4010: CSS compatibility source must be a safe emitted asset path.");
  }
  let parsed: postcss.Root;
  try {
    parsed = postcss.parse(css, { from: fileName });
  } catch {
    throw new TypeError("ZV4011: Emitted CSS is malformed; compatibility analysis cannot proceed.");
  }
  const found = new Map<string, CssFeatureEvidence>();
  let count = 0;
  const add = (feature: string, offset?: number) => {
    if (!KNOWN_FEATURES.has(feature)) throw new TypeError("Unexpected CSS compatibility feature");
    const canonicalOffset = typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0
      ? offset : 0;
    const key = feature + ":" + canonicalOffset;
    found.set(key, {feature, file: fileName, offset: canonicalOffset});
  };
  parsed.walk(node => {
    if (++count > MAX_CSS_NODES) {
      throw new RangeError("ZV4010: CSS compatibility analysis node budget exceeded.");
    }
    const offset = node.source?.start?.offset;
    if (node.type === "atrule" && node.name.toLowerCase() === "container") {
      add("css.container-query", offset);
    }
    if (node.type === "atrule" && node.name.toLowerCase() === "nest") {
      add("css.nesting", offset);
    }
    if (node.type === "rule") {
      if (/:has\s*\(/i.test(node.selector)) add("css.selector-has", offset);
      if (node.parent?.type === "rule") add("css.nesting", offset);
    }
    if (node.type === "decl" && /color-mix\s*\(/i.test(node.value)) {
      add("css.color-mix", offset);
    }
  });
  return [...found.values()].sort((a,b) =>
    a.file.localeCompare(b.file) || (a.offset ?? 0) - (b.offset ?? 0) ||
    a.feature.localeCompare(b.feature));
}
