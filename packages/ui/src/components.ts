import { getOwner } from "@zaakiyjs/core";
import type { OwnerScope, ViewNode } from "@zaakiyjs/core";
import { bindProperty, createElement, listen } from "@zaakiyjs/dom/compiler";
import type { WritableSignal } from "@zaakiyjs/signals";
import { badgeClasses, buttonClasses } from "./recipes.js";
import type { BadgeVariant, ButtonSize, ButtonVariant } from "./recipes.js";

/**
 * This draft implementation produces native nodes directly, while the existing
 * TSX compiler lowers component calls with explicit props into owner-scoped
 * native DOM insertion. No virtual DOM, JSX factory or global registry exists.
 * Source-level component children remain gated on the Compiler contract.
 */
function owner(): OwnerScope {
  const value = getOwner();
  if (!value || value.disposed) throw new Error("@zaakiyjs/ui components require a live Zaakiy owner");
  return value;
}

function asView(element: Element): ViewNode {
  // Compiler's runtime ViewNode type is opaque; the DOM ABI expects native nodes.
  // This cast is a package-local bridge pending a typed compiler-owned component ABI.
  return element as unknown as ViewNode;
}

function writable<T extends string | boolean>(value: T | WritableSignal<T>): value is WritableSignal<T> {
  return typeof value === "object" && value !== null && "value" in value;
}

export interface ButtonProps {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly type?: "button" | "submit" | "reset";
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly className?: string;
  readonly onClick?: (event: MouseEvent) => void;
}

/** Label-only until compiled TSX component children are supported. */
export function Button(props: ButtonProps): ViewNode {
  const scope = owner();
  const element = createElement("button", "html") as HTMLButtonElement;
  element.type = props.type ?? "button";
  element.textContent = props.label;
  element.className = buttonClasses(props.variant, props.size, props.className);
  element.disabled = Boolean(props.disabled || props.loading);
  if (props.loading) element.setAttribute("aria-busy", "true");
  if (props.onClick) {
    listen(scope, element, "click", event => {
      if (!element.disabled) props.onClick?.(event as MouseEvent);
    });
  }
  return asView(element);
}

export interface BadgeProps {
  readonly label: string;
  readonly variant?: BadgeVariant;
  readonly className?: string;
}

export function Badge(props: BadgeProps): ViewNode {
  owner();
  const element = createElement("span", "html") as HTMLSpanElement;
  element.className = badgeClasses(props.variant, props.className);
  element.textContent = props.label;
  return asView(element);
}

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly type?: "text" | "email" | "search" | "password" | "tel" | "url";
  readonly name?: string;
  readonly placeholder?: string;
  readonly value?: string | WritableSignal<string>;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly readOnly?: boolean;
  readonly invalid?: boolean;
  readonly errorId?: string;
  readonly onInput?: (value: string, event: Event) => void;
}

export function TextField(props: TextFieldProps): ViewNode {
  const scope = owner();
  const wrapper = createElement("div", "html") as HTMLDivElement;
  wrapper.className = "zui-field";
  const label = createElement("label", "html") as HTMLLabelElement;
  label.className = "zui-field-label";
  label.htmlFor = props.id;
  label.textContent = props.label;
  const input = createElement("input", "html") as HTMLInputElement;
  input.className = "zui-input";
  input.id = props.id;
  input.type = props.type ?? "text";
  input.name = props.name ?? "";
  input.placeholder = props.placeholder ?? "";
  input.disabled = props.disabled ?? false;
  input.required = props.required ?? false;
  input.readOnly = props.readOnly ?? false;
  if (props.invalid) input.setAttribute("aria-invalid", "true");
  if (props.errorId) input.setAttribute("aria-describedby", props.errorId);
  const value = props.value ?? "";
  if (writable(value)) bindProperty(scope, input, "value", () => value.value);
  else input.value = value;
  if (props.onInput || writable(value)) {
    listen(scope, input, "input", event => {
      if (writable(value)) value.value = input.value;
      props.onInput?.(input.value, event);
    });
  }
  wrapper.append(label, input);
  return asView(wrapper);
}

export interface CheckboxProps {
  readonly label: string;
  readonly name?: string;
  readonly checked?: boolean | WritableSignal<boolean>;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly onChange?: (checked: boolean, event: Event) => void;
}

