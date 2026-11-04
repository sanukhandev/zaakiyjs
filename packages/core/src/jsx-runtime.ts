/** M0 TSX TYPECHECK SUPPORT ONLY. No jsx/jsxs runtime is implemented. */
import type { ViewNode } from "./index.js";
type Child = ViewNode | string | number | boolean | null | undefined | readonly Child[];
interface CommonProps {
  readonly children?: Child;
  readonly class?: string;
  readonly id?: string;
  readonly title?: string;
  readonly role?: string;
  readonly "aria-label"?: string;
  readonly "aria-hidden"?: boolean | "true" | "false";
}
interface ElementProps extends CommonProps {
  readonly onClick?: (event: MouseEvent) => void;
  readonly onInput?: (event: InputEvent) => void;
  readonly onChange?: (event: Event) => void;
}
interface InputProps extends ElementProps {
  readonly type?: string;
  readonly value?: string | number;
  readonly checked?: boolean;
  readonly disabled?: boolean;
}
export namespace JSX {
  export type Element = ViewNode;
  export interface ElementChildrenAttribute { children: unknown }
  export interface IntrinsicAttributes { key?: string | number }
  export interface IntrinsicElements {
    div: ElementProps;
    main: ElementProps;
    h1: ElementProps;
    p: ElementProps;
    span: ElementProps;
    button: ElementProps & { readonly disabled?: boolean; readonly type?: "button" | "submit" | "reset" };
    input: InputProps;
    svg: ElementProps & { readonly viewBox?: string; readonly width?: number | string; readonly height?: number | string };
    path: ElementProps & { readonly d?: string };
  }
}
