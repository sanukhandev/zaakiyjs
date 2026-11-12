// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { signal, flushSync } from "@zaakiyjs/signals";
import { compileDataServer } from "../../compiler/src/index.js";
import { buildVerifiedManifestV1 } from "../src/build.js";
import { hydrateDataPage } from "../src/client.js";
import type { DataHydrationPlanV1, HydrationEnvelopeV1 } from "../src/protocol.js";

const routeId = "counter";
const source = [
  "function Counter(props: { count: number }) {",
  'return <main class="counter"><button type="button">Count: {props.count}</button><input value="server"></input></main>;',
  "}"
].join("\n");
const request = {
  fileName: "packages/ssr/test/hydration-counter.tsx",
  routeId, source, hydratable: true
} as const;
const moduleFor = async (code: string): Promise<{
  protocol: string;
  hydrationPlan: DataHydrationPlanV1;
  render: (context: unknown) => { status: number; body: string | AsyncIterable<Uint8Array> };
}> => {
  const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return await import(/* @vite-ignore */ url) as {
    protocol: string;
    hydrationPlan: DataHydrationPlanV1;
    render: (context: unknown) => { status: number; body: string | AsyncIterable<Uint8Array> };
  };
};
const context = (count: number) => ({
  schema: "zaakiy.render/1", route: { id: routeId },
  request: { signal: new AbortController().signal },
  loaderData: { count }
});
const html = async (value: string | AsyncIterable<Uint8Array>): Promise<string> => {
  if (typeof value === "string") return value;
  let result = "";
  const decoder = new TextDecoder();
  for await (const chunk of value) result += decoder.decode(chunk, { stream: true });
  return result + decoder.decode();
};
afterEach(() => document.body.replaceChildren());

