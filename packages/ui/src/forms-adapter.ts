import type { ViewNode } from "@zaakiyjs/core";
import type { ReadonlySignal, WritableSignal } from "@zaakiyjs/signals";
import { bindAttribute, bindText, createText, listen } from "@zaakiyjs/dom/compiler";
import { currentOwner, native, view, nonEmpty } from "./native.js";

/**
 * Structural adapter for @zaakiyjs/forms FieldHandle<string>; Forms remains
 * OPTIONAL and no runtime import/circular dependency is introduced.
 */
export interface TextFieldBinding {
  readonly value: WritableSignal<string>;
  readonly ariaInvalid: ReadonlySignal<boolean>;
  readonly visibleErrors: ReadonlySignal<readonly { readonly message: string }[]>;
  blur(): void;
}
export interface BoundTextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly field: TextFieldBinding;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly name?: string;
}
/** Focus/input identity is stable; reactive error text mutates only its Text node. */
export function BoundTextField(props: BoundTextFieldProps): ViewNode {
  const owner = currentOwner();
  const group = native("div");group.className = "zui-field";
  const label = native("label") as HTMLLabelElement;
  label.htmlFor = nonEmpty(props.id, "Field id");
  label.className = "zui-field-label";
  label.textContent = nonEmpty(props.label, "Field label");
  const input = native("input") as HTMLInputElement;
  input.type = "text";input.id = props.id;input.className = "zui-input";
  input.name = props.name ?? "";
  input.required = props.required ?? false;
  input.disabled = props.disabled ?? false;
  input.placeholder = props.placeholder ?? "";
  const errorId = props.id + "-error";
  input.setAttribute("aria-describedby", errorId);
  bindAttribute(owner,input,"aria-invalid",()=>props.field.ariaInvalid.value?"true":null);
  importValueBinding(owner,input,()=>props.field.value.value);
  listen(owner,input,"input",()=>{props.field.value.value=input.value;});
  listen(owner,input,"blur",()=>{props.field.blur();});
  const error = native("p");error.id=errorId;error.className="zui-field-error";
  error.setAttribute("aria-live","polite");
  const errorText=createText("");
  error.appendChild(errorText);
  bindText(owner,errorText,()=>props.field.visibleErrors.value.map(x=>x.message).join("; "));
  group.append(label,input,error);return view(group);
}
import { bindProperty } from "@zaakiyjs/dom/compiler";
function importValueBinding(owner:Parameters<typeof bindProperty>[0],input:HTMLInputElement,read:()=>string):void {
  bindProperty(owner,input,"value",read);
}
