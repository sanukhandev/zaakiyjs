import type { ViewNode } from "@zaakiyjs/core";
import { currentOwner,native,view,safeHref } from "./native.js";
export interface BreadcrumbItem {readonly label:string;readonly href?:string}
export interface BreadcrumbsProps {readonly items:readonly BreadcrumbItem[]}
export function Breadcrumbs(props:BreadcrumbsProps):ViewNode {
  currentOwner();
  if(!props.items.length)throw new RangeError("Breadcrumbs requires items");
  const nav=native("nav");nav.setAttribute("aria-label","Breadcrumb");
  const ol=native("ol");ol.className="zui-breadcrumbs";
  props.items.forEach((item,i)=>{
    const li=native("li");
    if(item.href&&i<props.items.length-1){
      const link=native("a") as HTMLAnchorElement;
      link.href=safeHref(item.href);link.textContent=item.label;li.appendChild(link);
    }else {
      const span=native("span");span.textContent=item.label;
      if(i===props.items.length-1)span.setAttribute("aria-current","page");
      li.appendChild(span);
    }
    ol.appendChild(li);
  });
  nav.appendChild(ol);return view(nav);
}
export interface SidebarLayoutProps { readonly title:string;readonly links:readonly BreadcrumbItem[];readonly body:string }
export function SidebarLayout(props:SidebarLayoutProps):ViewNode {
  currentOwner();
  const root=native("div");root.className="zui-sidebar-layout";
  const nav=native("nav");nav.className="zui-sidebar";nav.setAttribute("aria-label",props.title);
  const heading=native("h2");heading.textContent=props.title;nav.appendChild(heading);
  for(const link of props.links){
    if(!link.href)continue;
    const anchor=native("a") as HTMLAnchorElement;anchor.href=safeHref(link.href);anchor.textContent=link.label;nav.appendChild(anchor);
  }
  const main=native("main");main.textContent=props.body;
  root.append(nav,main);return view(root);
}
