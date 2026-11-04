// @vitest-environment jsdom
/** Regression coverage for the merged Signals/Core/DOM public contracts. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContext, createOwner, disposeOwner, initializeOwnedComponent,
  mountOwner, onCleanup, onMount, ownEffect, provide, requireContext,
  runWithOwner
} from "@zaakiyjs/core";
import { effect, flushSync, signal } from "@zaakiyjs/signals";
import { mount } from "@zaakiyjs/dom";
import { bindRef, bindText, listen } from "@zaakiyjs/dom/compiler";

afterEach(() => { document.body.replaceChildren(); });

describe("independent packages, real cross-runtime behavior", () => {
  it("disposes real signal effects and removes inbound observer registrations", () => {
    const root = createOwner();
    const count = signal(0);
    const observed: number[] = [];
    const handle = runWithOwner(root, () => ownEffect(
      () => effect(() => { observed.push(count.value); })
    ));
    const inbound = count as unknown as { observers: ReadonlySet<unknown> };
    expect(inbound.observers.size).toBe(1);
    count.value = 1;
    flushSync();
    expect(observed).toEqual([0, 1]);
    disposeOwner(root);
    handle.dispose();
    expect(inbound.observers.size).toBe(0);
    count.value = 2;
    flushSync();
    expect(observed).toEqual([0, 1]);
  });

  it("mounts nested owners once while preserving the DOM node and tearing down listeners", () => {
    const Repository = createContext<{ name(): string }>("Repository");
    const log: string[] = [];
    const container = document.createElement("main");
    document.body.appendChild(container);
    const clicked = signal(0);
    const userHandler = vi.fn();
    const root = mount((owner) => {
      provide(owner, Repository, { name: () => "Repo" });
      const feature = createOwner(owner);
      const node = initializeOwnedComponent(feature, () => {
        const name = requireContext(feature, Repository).name();
        const button = document.createElement("button");
        const label = document.createTextNode("");
        button.appendChild(label);
        bindText(feature, label, () => name + ":" + clicked.value);
        listen(feature, button, "click", () => { userHandler(); clicked.value++; });
        onMount(() => { log.push("child mount"); });
        onCleanup(() => { log.push("child cleanup"); });
        return button;
      });
      onMount(() => { mountOwner(feature); log.push("parent mount"); });
      onCleanup(() => { log.push("parent cleanup"); });
      return node;
    }, container);
    expect(log).toEqual(["child mount", "parent mount"]);
    const node = container.querySelector("button")!;
    node.click();
    flushSync();
    expect(container.querySelector("button")).toBe(node);
    expect(node.textContent).toBe("Repo:1");
    expect(userHandler).toHaveBeenCalledOnce();
    root.dispose();
    root.dispose();
    node.click();
    clicked.value++;
    flushSync();
    expect(userHandler).toHaveBeenCalledOnce();
    expect(node.textContent).toBe("Repo:1");
    expect(container.querySelector("button")).toBeNull();
    expect(log).toEqual([
      "child mount", "parent mount", "child cleanup", "parent cleanup"
    ]);
  });

  it("runs nullable refs once on initial binding and once during disposal", () => {
    const owner = createOwner();
    const ref = vi.fn<(node: HTMLInputElement | null) => void>();
    const input = document.createElement("input");
    bindRef(owner, input, ref);
    expect(ref).toHaveBeenCalledWith(input);
    disposeOwner(owner);
    expect(ref).toHaveBeenLastCalledWith(null);
    expect(ref).toHaveBeenCalledTimes(2);
  });

  it("keeps request/application provider roots independent during concurrent setup", () => {
    const identity = createContext<{ userId: string }>("RequestIdentity");
    const a = createOwner();
    const b = createOwner();
    provide(a, identity, { userId: "A" });
    provide(b, identity, { userId: "B" });
    const resultA = runWithOwner(a, () => requireContext(a, identity).userId);
    const resultB = runWithOwner(b, () => requireContext(b, identity).userId);
    expect([resultA, resultB]).toEqual(["A", "B"]);
    disposeOwner(a);
    expect(requireContext(b, identity).userId).toBe("B");
    disposeOwner(b);
  });
});
