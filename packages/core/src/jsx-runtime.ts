/**
 * Strict, compiler-facing JSX types. There is intentionally no jsx/jsxs runtime:
 * ZaakiyJS TSX uses jsx: preserve until the compiler lowers the expressions.
 */
import type { ViewNode } from "./component.js";

export type JSXChild = ViewNode | string | number | boolean | null | undefined | readonly JSXChild[];
export type ElementRef<E extends Element> = (element: E | null) => void;

export interface EventAttributes {
  readonly onClick?: (event: MouseEvent) => void;
  readonly onDblClick?: (event: MouseEvent) => void;
  readonly onInput?: (event: InputEvent) => void;
  readonly onChange?: (event: Event) => void;
  readonly onFocus?: (event: FocusEvent) => void;
  readonly onBlur?: (event: FocusEvent) => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  readonly onKeyUp?: (event: KeyboardEvent) => void;
  readonly onPointerDown?: (event: PointerEvent) => void;
  readonly onPointerUp?: (event: PointerEvent) => void;
  readonly onMouseEnter?: (event: MouseEvent) => void;
  readonly onMouseLeave?: (event: MouseEvent) => void;
  readonly onSubmit?: (event: SubmitEvent) => void;
  readonly onInvalid?: (event: Event) => void;
  readonly onLoad?: (event: Event) => void;
  readonly onError?: (event: Event) => void;
}

export type AriaAttributes = {
  readonly [K in `aria-${string}`]?: string | number | boolean | null | undefined;
};
export type DataAttributes = {
  readonly [K in `data-${string}`]?: string | number | boolean | null | undefined;
};
export type CSSProperties = Readonly<Record<string, string | number | null | undefined>>;

export interface GlobalAttributes<E extends Element> extends EventAttributes {
  readonly children?: JSXChild;
  /** Compile-time loop identity; never emitted as a DOM attribute. */
  readonly key?: string | number | symbol;
  readonly ref?: ElementRef<E>;
  readonly id?: string;
  readonly class?: string;
  readonly style?: string | CSSProperties;
  readonly title?: string;
  readonly role?: string;
  readonly tabIndex?: number;
  readonly hidden?: boolean;
  readonly dir?: "ltr" | "rtl" | "auto";
  readonly lang?: string;
  readonly draggable?: boolean;
  readonly contentEditable?: boolean | "true" | "false" | "inherit";
  readonly slot?: string;
}

type HTMLSpecific<E extends Element> =
  (E extends HTMLInputElement ? {
    readonly type?: string; readonly value?: string | number; readonly checked?: boolean;
    readonly disabled?: boolean; readonly required?: boolean; readonly readOnly?: boolean;
    readonly placeholder?: string; readonly name?: string; readonly min?: string | number;
    readonly max?: string | number; readonly step?: string | number; readonly multiple?: boolean;
    readonly autoComplete?: string; readonly accept?: string; readonly form?: string;
  } : object) &
  (E extends HTMLButtonElement ? {
    readonly type?: "button" | "submit" | "reset"; readonly disabled?: boolean;
    readonly name?: string; readonly value?: string; readonly form?: string;
  } : object) &
  (E extends HTMLAnchorElement ? {
    readonly href?: string; readonly target?: string; readonly rel?: string;
    readonly download?: string | boolean;
  } : object) &
  (E extends HTMLImageElement ? {
    readonly src?: string; readonly alt?: string; readonly width?: number;
    readonly height?: number; readonly loading?: "lazy" | "eager";
  } : object) &
  (E extends HTMLTextAreaElement ? {
    readonly value?: string; readonly rows?: number; readonly cols?: number;
    readonly placeholder?: string; readonly disabled?: boolean; readonly required?: boolean;
    readonly readOnly?: boolean; readonly name?: string;
  } : object) &
  (E extends HTMLSelectElement ? {
    readonly value?: string | number; readonly disabled?: boolean;
    readonly multiple?: boolean; readonly required?: boolean; readonly name?: string;
  } : object) &
  (E extends HTMLOptionElement ? {
    readonly value?: string; readonly disabled?: boolean; readonly selected?: boolean;
  } : object) &
  (E extends HTMLFormElement ? {
    readonly action?: string; readonly method?: "get" | "post" | "dialog";
    readonly noValidate?: boolean;
  } : object) &
  (E extends HTMLLabelElement ? { readonly htmlFor?: string } : object) &
  (E extends HTMLTableCellElement ? { readonly colSpan?: number; readonly rowSpan?: number } : object);

export type HTMLAttributes<E extends HTMLElement> =
  GlobalAttributes<E> & AriaAttributes & DataAttributes & HTMLSpecific<E>;

export interface SVGAttributes<E extends SVGElement> extends GlobalAttributes<E>, AriaAttributes, DataAttributes {
  readonly viewBox?: string;
  readonly xmlns?: string;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly x?: number | string;
  readonly y?: number | string;
  readonly d?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number | string;
  readonly transform?: string;
  readonly cx?: number | string;
  readonly cy?: number | string;
  readonly r?: number | string;
  readonly points?: string;
  readonly preserveAspectRatio?: string;
}

type IntrinsicTag = keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap;
type NativeIntrinsicElements = {
  [Tag in IntrinsicTag]:
    Tag extends keyof HTMLElementTagNameMap
      ? HTMLAttributes<HTMLElementTagNameMap[Tag]>
      : Tag extends keyof SVGElementTagNameMap
        ? SVGAttributes<SVGElementTagNameMap[Tag]>
        : never;
};

export namespace JSX {
  export type Element = ViewNode;
  export interface ElementChildrenAttribute { children: unknown }
  export interface IntrinsicAttributes { readonly key?: string | number | symbol }
  export type IntrinsicElements = NativeIntrinsicElements;
}
