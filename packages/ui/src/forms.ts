import { listen, bindProperty } from "@zaakiyjs/dom/compiler";
import type { ViewNode } from "@zaakiyjs/core";
import { createControlledState } from "@zaakiyjs/ui-primitives";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import { currentOwner,native,view,nonEmpty } from "./native.js";
export interface SelectionDetail { readonly reason:"pointer"|"keyboard"|"programmatic";readonly originalEvent?:Event }
export interface SelectionProps<T> {
  readonly value?:ReadonlySignal<T>;
  readonly defaultValue?:T;
  readonly onValueChange?:(value:T,detail:SelectionDetail)=>void;
}
export interface RadioChoice { readonly value:string;readonly label:string;readonly disabled?:boolean }
export interface RadioGroupProps extends SelectionProps<string> {
  readonly legend:string;readonly name:string;readonly options:readonly RadioChoice[];
  readonly disabled?:boolean;readonly required?:boolean;
}
export function RadioGroup(props:RadioGroupProps):ViewNode {
  const owner=currentOwner();
  if(props.value&&!props.onValueChange)throw new TypeError("Controlled RadioGroup requires onValueChange");
  if(!props.options.length||new Set(props.options.map(x=>x.value)).size!==props.options.length)throw new RangeError("Radio values must be unique");
  const state=createControlledState({owner,value:props.value,defaultValue:props.defaultValue??"",
    onValueChange:(next,detail)=>props.onValueChange?.(next,{
      reason:detail.reason==="pointer"?"pointer":detail.reason==="keyboard"?"keyboard":"programmatic",
      originalEvent:detail.originalEvent
    })});
  const root=native("fieldset") as HTMLFieldSetElement;
  root.className="zui-radio-group";root.disabled=props.disabled??false;
  const legend=native("legend");legend.textContent=nonEmpty(props.legend,"legend");root.appendChild(legend);
  const radios: HTMLInputElement[] = [];
  // Native radios switch before firing "change". In controlled mode a rejected
  // state request must not leave the DOM/form submission disagreeing with the signal.
  const reconcileControlledSelection = (): void => {
    if (!props.value) return;
    const selected = state.value.peek();
    for (const item of radios) item.checked = item.value === selected;
  };
  for(const option of props.options){
    const label=native("label");label.className="zui-check-label";
    const radio=native("input") as HTMLInputElement;
    radio.type="radio";radio.name=props.name;radio.value=option.value;
    radio.required=props.required??false;radio.disabled=option.disabled??false;
    radios.push(radio);
    bindProperty(owner,radio,"checked",()=>state.value.value===option.value);
    listen(owner,radio,"change",event=>{
      if (!radio.checked) return;
      try {
        state.set(option.value,{
          reason:event instanceof MouseEvent?"pointer":"keyboard",originalEvent:event
        });
      } finally {
        reconcileControlledSelection();
      }
    });
    const text=native("span");text.textContent=option.label;
    label.append(radio,text);root.appendChild(label);
  }
  return view(root);
}
export interface SwitchProps extends SelectionProps<boolean> {
  readonly label:string;
  readonly disabled?:boolean;
}
export function Switch(props:SwitchProps):ViewNode {
  const owner=currentOwner();
  if(props.value&&!props.onValueChange)throw new TypeError("Controlled Switch requires onValueChange");
  const state=createControlledState({owner,value:props.value,defaultValue:props.defaultValue??false,
    onValueChange:(next,detail)=>props.onValueChange?.(next,{
      reason:detail.reason==="pointer"?"pointer":detail.reason==="keyboard"?"keyboard":"programmatic",
      originalEvent:detail.originalEvent
    })});
  const button=native("button") as HTMLButtonElement;
  button.type="button";button.className="zui-switch";button.setAttribute("role","switch");
  button.textContent=nonEmpty(props.label,"label");button.disabled=props.disabled??false;
  // Using the DOM reactive binding avoids a component-wide rerender.
  importBindAttribute(owner,button,()=>String(state.value.value));
  listen(owner,button,"click",event=>{if(!button.disabled)state.set(!state.value.peek(),{
    reason:event instanceof MouseEvent&&event.detail===0?"keyboard":"pointer",originalEvent:event
  });});
  return view(button);
}
import { bindAttribute } from "@zaakiyjs/dom/compiler";
function importBindAttribute(owner:Parameters<typeof bindAttribute>[0],element:Element,read:()=>string):void {
  bindAttribute(owner,element,"aria-checked",read);
}
export interface FormFieldProps {
  readonly id:string;readonly label:string;readonly description?:string;
  readonly error?:string;readonly required?:boolean;
}
export function FormField(props:FormFieldProps):ViewNode {
  currentOwner();
  const root=native("div");root.className="zui-field";
  const label=native("label") as HTMLLabelElement;label.htmlFor=props.id;
  label.textContent=nonEmpty(props.label,"label");label.className="zui-field-label";
  root.appendChild(label);
  if(props.description){const help=native("p");help.className="zui-field-description";help.textContent=props.description;root.appendChild(help);}
  if(props.error){const err=native("p");err.className="zui-field-error";err.id=props.id+"-error";err.textContent=props.error;root.appendChild(err);}
  return view(root);
}
