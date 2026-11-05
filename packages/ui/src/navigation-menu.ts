import type { ViewNode } from "@zaakiyjs/core";
import { currentOwner,native,view,safeHref } from "./native.js";
export interface NavigationLink {readonly label:string;readonly href:string;readonly current?:boolean}
export interface NavigationMenuProps {readonly label:string;readonly links:readonly NavigationLink[]}
/** A semantic site nav; action dropdowns use the separate primitive-backed DropdownMenu. */
export function NavigationMenu(props:NavigationMenuProps):ViewNode {
  currentOwner();
  const nav=native("nav");nav.className="zui-navigation-menu";
  nav.setAttribute("aria-label",props.label);
  const ul=native("ul");
  for(const link of props.links){
    const li=native("li");
    const a=native("a") as HTMLAnchorElement;
    a.href=safeHref(link.href);a.textContent=link.label;
    if(link.current)a.setAttribute("aria-current","page");
    li.appendChild(a);ul.appendChild(li);
  }
  nav.appendChild(ul);return view(nav);
}
