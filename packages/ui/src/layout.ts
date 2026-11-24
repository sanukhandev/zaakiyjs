import type { ViewNode } from "@zaakiyjs/core";
import type { JSXChild } from "@zaakiyjs/core/jsx-runtime";
import { mountOwnedSlot, type OwnedNativeSlot } from "@zaakiyjs/dom/compiler";
import { native, currentOwner, view, nonEmpty } from "./native.js";
import type { UiSize } from "./recipes.js";

export interface LayoutBaseProps {
  /** Existing data-driven text items remain supported. */
  readonly items?: readonly string[];
  /** Compiler IR v2 native slot: caller-owned and mounted exactly once. */
  readonly children?: JSXChild | OwnedNativeSlot;
  readonly id?: string;
  readonly class?: string;
  readonly "aria-label"?: string;
}
function layout(props:LayoutBaseProps, className:string, tag="div"):ViewNode {
  currentOwner();
  const root=native(tag);
  root.className=className+(props.class?" "+props.class:"");
  if(props.id)root.id=props.id;
  if(props["aria-label"])root.setAttribute("aria-label",props["aria-label"]);
  for(const item of props.items ?? []){
    const child=native("div");
    child.textContent=item;
    root.appendChild(child);
  }
  if (props.children != null) {
    // The compiler supplies a one-shot, caller-owned NativeSlot. The runtime
    // rejects arbitrary JSX objects, strings and reused/disposed slots.
    mountOwnedSlot(props.children as OwnedNativeSlot, root);
  }
  return view(root);
}
export interface ContainerProps extends LayoutBaseProps { readonly size?:UiSize }
export function Container(props:ContainerProps):ViewNode {
  return layout(props,"zui-container zui-container--"+(props.size??"lg"));
}
export interface StackProps extends LayoutBaseProps { readonly gap?:"sm"|"md"|"lg" }
export function Stack(props:StackProps):ViewNode { return layout(props,"zui-stack zui-gap--"+(props.gap??"md")); }
export function Inline(props:StackProps):ViewNode { return layout(props,"zui-inline zui-gap--"+(props.gap??"md")); }
export interface GridProps extends StackProps { readonly columns?:1|2|3|4 }
export function Grid(props:GridProps):ViewNode {
  return layout(props,"zui-grid zui-cols--"+(props.columns??2)+" zui-gap--"+(props.gap??"md"));
}
export interface FlexProps extends StackProps {
  readonly direction?:"row"|"column";
  readonly justify?:"start"|"center"|"between"|"end";
}
export function Flex(props:FlexProps):ViewNode {
  return layout(props,"zui-flex zui-flex--"+(props.direction??"row")+" zui-justify--"+(props.justify??"start")+" zui-gap--"+(props.gap??"md"));
}
export interface AspectRatioProps {
  readonly ratio?: "square" | "video" | "portrait";
  readonly alt: string;
  readonly text: string;
}
export function AspectRatio(props:AspectRatioProps):ViewNode {
  currentOwner();
  const root=native("div");root.className="zui-aspect zui-aspect--"+(props.ratio??"video");
  root.setAttribute("role","img");root.setAttribute("aria-label",nonEmpty(props.alt,"alt"));
  const label=native("span");label.textContent=props.text;root.appendChild(label);
  return view(root);
}
export interface CardProps {
  readonly title:string;readonly description?:string;readonly class?:string;
  readonly children?: JSXChild | OwnedNativeSlot;
}
export function Card(props:CardProps):ViewNode {
  currentOwner();
  const article=native("article");
  article.className="zui-card"+(props.class?" "+props.class:"");
  const heading=native("h3");heading.textContent=props.title;
  article.appendChild(heading);
  if(props.description){const p=native("p");p.textContent=props.description;article.appendChild(p);}
  if (props.children != null) mountOwnedSlot(props.children as OwnedNativeSlot, article);
  return view(article);
}
