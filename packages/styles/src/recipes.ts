/** A recipe is a pure token composition; no CSS is injected at runtime. */
export type RecipeVariants = Readonly<Record<string, Readonly<Record<string, string>>>>;
export type RecipeSelection<V extends RecipeVariants> = { readonly [K in keyof V]?: keyof V[K] & string };
export interface CompoundVariant<V extends RecipeVariants> {
  readonly when: RecipeSelection<V>;
  readonly classes: string;
}
export interface RecipeDefinition<V extends RecipeVariants> {
  readonly base?: string;
  readonly variants: V;
  readonly defaultVariants?: RecipeSelection<V>;
  readonly compoundVariants?: readonly CompoundVariant<V>[];
}
const split = (input: string): string[] => input.trim().split(/\s+/u).filter(Boolean);
/** Stable first-occurrence order, preserving native class names. */
export function uniqueClasses(...inputs: readonly string[]): string {
  return [...new Set(inputs.flatMap(split))].join(" ");
}
export function defineRecipe<const V extends RecipeVariants>(definition: RecipeDefinition<V>): (selected?: RecipeSelection<V>) => string {
  return (selected = {}): string => {
    const values = { ...definition.defaultVariants, ...selected } as RecipeSelection<V>;
    const parts = [definition.base ?? ""];
    for (const key of Object.keys(definition.variants).sort()) {
      const options = definition.variants[key];
      const selectedValue = values[key];
      if (!options || selectedValue === undefined) continue;
      if (!Object.prototype.hasOwnProperty.call(options, selectedValue)) throw new Error(`Unknown recipe variant ${key}=${selectedValue}`);
      parts.push(options[selectedValue] ?? "");
    }
    for (const compound of definition.compoundVariants ?? []) {
      if (Object.entries(compound.when).every(([key, val]) => values[key] === val)) parts.push(compound.classes);
    }
    return uniqueClasses(...parts);
  };
}
