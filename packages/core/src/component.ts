import { initializeOwnedComponent } from "./owner.js";
import type { OwnerScope } from "./owner.js";

/** A compiler-produced view description, not a virtual DOM node. */
export interface ViewNode { readonly __zaakiyViewNode: unique symbol }
export type Component<Props extends object = Record<string, never>> =
  (props: Readonly<Props>) => ViewNode;
export type ComponentFactory<Props extends object> =
  (props: Readonly<Props>, owner: OwnerScope) => ViewNode;

/** Compiler/DOM integration invokes component setup exactly once per owner. */
export function executeComponent<Props extends object>(
  component: Component<Props>,
  props: Readonly<Props>,
  owner: OwnerScope
): ViewNode {
  return initializeOwnedComponent(owner, () => component(props));
}