/** A native checkbox wrapped by its own associated label. */
export function Checkbox(props: CheckboxProps): ViewNode {
  const scope = owner();
  const label = createElement("label", "html") as HTMLLabelElement;
  label.className = "zui-check-label";
  const input = createElement("input", "html") as HTMLInputElement;
  input.type = "checkbox";
  input.className = "zui-checkbox";
  input.name = props.name ?? "";
  input.disabled = props.disabled ?? false;
  input.required = props.required ?? false;
  const checked = props.checked ?? false;
  if (writable(checked)) bindProperty(scope, input, "checked", () => checked.value);
  else input.checked = checked;
  if (props.onChange || writable(checked)) {
    listen(scope, input, "change", event => {
      if (writable(checked)) checked.value = input.checked;
      props.onChange?.(input.checked, event);
    });
  }
  const caption = createElement("span", "html");
  caption.textContent = props.label;
  label.append(input, caption);
  return asView(label);
}

export interface FieldLabelProps {
  readonly htmlFor: string;
  readonly text: string;
}
export function FieldLabel(props: FieldLabelProps): ViewNode {
  owner();
  const label = createElement("label", "html") as HTMLLabelElement;
  label.className = "zui-field-label";
  label.htmlFor = props.htmlFor;
  label.textContent = props.text;
  return asView(label);
}

export interface FieldErrorProps {
  readonly id: string;
  readonly message: string;
}
export function FieldError(props: FieldErrorProps): ViewNode {
  owner();
  const paragraph = createElement("p", "html") as HTMLParagraphElement;
  paragraph.id = props.id;
  paragraph.className = "zui-field-error";
  paragraph.setAttribute("role", "alert");
  paragraph.textContent = props.message;
  return asView(paragraph);
}

export interface ProgressProps {
  readonly label: string;
  readonly value?: number;
  readonly max?: number;
}
/** Omit value for an indeterminate native progress element. */
export function Progress(props: ProgressProps): ViewNode {
  owner();
  const max = props.max ?? 100;
  if (!Number.isFinite(max) || max <= 0) throw new RangeError("Progress max must be finite and positive");
  if (props.value !== undefined && (!Number.isFinite(props.value) || props.value < 0 || props.value > max)) {
    throw new RangeError("Progress value must be finite and within [0, max]");
  }
  const element = createElement("progress", "html") as HTMLProgressElement;
  element.className = "zui-progress";
  element.max = max;
  if (props.value !== undefined) element.value = props.value;
  element.setAttribute("aria-label", props.label);
  return asView(element);
}

export interface SeparatorProps {
  readonly orientation?: "horizontal" | "vertical";
}
export function Separator(props: SeparatorProps): ViewNode {
  owner();
  if (props.orientation === "vertical") {
    const element = createElement("div", "html");
    element.className = "zui-separator zui-separator--vertical";
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", "vertical");
    return asView(element);
  }
  const element = createElement("hr", "html");
  element.className = "zui-separator";
  return asView(element);
}

export interface AlertProps {
  readonly message: string;
  readonly tone?: "info" | "success" | "warning" | "danger";
}
export function Alert(props: AlertProps): ViewNode {
  owner();
  const element = createElement("section", "html");
  const tone = props.tone ?? "info";
  element.className = "zui-alert zui-alert--" + tone;
  element.setAttribute("role", tone === "danger" ? "alert" : "status");
  element.textContent = props.message;
  return asView(element);
}

export interface TableProps {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}
/** Deliberately small, native semantic table; DataGrid is out of scope. */
export function Table(props: TableProps): ViewNode {
  owner();
  if (!props.headers.length || props.rows.some(row => row.length !== props.headers.length)) {
    throw new RangeError("Table requires headers and rows with matching column counts");
  }
  const table = createElement("table", "html") as HTMLTableElement;
  table.className = "zui-table";
  const caption = createElement("caption", "html");
  caption.textContent = props.caption;
  const thead = createElement("thead", "html");
  const tr = createElement("tr", "html");
  for (const label of props.headers) {
    const th = createElement("th", "html") as HTMLTableCellElement;
    th.scope = "col";
    th.textContent = label;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  const tbody = createElement("tbody", "html");
  for (const row of props.rows) {
    const line = createElement("tr", "html");
    for (const cell of row) {
      const td = createElement("td", "html");
      td.textContent = cell;
      line.appendChild(td);
    }
    tbody.appendChild(line);
  }
  table.append(caption, thead, tbody);
  return asView(table);
}
