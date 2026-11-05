import { onMount } from "@zaakiyjs/core";
import type { ViewNode } from "@zaakiyjs/core";
import type { ReadonlySignal } from "@zaakiyjs/signals";
import { listen } from "@zaakiyjs/dom/compiler";
import {
  createDialog, createTabs, createMenu, createTooltip,
  createPopover, createDisclosure, createAccordion
} from "@zaakiyjs/ui-primitives";
import type { OverlayManager, TabsController } from "@zaakiyjs/ui-primitives";
import { currentOwner, native, view, nonEmpty } from "./native.js";

export interface DialogProps {
  readonly id:string;readonly title:string;readonly description:string;
  readonly triggerLabel:string;readonly overlays:OverlayManager;
  readonly modal?:boolean;readonly defaultOpen?:boolean;readonly open?:ReadonlySignal<boolean>;
  readonly onOpenChange?:(open:boolean)=>void;
}
export function Dialog(props:DialogProps):ViewNode {
  const owner=currentOwner();
  const root=native("div");root.className="zui-dialog-root";
  const trigger=native("button") as HTMLButtonElement;
  trigger.type="button";trigger.className="zui-button zui-button--md zui-button--primary zui-button--solid";
  trigger.textContent=props.triggerLabel;
  const panel=native("dialog") as HTMLDialogElement;
  panel.id=nonEmpty(props.id,"Dialog id");panel.className="zui-dialog";
  const title=native("h2");title.id=props.id+"-title";title.textContent=nonEmpty(props.title,"Dialog title");
  const description=native("p");description.id=props.id+"-description";description.textContent=props.description;
  const close=native("button") as HTMLButtonElement;
  close.type="button";close.className="zui-button zui-button--sm zui-button--neutral zui-button--outline";
  close.textContent="Close";
  panel.append(title,description,close);root.append(trigger,panel);
  // A mounted, connected node is required for native showModal and focus.
  onMount(()=>{
    const ctl=createDialog({
      owner,element:panel,overlays:props.overlays,
      modal:props.modal,defaultOpen:props.defaultOpen,open:props.open,
      onOpenChange:props.onOpenChange, labelledBy:title.id,describedBy:description.id
    });
    listen(owner,trigger,"click",()=>ctl.setOpen(true));
    listen(owner,close,"click",()=>ctl.setOpen(false));
  });
  return view(root);
}

export interface TabItem { readonly id:string;readonly label:string;readonly content:string;readonly disabled?:boolean }
export interface TabsProps {
  readonly id:string;readonly tabs:readonly TabItem[];
  readonly defaultValue?:string;readonly value?:ReadonlySignal<string>;
  readonly onValueChange?:(id:string)=>void;
  readonly activation?:"automatic"|"manual";
  readonly direction?:"ltr"|"rtl";
}
export function Tabs(props:TabsProps):ViewNode {
  const owner=currentOwner();
  if(!props.tabs.length)throw new RangeError("Tabs requires items");
  if(new Set(props.tabs.map(t=>t.id)).size!==props.tabs.length)throw new RangeError("Tab IDs must be unique");
  if(props.value&&!props.onValueChange)throw new TypeError("Controlled Tabs requires onValueChange");
  const initial=props.defaultValue??props.tabs.find(t=>!t.disabled)?.id;
  if(!initial||!props.tabs.some(t=>t.id===initial&&!t.disabled))throw new RangeError("Tabs needs an enabled default selection");
  const root=native("section");root.className="zui-tabs";
  const list=native("div");list.className="zui-tab-list";
  const entries:{id:string;tab:HTMLElement;panel:HTMLElement;disabled?:boolean}[]=[];
  for(const item of props.tabs){
    const button=native("button") as HTMLButtonElement;
    button.type="button";button.className="zui-tab";button.id=props.id+"-tab-"+item.id;
    button.textContent=item.label;button.disabled=item.disabled??false;
    const panel=native("div");panel.id=props.id+"-panel-"+item.id;
    panel.className="zui-tab-panel";panel.textContent=item.content;
    list.appendChild(button);
    root.appendChild(panel);
    entries.push({id:item.id,tab:button,panel,disabled:item.disabled});
  }
  root.insertBefore(list,root.firstChild);
  onMount(()=>{
    const ctl:TabsController=createTabs({
      owner,list,value:props.value,defaultValue:initial,
      onValueChange:next=>props.onValueChange?.(next),
      activation:props.activation,direction:props.direction
    });
    for(const entry of entries)ctl.register(entry);
  });
  return view(root);
}

