import type { ViewNode } from "./component.js";

/**
 * Compile-time TSX intrinsics. They are deliberately not a JSX renderer.
 * The compiler recognizes only imports from @zaakiyjs/core, lowering
 * the elements to the versioned DOM region ABI before execution.
 */
export interface ShowProps {
  readonly when: boolean;
  readonly fallback?: ViewNode | null;
  readonly children: ViewNode;
}

export function Show(_props: ShowProps): ViewNode {
  throw new Error("ZaakiyJS <Show> must be transformed by @zaakiyjs/compiler.");
}

export interface ForProps<Item, Key extends PropertyKey> {
  readonly each: readonly Item[];
  readonly by: (item: Item) => Key;
  readonly children: (item: Item) => ViewNode;
}

export function For<Item, Key extends PropertyKey>(_props: ForProps<Item, Key>): ViewNode {
  throw new Error("ZaakiyJS <For> must be transformed by @zaakiyjs/compiler.");
}
