export {
  Button, Badge, TextField, Checkbox, FieldLabel, FieldError,
  Progress, Separator, Alert, Table
} from "./components.js";
export type {
  ButtonProps, BadgeProps, TextFieldProps, CheckboxProps,
  FieldLabelProps, FieldErrorProps, ProgressProps, SeparatorProps,
  AlertProps, TableProps
} from "./components.js";
export { buttonClasses, badgeClasses } from "./recipes.js";
export type { ButtonVariant, ButtonSize, BadgeVariant } from "./recipes.js";

/** Incremental P2 implementation. Not yet a complete or publishable UI suite. */
export const uiStatus = { package: "@zaakiyjs/ui", stage: "draft-foundation" } as const;
