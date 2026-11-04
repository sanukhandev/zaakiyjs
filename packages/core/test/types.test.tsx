/** Compile-only TSX fixture. Must pass with strict TypeScript and no React types. */
import type { Component, ContextToken, OwnerScope } from "@zaakiyjs/core";
import type { JSX } from "@zaakiyjs/core/jsx-runtime";
import { createContext } from "../src/index.js";

interface Repository { get(id: string): Promise<string> }
const repo: ContextToken<Repository> = createContext<Repository>("Repo");
declare const owner: OwnerScope;
const Screen: Component<{ name: string }> = ({ name }) =>
  <main aria-label={name} data-testid="screen">
    <h1>{name}</h1>
    <input
      type="text"
      checked={false}
      onInput={(event) => { const name: string = event.type; void name; }}
      onKeyDown={(event) => { const key: string = event.key; void key; }}
      ref={(element) => { const value: string | undefined = element?.value; void value; }}
    />
    <button type="submit" disabled onClick={(event) => { const x: number = event.clientX; void x; }}>
      Submit
    </button>
    <svg viewBox="0 0 24 24" ref={(element) => { const v: SVGAnimatedRect | undefined = element?.viewBox; void v; }}>
      <path d="M0 0" fill="red" strokeWidth={2} />
    </svg>
  </main>;
const view: JSX.Element = <Screen name="A" />;
const keyedView: JSX.Element = <span key={42} data-testid="row">row</span>;
// @ts-expect-error HTML button type is restricted
const invalidButton = <button type="anything" />;
// @ts-expect-error input checked must be boolean
const invalidChecked = <input checked="yes" />;
// @ts-expect-error event handler receives MouseEvent, not KeyboardEvent
const invalidClick = <button onClick={(event: KeyboardEvent) => { void event; }} />;
// @ts-expect-error invalid ref element type
const invalidRef = <input ref={(element: SVGSVGElement) => { void element; }} />;
// @ts-expect-error unsupported arbitrary HTML attribute on div
const invalidHref = <div href="/unsafe" />;
// @ts-expect-error SVG fill must be string
const invalidFill = <path fill={3} />;
// @ts-expect-error unknown native element name
const invalidTag = <not-an-element />;
void owner; void repo; void view; void keyedView; void invalidButton; void invalidChecked;
void invalidClick; void invalidRef; void invalidHref; void invalidFill; void invalidTag;
