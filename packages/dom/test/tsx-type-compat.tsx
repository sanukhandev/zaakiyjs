/** Typecheck-only TSX fixture: compiled JSX remains opaque in source typings. */
import { mount } from "../src/index.js";
import type { ViewNode } from "@zaakiyjs/core";

const host = document.createElement("main");
const Counter = (): ViewNode => <button onClick={(event: MouseEvent) => {
  void event.type;
}}>Counter</button>;
mount(() => <Counter />, host);
mount(() => <div>Native compiled text</div>, host);
mount(() => document.createElement("div"), host);
// @ts-expect-error A plain object is neither a JSX view nor a DOM node.
mount(() => ({ unexpected: true }), host);
