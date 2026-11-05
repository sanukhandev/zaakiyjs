import { getOwner } from "@zaakiyjs/core";
import type { OwnerScope, ViewNode } from "@zaakiyjs/core";
import { bindProperty, createElement, listen } from "@zaakiyjs/dom/compiler";
import type { WritableSignal } from "@zaakiyjs/signals";
import { badgeClasses, buttonClasses } from "./recipes.js";
import type { BadgeVariant, UiAppearance, UiSize, UiTone } from "./recipes.js";

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

export interface UiActionDetail { readonly originalEvent: MouseEvent }
export type UiAction = (detail: UiActionDetail) => void;
export interface UiBaseProps {
  readonly id?: string;
  readonly class?: string;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}
export interface ButtonProps extends UiBaseProps {
  readonly label: string;
  readonly type?: "button" | "submit" | "reset";
  readonly tone?: UiTone;
  readonly appearance?: UiAppearance;
  readonly size?: UiSize;
  readonly loading?: boolean;
  readonly onPress?: UiAction;
}
/** Follows P2 Contract 10: semantic onPress, native button keyboard activation. */
export function Button(props: ButtonProps): ViewNode {
  const scope = owner();
  const element = createElement("button", "html") as HTMLButtonElement;
  element.type = props.type ?? "button";
  element.textContent = props.label;
  element.className = buttonClasses(props.tone, props.appearance, props.size, props.class);
  if (props.id) element.id = props.id;
  if (props["aria-label"]) element.setAttribute("aria-label", props["aria-label"]);
  element.disabled = Boolean(props.disabled || props.loading);
  if (props.loading) element.setAttribute("aria-busy", "true");
  if (props.onPress) {
    listen(scope, element, "click", event => {
      if (!element.disabled) props.onPress?.({ originalEvent: event as MouseEvent });
    });
  }
  return asView(element);
}

export interface IconButtonProps extends Omit<ButtonProps, "label"> {
  /** Text glyph or visual icon name supplied by the application; never HTML. */
  readonly icon: string;
  readonly "aria-label": string;
}
export function IconButton(props: IconButtonProps): ViewNode {
  if (!props["aria-label"].trim()) throw new TypeError("IconButton requires an accessible name");
  const element = Button({ ...props, label: props.icon }) as unknown as HTMLButtonElement;
  element.setAttribute("aria-label", props["aria-label"]);
  const icon = element.ownerDocument.createElement("span");
  icon.textContent = props.icon;
  icon.setAttribute("aria-hidden", "true");
  element.replaceChildren(icon);
  return asView(element);
}

export interface LinkButtonProps {
  readonly href: string;
  readonly label: string;
  readonly target?: "_self" | "_blank";
  readonly class?: string;
  readonly tone?: UiTone;
  readonly appearance?: UiAppearance;
  readonly size?: UiSize;
}
/** Always an anchor: does not masquerade as a native submit button. */
export function LinkButton(props: LinkButtonProps): ViewNode {
  owner();
  const element = createElement("a", "html") as HTMLAnchorElement;
  // setAttribute runs the existing DOM ABI URL policy, including scheme checks.
  element.setAttribute("href", validateNavigationUrl(props.href));
  element.textContent = props.label;
  element.className = buttonClasses(props.tone, props.appearance, props.size, props.class);
  element.target = props.target ?? "_self";
  if (props.target === "_blank") element.rel = "noopener noreferrer";
  return asView(element);
}

function validateNavigationUrl(value: string): string {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Invalid navigation URL");
  }
  const candidate = value.trim();
  if (!candidate || /^(?:javascript|data|vbscript):/iu.test(candidate)) throw new TypeError("Unsafe navigation URL");
  const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(candidate);
  if (scheme && !["https","http","mailto","tel"].includes((scheme[1] ?? "").toLowerCase())) {
    throw new TypeError("Unapproved navigation protocol");
  }
  if (candidate.startsWith("//")) throw new TypeError("Protocol-relative URLs are not supported");
  return candidate;
}
export interface BadgeProps {
  readonly label: string;
  readonly variant?: BadgeVariant;
  readonly class?: string;
}

export function Badge(props: BadgeProps): ViewNode {
  owner();
  const element = createElement("span", "html") as HTMLSpanElement;
  element.className = badgeClasses(props.variant, props.class);
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

export interface TextareaProps {
  readonly id: string;
  readonly label: string;
  readonly name?: string;
  readonly value?: string | WritableSignal<string>;
  readonly rows?: number;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly readOnly?: boolean;
  readonly errorId?: string;
  readonly onInput?: (value: string, event: Event) => void;
}
export function Textarea(props: TextareaProps): ViewNode {
  const scope=owner();
  const wrapper=createElement("div","html") as HTMLDivElement;
  wrapper.className="zui-field";
  const label=createElement("label","html") as HTMLLabelElement;
  label.htmlFor=props.id;label.textContent=props.label;label.className="zui-field-label";
  const control=createElement("textarea","html") as HTMLTextAreaElement;
  control.id=props.id;control.name=props.name??"";control.className="zui-input";
  control.rows=props.rows??3;control.disabled=props.disabled??false;
  control.required=props.required??false;control.readOnly=props.readOnly??false;
  if(props.errorId)control.setAttribute("aria-describedby",props.errorId);
  const value=props.value??"";
  if(writable(value))bindProperty(scope,control,"value",()=>value.value);
  else control.value=value;
  if(props.onInput||writable(value))listen(scope,control,"input",event=>{
    if(writable(value))value.value=control.value;
    props.onInput?.(control.value,event);
  });
  wrapper.append(label,control);return asView(wrapper);
}

export interface NativeOption { readonly value: string; readonly label: string; readonly disabled?:boolean }
export interface SelectProps {
  readonly id:string;readonly label:string;readonly options:readonly NativeOption[];
  readonly value?:string | WritableSignal<string>;readonly name?:string;
  readonly required?:boolean;readonly disabled?:boolean;readonly errorId?:string;
  readonly onChange?:(value:string,event:Event)=>void;
}
/** Prefer the accessible native select for ordinary form fields. */
export function Select(props:SelectProps):ViewNode {
  const scope=owner();
  const wrapper=createElement("div","html");
  wrapper.className="zui-field";
  const label=createElement("label","html") as HTMLLabelElement;
  label.htmlFor=props.id;label.textContent=props.label;label.className="zui-field-label";
  const select=createElement("select","html") as HTMLSelectElement;
  select.id=props.id;select.name=props.name??"";select.className="zui-input";
  select.required=props.required??false;select.disabled=props.disabled??false;
  if(props.errorId)select.setAttribute("aria-describedby",props.errorId);
  for(const option of props.options){
    const child=createElement("option","html") as HTMLOptionElement;
    child.value=option.value;child.textContent=option.label;child.disabled=option.disabled??false;
    select.appendChild(child);
  }
  const value=props.value;
  if(value!==undefined){
    if(writable(value))bindProperty(scope,select,"value",()=>value.value);
    else select.value=value;
  }
  if(props.onChange||writable(value??""))listen(scope,select,"change",event=>{
    if(value!==undefined&&writable(value))value.value=select.value;
    props.onChange?.(select.value,event);
  });
  wrapper.append(label,select);return asView(wrapper);
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