describe("H0–H3 compiler-backed native DOM adoption", () => {
  it("adopts matching server nodes without replacing them and owns signals/events/cleanup", async () => {
    const compiled = compileDataServer(request);
    expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(compiled.hydrationPlan).toBeDefined();
    const bytes = new TextEncoder().encode(compiled.js[0]!.code);
    const server = await moduleFor(compiled.js[0]!.code);
    expect(server.hydrationPlan).toEqual(compiled.hydrationPlan);
    const manifest = buildVerifiedManifestV1([
      { routeId, moduleId: "generated/counter", bytes }
    ]);
    const envelope: HydrationEnvelopeV1 = {
      schema: "zaakiy.hydration/1", buildId: manifest.buildId,
      routeId, domAbiVersion: 1, payload: {},
      boundaries: [{
        markerId: server.hydrationPlan.markerId,
        templateDigest: server.hydrationPlan.templateDigest
      }]
    };
    const initial = server.render(context(0));
    const container = document.createElement("div");
    container.innerHTML = await html(initial.body);
    document.body.append(container);
    const initialHTML = container.innerHTML;
    const button = container.querySelector("button")!;
    const input = container.querySelector("input")!;
    const originalText = [...button.childNodes].find(x => x.nodeType === 3 && x.nodeValue === "0")!;
    input.focus();
    input.value = "user draft";
    const count = signal(0);
    const event = vi.fn(() => { count.value++; });
    const root = server.hydrationPlan.root;
    const buttonPlan = root.children.find(x => x.kind === "element" && x.tag === "button");
    expect(buttonPlan?.kind).toBe("element");
    if (!buttonPlan || buttonPlan.kind !== "element") throw Error("Missing button");
    const observer = new MutationObserver(() => undefined);
    observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
    const handle = hydrateDataPage(container, server.hydrationPlan, envelope, manifest, routeId, {
      read: path => path.join(".") === "count" ? count.value : null,
      events: [{ elementId: buttonPlan.id, name: "click", handler: event }]
    });
    expect(observer.takeRecords()).toHaveLength(0);
    expect(container.innerHTML).toBe(initialHTML);
    expect(container.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("user draft");
    expect(() => hydrateDataPage(container, server.hydrationPlan, envelope, manifest, routeId,
      { read: () => 0 })).toThrow(/already has a hydration owner/);

    button.click();
    flushSync();
    expect(event).toHaveBeenCalledOnce();
    expect(button.textContent).toBe("Count: 1");
    expect([...button.childNodes].some(node => node === originalText)).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector("button")).toBe(button);
    handle.dispose();
    handle.dispose();
    button.click();
    expect(event).toHaveBeenCalledOnce();
    count.value = 7;
    flushSync();
    expect(button.textContent).toBe("Count: 1");
    expect(container.querySelector("button")).toBe(button);
    observer.disconnect();
  });

  it("fails closed on marker, markup, route, data or event mismatch without altering DOM", async () => {
    const compiled = compileDataServer(request);
    const server = await moduleFor(compiled.js[0]!.code);
    const manifest = buildVerifiedManifestV1([{
      routeId, moduleId: "generated/counter", bytes: new TextEncoder().encode(compiled.js[0]!.code)
    }]);
    const envelope: HydrationEnvelopeV1 = {
      schema: "zaakiy.hydration/1", domAbiVersion: 1, routeId,
      buildId: manifest.buildId, payload: null,
      boundaries: [{
        markerId: server.hydrationPlan.markerId,
        templateDigest: server.hydrationPlan.templateDigest
      }]
    };
    const create = async () => {
      const root = document.createElement("section");
      root.innerHTML = await html(server.render(context(0)).body);
      return root;
    };
    const bindings = { read: (_path: readonly string[]) => 0 };
    const wrongData = await create();
    const original = wrongData.innerHTML;
    expect(() => hydrateDataPage(wrongData, server.hydrationPlan, envelope, manifest,
      routeId, { read: () => 1 })).toThrow(/server\/client data text differs/);
    expect(wrongData.innerHTML).toBe(original);
    const wrongMarker = await create();
    wrongMarker.childNodes[0]!.nodeValue = "zaakiy-h:incorrect";
    const markerBefore = wrongMarker.innerHTML;
    expect(() => hydrateDataPage(wrongMarker, server.hydrationPlan, envelope, manifest,
      routeId, bindings)).toThrow(/incompatible SSR build/);
    expect(wrongMarker.innerHTML).toBe(markerBefore);
    const extraAttribute = await create();
    extraAttribute.querySelector("button")!.setAttribute("onclick", "window.evil()");
    const before = extraAttribute.innerHTML;
    expect(() => hydrateDataPage(extraAttribute, server.hydrationPlan, envelope, manifest,
      routeId, bindings)).toThrow(/unexpected native attributes/);
    expect(extraAttribute.innerHTML).toBe(before);
    const unknownEvent = await create();
    expect(() => hydrateDataPage(unknownEvent, server.hydrationPlan, envelope, manifest,
      routeId, { ...bindings,
        events: [{ elementId: "f".repeat(32), name: "click", handler: () => undefined }]
      })).toThrow(/invalid\/duplicate event/);
    const badRoute = await create();
    expect(() => hydrateDataPage(badRoute, server.hydrationPlan, envelope, manifest,
      "other", bindings)).toThrow(/invalid plan/);
  });

  it("preserves opt-out output and works with streamed generated SSR", async () => {
    const standard = compileDataServer({ fileName: request.fileName, routeId, source });
    const explicitOff = compileDataServer({ ...request, hydratable: false });
    expect(standard.js).toEqual(explicitOff.js);
    expect(standard.hydrationPlan).toBeUndefined();
    const output = compileDataServer({ ...request, streaming: true });
    expect(output.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const server = await moduleFor(output.js[0]!.code);
    const markup = await html(server.render(context(10)).body);
    expect(markup).toContain("zaakiy-h:" + server.hydrationPlan.markerId);
    expect(markup).toContain("zaakiy-t:");
    const container = document.createElement("div");
    container.innerHTML = markup;
    const manifest = buildVerifiedManifestV1([{
      routeId, moduleId: "generated/counter", bytes: new TextEncoder().encode(output.js[0]!.code)
    }]);
    const envelope: HydrationEnvelopeV1 = {
      schema: "zaakiy.hydration/1", routeId, buildId: manifest.buildId,
      domAbiVersion: 1, payload: null,
      boundaries: [{
        markerId: server.hydrationPlan.markerId,
        templateDigest: server.hydrationPlan.templateDigest
      }]
    };
    const state = signal(10);
    const handle = hydrateDataPage(container, server.hydrationPlan, envelope, manifest,
      routeId, { read: () => state.value });
    const button = container.querySelector("button")!;
    state.value = 11;
    flushSync();
    expect(button.textContent).toBe("Count: 11");
    handle.dispose();
  });
});
