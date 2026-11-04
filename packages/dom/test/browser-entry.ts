/**
 * Native-browser smoke: bundled by Vite in the package test, executed in Chrome.
 * No application JSX runtime or browser-side build tooling is introduced.
 */
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { flushSync, signal } from "@zaakiyjs/signals";
import { mount } from "../src/index.js";
import {
  bindText, createElement, createText, listen, setAttribute
} from "../src/compiler.js";
import { bindConditionalRegion, bindKeyedRegion, createRegion } from "../src/compiler.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const host = document.createElement("section");
  document.body.append(host);
  const count = signal(0);
  let setup = 0;
  let calls = 0;
  const app = mount((owner) => {
    setup++;
    const button = createElement("button", "html");
    const node = createText("");
    button.append(node);
    bindText(owner, node, () => count.value);
    listen(owner, button, "click", () => { calls++; count.value++; });
    return button;
  }, host);
  const button = host.querySelector("button");
  check(button, "mount produced no button");
  check(button.firstChild?.nodeType === Node.TEXT_NODE, "text binding replaced the node");
  const text = button.firstChild as Text;
  const observer = new MutationObserver(() => undefined);
  observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
  button.click();
  flushSync();
  const updates = observer.takeRecords();
  check(updates.length === 1 && updates[0]?.target === text &&
    updates[0]?.type === "characterData", "unrelated DOM mutation");
  check(text.data === "1" && setup === 1 && calls === 1, "targeted update failed");
  app.dispose();
  button.click();
  check(calls === 1 && host.querySelector("button") === null, "listener or mount leaked");
  observer.disconnect();

  const listHost = document.createElement("div");
  document.body.append(listHost);
  const items = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
  const list = mount((owner) => {
    const regionHost = document.createElement("div");
    const region = createRegion(regionHost);
    bindKeyedRegion(owner, region, () => items.value, item => item.id, item => {
      const input = document.createElement("input");
      input.dataset.key = item.id;
      return { node: input, update(next: { id: string }) {
        input.dataset.key = next.id;
      } };
    });
    return regionHost;
  }, listHost);
  const focused = listHost.querySelector<HTMLInputElement>('[data-key="b"]');
  check(focused, "keyed fixture missing input");
  focused.value = "typed";
  focused.focus();
  focused.setSelectionRange(2, 2);
  items.value = [{ id: "c" }, { id: "b" }, { id: "a" }];
  flushSync();
  const keys = [...listHost.querySelectorAll("input")].map(el => el.dataset.key).join(",");
  check(keys === "c,b,a", "keyed DOM order incorrect");
  check(listHost.querySelector('[data-key="b"]') === focused, "keyed node identity lost");
  check(focused.value === "typed" && document.activeElement === focused, "focus/input state lost");
  check(focused.selectionStart === 2, "input selection lost");
  list.dispose();

  const owner = createOwner();
  const conditionalHost = document.createElement("div");
  document.body.append(conditionalHost);
  const region = createRegion(conditionalHost);
  const enabled = signal(true);
  let clicked = 0;
  bindConditionalRegion(owner, region, () => enabled.value, child => {
    const el = document.createElement("button");
    listen(child, el, "click", () => clicked++);
    return el;
  });
  const old = conditionalHost.querySelector("button");
  check(old, "conditional did not mount");
  old.click();
  enabled.value = false;
  flushSync();
  old.click();
  check(clicked === 1 && !conditionalHost.querySelector("button"), "conditional cleanup leaked");
  disposeOwner(owner);

  const svg = createElement("svg", "svg");
  const path = createElement("path", "svg");
  svg.appendChild(path);
  check(path.namespaceURI === "http://www.w3.org/2000/svg", "SVG namespace lost");
  const anchor = createElement("a", "html");
  let blocked = false;
  try { setAttribute(anchor, "href", "javascript:alert(1)"); }
  catch { blocked = true; }
  check(blocked, "unsafe URL was accepted");
  document.body.setAttribute("data-zaakiy-browser-result", "pass");
} catch (error) {
  document.body.setAttribute(
    "data-zaakiy-browser-result",
    "fail: " + (error instanceof Error ? error.message : String(error))
  );
}
