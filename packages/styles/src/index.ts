export { compileStyles, parseUtilityToken, stableTokenId } from "./compiler.js";
export { brandCss, cssVar, defineBrand, defineStyleConfig, renderBrandScope, resolveBrand, resolveBreakpoints, safeCssValue, validateBrand } from "./brand.js";
export { defineRecipe, uniqueClasses } from "./recipes.js";
export { extractStyleTokens } from "./extract.js";
export type { ExtractionResult } from "./extract.js";
export type { RecipeDefinition, RecipeSelection, RecipeVariants, CompoundVariant } from "./recipes.js";
export type { BrandIdentity, BrandTypography, BrandMotion, BrandOverride, BrandTokens, BrowserTargets, StyleConfig, ExtractedStyleToken, StyleCompilerRequest, StyleCompilerResult, StyleDiagnostic, StyleMetrics } from "./types.js";
export const foundationStatus = { package: "@zaakiyjs/styles", implemented: true } as const;
