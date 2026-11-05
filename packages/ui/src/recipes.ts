/** Runtime-only static recipes, generated from the frozen Zaakiy Styles conventions.
 * No @zaakiyjs/styles Node compiler is imported into browser code.
 * The separate static stylesheet contains every selector in this allowlist. */
export type UiSize = "sm" | "md" | "lg";
export type UiTone = "primary" | "neutral" | "danger";
export type UiAppearance = "solid" | "outline" | "ghost";
export type BadgeVariant = "neutral" | "success" | "warning" | "danger";
const tones: Readonly<Record<UiTone,string>> = {
  primary:"zui-button--primary",neutral:"zui-button--neutral",danger:"zui-button--danger"
};
const appearances: Readonly<Record<UiAppearance,string>> = {
  solid:"zui-button--solid",outline:"zui-button--outline",ghost:"zui-button--ghost"
};
const sizes: Readonly<Record<UiSize,string>> = {
  sm:"zui-button--sm",md:"zui-button--md",lg:"zui-button--lg"
};
const badges: Readonly<Record<BadgeVariant,string>> = {
  neutral:"zui-badge--neutral",success:"zui-badge--success",
  warning:"zui-badge--warning",danger:"zui-badge--danger"
};
/** Treat user classes as existing CSS selectors, not arbitrary utility tokens. */
function appendKnown(base: string, extra?: string): string {
  if (!extra) return base;
  const classes = new Set(base.split(" "));
  for (const name of extra.split(/\s+/u)) if (name) classes.add(name);
  return [...classes].join(" ");
}
export function buttonClasses(
  tone: UiTone="primary", appearance: UiAppearance="solid", size: UiSize="md", className?: string
): string {
  return appendKnown(["zui-button",sizes[size],tones[tone],appearances[appearance]].join(" "),className);
}
export function badgeClasses(variant: BadgeVariant="neutral", className?: string): string {
  return appendKnown("zui-badge "+badges[variant], className);
}
