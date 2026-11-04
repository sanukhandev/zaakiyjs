// @vitest-environment jsdom
// Hand-authored ABI fixtures until the compiler emits executable TSX.
import { afterEach, describe, expect, it, vi } from "vitest";
import { signal, flushSync } from "@zaakiyjs/signals";
import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner, onCleanup, onMount } from "@zaakiyjs/core";
import { mount } from "../src/index.js";
import {
  bindAttribute, bindClass, bindProperty, bindRef, bindStyle, bindText,
  cloneStatic, createElement, createText, listen, listenStable, setAttribute,
  setProperty, setStyle
} from "../src/compiler.js";
import { bindConditionalRegion, bindKeyedRegion, createRegion } from "../src/regions.js";

afterEach(() => { document.body.replaceChildren(); });

describe("compiler-lowered native DOM runtime", () => {
  it("runs factory once, mounts multiple nodes, and disposes only its range", () => {
    let calls = 0;
    const container = document.createElement("div");
    const original = document.createElement("aside");
    container.appendChild(original);
    const view = mount(() => {
      calls++;
      return [document.createTextNode("one"), document.createElement("b")];
    }, container);
    expect(calls).toBe(1);
    expect(container.textContent).toBe("one");
    expect(view.owner.state).toBe("active");
    view.dispose();
    view.dispose();
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstChild).toBe(original);
    expect(view.owner.disposed).toBe(true);
  });


  it("mounts nested component owners once and disposes descendants before the parent", () => {
    const order: string[] = [];
    const container = document.createElement("div");
    const app = mount((owner) => {
      onCleanup(() => order.push("root"));
      const child = createOwner(owner);
      const el = initializeOwnedComponent(child, () => {
        onMount(() => order.push("child mounted"));
        onCleanup(() => order.push("child"));
        return document.createElement("section");
      });
      onMount(() => mountOwner(child));
      return el;
    }, container);
    expect(order).toEqual(["child mounted"]);
    app.dispose();
    expect(order).toEqual(["child mounted", "child", "root"]);
  });

  it("uses Text.data with zero unrelated mutations and tracks dynamic dependencies", async () => {
    const choose = signal(true);
    const a = signal(1);
    const b = signal(5);
    const original = document.createElement("span");
    const text = createText("");
    original.appendChild(text);
    const sibling = document.createElement("p");
    const container = document.createElement("div");
    container.append(original, sibling);
    const view = mount((owner) => {
      bindText(owner, text, () => choose.value ? a.value : b.value);
      return document.createComment("mounted");
    }, container);
    flushSync();
    expect(text.data).toBe("1");
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver((records) => observed.push(...records));
    observer.observe(container, { attributes: true, characterData: true, childList: true, subtree: true });
    a.value = 2;
    flushSync();
    await Promise.resolve();
    expect(text.data).toBe("2");
    expect(observed.filter((record) => record.target === text && record.type === "characterData")).toHaveLength(1);
    expect(observed.filter((record) => record.target !== text)).toHaveLength(0);
    observed.length = 0;
    choose.value = false;
    flushSync();
    b.value = 6;
    flushSync();
    a.value = 9;
    flushSync();
    expect(text.data).toBe("6");
    expect(observed.filter((record) => record.target !== text)).toHaveLength(0);
    view.dispose();
    observer.disconnect();
  });


  it("renders nullish and boolean dynamic children as empty, without dropping numeric zero", () => {
    const owner = createOwner();
    const value = signal<unknown>(false);
    const node = createText("initial");
    const read = vi.fn(() => value.value);
    bindText(owner, node, read);
    expect(node.data).toBe("");
    value.value = true;
    flushSync();
    expect(node.data).toBe("");
    value.value = 0;
    flushSync();
    expect(node.data).toBe("0");
    value.value = null;
    flushSync();
    expect(node.data).toBe("");
    expect(read).toHaveBeenCalledTimes(4);
    disposeOwner(owner);
  });

  it("updates native properties, safe attributes, classes, styles and refs", () => {
    const owner = createOwner();
    const input = document.createElement("input");
    const value = signal("start");
    const klass = signal("alpha");
    const ref = vi.fn();
    bindProperty(owner, input, "value", () => value.value);
    bindClass(owner, input, () => klass.value);
    bindStyle(owner, input, "--accent", () => "red");
    bindAttribute(owner, input, "title", () => "safe");
    bindRef(owner, input, ref);
    flushSync();
    input.focus();
    input.setSelectionRange(2, 2);
    value.value = "changed";
    klass.value = "beta";
    flushSync();
    expect(input.value).toBe("changed");
    expect(input.getAttribute("class")).toBe("beta");
    expect(input.style.getPropertyValue("--accent")).toBe("red");
    expect(input.title).toBe("safe");
    expect(ref).toHaveBeenCalledWith(input);
    disposeOwner(owner);
    expect(ref).toHaveBeenLastCalledWith(null);
  });

  it("never interprets text as HTML and blocks unsafe sinks and URLs", () => {
    const node = createText("<img src=x onerror=alert(1)>");
    expect(node.data).toContain("<img");
    const el = document.createElement("a");
    expect(() => setAttribute(el, "href", "javascript:alert(1)")).toThrow();
    expect(() => setAttribute(el, "onclick", "alert(1)")).toThrow();
    expect(() => setProperty(el, "innerHTML", "<b>unsafe</b>")).toThrow();
    expect(() => setProperty(el, "outerText", "destructive")).toThrow();
    expect(() => setProperty(el, "textContent", "destructive")).toThrow();
    expect(() => setAttribute(el, "srcdoc", "<script>alert(1)</script>")).toThrow();
    expect(() => setAttribute(el, "style", "background:url(https://tracker.invalid)")).toThrow();
    expect(() => setProperty(el, "href", "java\nscript:alert(1)")).toThrow();
    expect(() => setStyle(el, "color", "url(javascript:alert(1))")).toThrow();
    expect(() => setAttribute(el, "srcset", "https://example.com/a 1x")).toThrow();
    setAttribute(el, "href", "/safe");
    expect(el.getAttribute("href")).toBe("/safe");
    let calls = 0;
    setProperty(el, "href", {
      toString() {
        calls++;
        return calls === 1 ? "https://safe.example/" : "javascript:alert(1)";
      }
    });
    expect(calls).toBe(1);
    expect(el.href).toBe("https://safe.example/");
  });

  it("creates SVG namespaces and preserves static subtree source", () => {
    const svg = createElement("svg", "svg");
    const path = createElement("path", "svg");
    svg.appendChild(path);
    setAttribute(path, "xlink:href", "#shape");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(path.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#shape");
    const duplicate = cloneStatic(svg);
    expect(duplicate).not.toBe(svg);
    expect(duplicate.firstChild).not.toBe(path);
    expect(duplicate.firstElementChild?.namespaceURI).toBe(path.namespaceURI);
  });


  it("does not retain listeners across repeated application mounts", () => {
    const container = document.createElement("div");
    const called = vi.fn();
    const detached: HTMLButtonElement[] = [];
    for (let index = 0; index < 20; index++) {
      const view = mount((owner) => {
        const button = document.createElement("button");
        listen(owner, button, "click", called);
        detached.push(button);
        return button;
      }, container);
      const button = detached[index]!;
      button.click();
      view.dispose();
      expect(container.childNodes).toHaveLength(0);
    }
    for (const element of detached) element.click();
    expect(called).toHaveBeenCalledTimes(20);
  });

  it("disposes removed keyed owners exactly once and updates retained item views", () => {
    const owner = createOwner();
    const parent = document.createElement("div");
    const region = createRegion(parent);
    const entries = signal([{ id: "a", label: "Alpha" }, { id: "b", label: "Bravo" }]);
    const closed = vi.fn();
    const updated = vi.fn();
    bindKeyedRegion(owner, region, () => entries.value, (item) => item.id, (item) => {
      const label = document.createElement("span");
      label.textContent = item.label;
      onCleanup(() => closed(item.id));
      return {
        node: label,
        update(next: { id: string; label: string }) {
          updated(next.id);
          label.textContent = next.label;
        }
      };
    });
    flushSync();
    const retained = parent.querySelectorAll("span")[1];
    entries.value = [{ id: "b", label: "Updated" }];
    flushSync();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith("a");
    expect(updated).toHaveBeenCalledOnce();
    expect(parent.querySelector("span")).toBe(retained);
    expect(retained?.textContent).toBe("Updated");
    disposeOwner(owner);
    expect(closed).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledWith("b");
  });


  it("waits for connected DOM before running conditional child mount hooks", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const seen: boolean[] = [];
    const app = mount((owner) => {
      const section = document.createElement("section");
      const region = createRegion(section);
      bindConditionalRegion(owner, region, () => true, () => {
        const button = document.createElement("button");
        onMount(() => seen.push(button.isConnected));
        return button;
      });
      expect(seen).toEqual([]);
      return section;
    }, host);
    expect(seen).toEqual([true]);
    app.dispose();
  });

  it("does not subscribe a conditional to signals read during child setup", () => {
    const parent = document.createElement("div");
    const owner = createOwner();
    const region = createRegion(parent);
    const active = signal(true);
    const detail = signal("one");
    const predicates = vi.fn(() => active.value);
    bindConditionalRegion(owner, region, predicates, () => {
      const label = document.createElement("span");
      label.textContent = detail.value;
      return label;
    });
    expect(predicates).toHaveBeenCalledTimes(1);
    detail.value = "two";
    flushSync();
    expect(predicates).toHaveBeenCalledTimes(1);
    expect(parent.querySelector("span")?.textContent).toBe("one");
    disposeOwner(owner);
  });

  it("does not track reactive reads from keyed item-level updates", () => {
    const parent = document.createElement("div");
    const owner = createOwner();
    const region = createRegion(parent);
    const entries = signal([{ id: "a", name: "A" }]);
    const incidental = signal(1);
    const readList = vi.fn(() => entries.value);
    bindKeyedRegion(owner, region, readList, (item) => item.id, (item) => {
      const label = document.createElement("span");
      label.textContent = item.name;
      return { node: label, update(next: { id: string; name: string }) {
        label.textContent = next.name + incidental.value;
      }};
    });
    expect(readList).toHaveBeenCalledTimes(1);
    entries.value = [{ id: "a", name: "B" }];
    flushSync();
    expect(readList).toHaveBeenCalledTimes(2);
    incidental.value = 2;
    flushSync();
    expect(readList).toHaveBeenCalledTimes(2);
    disposeOwner(owner);
  });

  it("rolls back newly added keyed owners without removing old nodes on factory failure", () => {
    const owner = createOwner();
    const parent = document.createElement("div");
    const region = createRegion(parent);
    const entries = signal(["a"]);
    const disposed = vi.fn();
    bindKeyedRegion(owner, region, () => entries.value, (item) => item, (item) => {
      if (item === "c") throw new Error("factory failed");
      onCleanup(() => disposed(item));
      const node = document.createElement("span");
      node.dataset.id = item;
      return { node };
    });
    const old = parent.querySelector("[data-id=a]");
    entries.value = ["a", "b", "c"];
    expect(() => flushSync()).toThrow("factory failed");
    expect(parent.querySelector("[data-id=a]")).toBe(old);
    expect(parent.querySelector("[data-id=b]")).toBeNull();
    expect(disposed).toHaveBeenCalledWith("b");
    expect(disposed).not.toHaveBeenCalledWith("a");
    disposeOwner(owner);
    expect(disposed).toHaveBeenCalledWith("a");
  });

  it("rejects duplicate roots before mutating DOM and disposes the failed owner", () => {
    const host = document.createElement("div");
    const node = document.createElement("p");
    expect(() => mount(() => [node, node], host)).toThrow(/distinct native DOM nodes/);
    expect(host.childNodes).toHaveLength(0);
  });


  it("rejects stateful object coercion at attribute and CSS sinks", () => {
    const node = document.createElement("a");
    let coercions = 0;
    const malicious = {
      toString() {
        coercions++;
        return coercions === 1 ? "https://safe.example/" : "javascript:alert(1)";
      }
    };
    expect(() => setAttribute(node, "href", malicious as unknown as string)).toThrow();
    expect(() => setStyle(node, "--background", malicious as unknown as string)).toThrow();
    expect(coercions).toBe(0);
  });

  it("releases conditional owner resources after a failed first render", () => {
    const parent = document.createElement("div");
    const owner = createOwner();
    const region = createRegion(parent);
    const cleanup = vi.fn();
    expect(() => bindConditionalRegion(owner, region, () => true, () => {
      onCleanup(cleanup);
      throw new Error("failed conditional view");
    })).toThrow("failed conditional view");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(parent.querySelector("*")).toBeNull();
    disposeOwner(owner);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe URL protocols including protocol-obfuscated controls", () => {
    const link = document.createElement("a");
    for (const unsafe of [
      "javascript:alert(1)", "data:text/html,alert(1)",
      "vbscript:msgbox(1)", "java\u0009script:alert(1)",
      "  javascript:alert(1)"
    ]) {
      expect(() => setAttribute(link, "href", unsafe)).toThrow();
    }
    expect(() => setAttribute(link, "ping", "https://tracker.invalid/")).toThrow();
    const frame = document.createElement("iframe");
    expect(() => setProperty(frame, "srcdoc", "<script>1</script>")).toThrow();
    expect(() => setAttribute(frame, "src", "mailto:evil@example.com")).toThrow();
    setAttribute(link, "href", "https://example.com/allowed");
    expect(link.getAttribute("href")).toBe("https://example.com/allowed");
  });

  it("keeps one listener during handler changes and removes it on disposal", () => {
    const owner = createOwner();
    const button = document.createElement("button");
    const handler = signal<((event: Event) => void)>(() => undefined);
    const first = vi.fn();
    const second = vi.fn();
    handler.value = first;
    listenStable(owner, button, "click", () => handler.value);
    flushSync();
    button.click();
    handler.value = second;
    flushSync();
    button.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    disposeOwner(owner);
    button.click();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("tears down conditional children, listeners and owners once", () => {
    const owner = createOwner();
    const parent = document.createElement("section");
    const region = createRegion(parent);
    const visible = signal(true);
    const called = vi.fn();
    let constructions = 0;
    bindConditionalRegion(owner, region, () => visible.value, (child) => {
      constructions++;
      const button = document.createElement("button");
      listen(child, button, "click", called);
      return button;
    });
    flushSync();
    const original = parent.querySelector("button")!;
    original.click();
    visible.value = false;
    flushSync();
    expect(parent.querySelector("button")).toBeNull();
    original.click();
    expect(called).toHaveBeenCalledTimes(1);
    visible.value = true;
    flushSync();
    expect(constructions).toBe(2);
    expect(parent.querySelector("button")).not.toBe(original);
    disposeOwner(owner);
  });

  it("reuses keyed DOM identity, preserves input state/focus and rejects duplicate keys", () => {
    const owner = createOwner();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const region = createRegion(parent);
    const entries = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const cleanup = vi.fn();
    const initialized = vi.fn();
    bindKeyedRegion(owner, region, () => entries.value, (item) => item.id, (item, child) => {
      initialized(item.id);
      const input = document.createElement("input");
      input.dataset.key = item.id;
      listen(child, input, "change", cleanup);
      return { node: input };
    });
    flushSync();
    const b = parent.querySelector<HTMLInputElement>('[data-key="b"]')!;
    b.value = "typed";
    b.focus();
    entries.value = [{ id: "c" }, { id: "b" }, { id: "a" }];
    flushSync();
    expect(Array.from(parent.querySelectorAll("input")).map((n) => n.dataset.key)).toEqual(["c", "b", "a"]);
    expect(parent.querySelector('[data-key="b"]')).toBe(b);
    expect(b.value).toBe("typed");
    expect(document.activeElement).toBe(b);
    expect(initialized).toHaveBeenCalledTimes(3);
    expect(() => {
      entries.value = [{ id: "c" }, { id: "c" }];
      flushSync();
    }).toThrow();
    expect(parent.querySelectorAll("input")).toHaveLength(3);
    disposeOwner(owner);
  });
});
