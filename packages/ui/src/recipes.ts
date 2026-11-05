import { defineRecipe, uniqueClasses } from "@zaakiyjs/styles";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export type BadgeVariant = "neutral" | "success" | "warning" | "danger";

const buttonRecipe = defineRecipe({
  base: "zui-button",
  variants: {
    variant: {
      primary: "zui-button--primary",
      secondary: "zui-button--secondary",
      outline: "zui-button--outline",
      ghost: "zui-button--ghost",
      danger: "zui-button--danger"
    },
    size: {
      sm: "zui-button--sm",
      md: "zui-button--md",
      lg: "zui-button--lg"
    }
  },
  defaultVariants: { variant: "primary", size: "md" }
});

const badgeRecipe = defineRecipe({
  base: "zui-badge",
  variants: {
    variant: {
      neutral: "zui-badge--neutral",
      success: "zui-badge--success",
      warning: "zui-badge--warning",
      danger: "zui-badge--danger"
    }
  },
  defaultVariants: { variant: "neutral" }
});

/** Pure, deterministic composition; class declarations ship in the opt-in CSS asset. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return uniqueClasses(buttonRecipe({ variant, size }), extra);
}

export function badgeClasses(variant: BadgeVariant = "neutral", extra = ""): string {
  return uniqueClasses(badgeRecipe({ variant }), extra);
}
