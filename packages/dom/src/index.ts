/** M0 TYPE CONTRACT ONLY. Mounting and DOM mutations are not implemented. */
import type { OwnerScope, ViewNode } from "@zaakiyjs/core";
export const foundationStatus = { package: "@zaakiyjs/dom", implemented: false } as const;
export interface MountHandle { readonly owner: OwnerScope; readonly root: Node; dispose(): void }
export interface BindingHandle { dispose(): void }
export type MountFactory = () => ViewNode;
export type DomTarget = Element | DocumentFragment;
export type Namespace = "html" | "svg" | "mathml";
export interface KeyedEntry<Key, Item> { readonly key: Key; readonly item: Item; readonly node: Node }
export interface KeyedLoopOptions<Key, Item> { readonly keyOf: (item: Item) => Key; readonly create: (item: Item) => Node }