export interface MenuEntry {readonly id:string;readonly label:string;readonly disabled?:boolean;readonly onSelect?:()=>void}
export interface DropdownMenuProps {
  readonly id:string;readonly triggerLabel:string;readonly items:readonly MenuEntry[];
  readonly overlays:OverlayManager;readonly direction?:"ltr"|"rtl";
}
export function DropdownMenu(props:DropdownMenuProps):ViewNode {
  const owner=currentOwner();
  if(new Set(props.items.map(x=>x.id)).size!==props.items.length)throw new RangeError("Menu item IDs must be unique");
  const root=native("div");root.className="zui-menu-root";
  const trigger=native("button") as HTMLButtonElement;
  trigger.type="button";trigger.className="zui-button zui-button--md zui-button--neutral zui-button--outline";
  trigger.textContent=props.triggerLabel;
  const menu=native("div");menu.className="zui-menu";menu.id=nonEmpty(props.id,"Menu id");
  const items=props.items.map(item=>{
    const button=native("button") as HTMLButtonElement;
    button.type="button";button.className="zui-menu-item";
    button.textContent=item.label;button.disabled=item.disabled??false;menu.appendChild(button);
    return {id:item.id,element:button,disabled:item.disabled,onSelect:item.onSelect};
  });
  root.append(trigger,menu);
  onMount(()=>{
    const ctl=createMenu({owner,trigger,content:menu,overlays:props.overlays,direction:props.direction});
    for(const item of items)ctl.register(item);
  });
  return view(root);
}
export interface TooltipProps {readonly id:string;readonly triggerLabel:string;readonly text:string;readonly delayMs?:number}
export function Tooltip(props:TooltipProps):ViewNode {
  const owner=currentOwner();
  const root=native("span");root.className="zui-tooltip-root";
  const trigger=native("button") as HTMLButtonElement;
  trigger.type="button";trigger.className="zui-button zui-button--md zui-button--neutral zui-button--ghost";
  trigger.textContent=props.triggerLabel;
  const tooltip=native("span");tooltip.className="zui-tooltip";tooltip.id=nonEmpty(props.id,"Tooltip id");
  tooltip.textContent=nonEmpty(props.text,"Tooltip text");
  root.append(trigger,tooltip);
  onMount(()=>{createTooltip({owner,trigger,tooltip,delayMs:props.delayMs});});
  return view(root);
}

export interface PopoverProps {
  readonly id:string;readonly triggerLabel:string;readonly text:string;
  readonly overlays:OverlayManager;readonly autoFocus?:boolean;
}
export function Popover(props:PopoverProps):ViewNode {
  const owner=currentOwner();
  const root=native("span");root.className="zui-popover-root";
  const trigger=native("button") as HTMLButtonElement;trigger.type="button";
  trigger.className="zui-button zui-button--md zui-button--neutral zui-button--outline";
  trigger.textContent=props.triggerLabel;
  const content=native("div");content.className="zui-popover";content.id=nonEmpty(props.id,"Popover id");
  content.textContent=props.text;
  root.append(trigger,content);
  onMount(()=>{createPopover({owner,trigger,content,overlays:props.overlays,autoFocus:props.autoFocus});});
  return view(root);
}

export interface AccordionEntry {readonly id:string;readonly title:string;readonly content:string;readonly expanded?:boolean}
export interface AccordionProps {
  readonly id:string;readonly items:readonly AccordionEntry[];
  readonly multiple?:boolean;
}
export function Accordion(props:AccordionProps):ViewNode {
  const owner=currentOwner();
  if(new Set(props.items.map(x=>x.id)).size!==props.items.length)throw new RangeError("Accordion IDs must be unique");
  const root=native("section");root.className="zui-accordion";
  const pairs=props.items.map(item=>{
    const heading=native("h3");
    const button=native("button") as HTMLButtonElement;
    button.type="button";button.className="zui-accordion-trigger";
    button.textContent=item.title;
    const panel=native("div");panel.className="zui-accordion-panel";
    panel.id=props.id+"-panel-"+item.id;panel.textContent=item.content;
    heading.appendChild(button);root.append(heading,panel);
    return {trigger:button,panel,expanded:item.expanded};
  });
  onMount(()=>{
    const group=createAccordion({owner,multiple:props.multiple});
    for(const item of pairs){
      const controller=createDisclosure({owner,trigger:item.trigger,panel:item.panel,defaultExpanded:item.expanded});
      group.add(controller);
    }
  });
  return view(root);
}
