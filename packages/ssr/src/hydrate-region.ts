/**
 * H4 opt-in browser adoption of compiler-emitted region SSR v2.
 * Fail-closed matching preflight precedes every owner/listener/effect.
 * This is a restricted data-bound region target, not general TSX execution.
 */
import { bindText, listen } from "@zaakiyjs/dom/compiler";
import { hydrate } from "@zaakiyjs/dom";
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import { inspectHydration } from "./client.js";
import type { HydrationEnvelopeV1, TrustedServerBuildManifestV1 } from "./protocol.js";

export type RegionNodeV2 =
  | { readonly kind: "element"; readonly id: string; readonly tag: string; readonly attrs: readonly string[]; readonly children: readonly RegionNodeV2[] }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "data"; readonly id: string; readonly source: "props" | "item"; readonly path: readonly string[] }
  | { readonly kind: "conditional"; readonly id: string; readonly path: readonly string[]; readonly yes: readonly RegionNodeV2[]; readonly no: readonly RegionNodeV2[] }
  | { readonly kind: "keyed"; readonly id: string; readonly path: readonly string[]; readonly itemName: string; readonly key: string; readonly rows: readonly RegionNodeV2[] };
export interface RegionHydrationPlanV2 {
  readonly schema: "zaakiy.region-hydration/2";
  readonly routeId: string;
  readonly markerId: string;
  readonly templateDigest: string;
  readonly nodes: readonly RegionNodeV2[];
}
export interface RegionHydrationEventV2 {
  readonly elementId: string;
  readonly name: string;
  readonly handler: EventListener;
  readonly options?: AddEventListenerOptions;
}
export interface RegionHydrationBindingsV2 {
  readonly read: (path: readonly string[]) => unknown;
  readonly events?: readonly RegionHydrationEventV2[];
  readonly signal?: AbortSignal;
}
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const SAFE_KEY = /^[A-Za-z0-9_.:]{1,64}$/;
const ATTR = /^ ([a-z][a-z0-9:_-]*)="([^"]*)"$/;
const EVENT = /^[a-z][a-z0-9:_-]*$/;
const DENIED = new Set(["__proto__", "constructor", "prototype"]);
const MAX = 8192;
function mismatch(reason: string): never { throw new TypeError("Region hydration mismatch: " + reason); }
function dataText(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
    return mismatch("nonprimitive data text");
  const text = String(value);
  if (text.length > 65536) return mismatch("data text budget");
  return text;
}
function own(item: unknown, path: readonly string[]): unknown {
  let current: unknown = item;
  for (const key of path) {
    if (!NAME.test(key) || DENIED.has(key)) mismatch("unsafe keyed path");
    if (typeof current !== "object" || !current || Array.isArray(current)) return null;
    const proto = Object.getPrototypeOf(current);
    if (proto !== Object.prototype && proto !== null) mismatch("keyed data is not plain");
    const field = Object.getOwnPropertyDescriptor(current, key);
    if (!field) return null;
    if (!Object.hasOwn(field, "value")) mismatch("keyed getter forbidden");
    current = field.value;
  }
  return current;
}
function encode(value: string): string {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
type TextBinding = { readonly text: Text | null; readonly end: Comment; readonly path: readonly string[];
  readonly source: "props" | "item"; readonly item: unknown };
interface Discovery {
  readonly elements: Map<string, Element>;
  readonly slots: TextBinding[];
}
function discover(container: Element, plan: RegionHydrationPlanV2, read: RegionHydrationBindingsV2["read"]): Discovery {
  if (container.childNodes.length !== 2 || container.childNodes[0]?.nodeType !== 8 ||
      container.childNodes[0]?.nodeValue !== "zaakiy-h:" + plan.markerId + ":" + plan.templateDigest)
    mismatch("route root marker");
  const root = container.childNodes[1];
  if (!root || root.nodeType !== 1) mismatch("native root");
  const elements = new Map<string, Element>();
  const slots: TextBinding[] = [];
  let count = 0;
  const cursorFor = (parent: Node, begin: Node | null, end: Node | null,
    specs: readonly RegionNodeV2[], item: unknown, depth: number, scope = ""): Node | null => {
    if (depth > 64 || !Array.isArray(specs)) mismatch("region plan bounds");
    let cursor = begin;
    for (const spec of specs) {
      if (++count > MAX || !spec || typeof spec !== "object") mismatch("region budget");
      switch (spec.kind) {
        case "element": {
          if (!ID.test(spec.id) || elements.has(scope ? spec.id + ":" + scope : spec.id) ||
              !cursor || cursor === end || cursor.nodeType !== 1 ||
              !Array.isArray(spec.children) || !Array.isArray(spec.attrs))
            mismatch("element id/tree");
          const element = cursor as Element;
          if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || element.localName !== spec.tag)
            mismatch("native tag");
          const names = new Set<string>();
          for (const raw of spec.attrs) {
            const parsed = ATTR.exec(raw);
            if (!parsed || names.has(parsed[1]!)) mismatch("compiled attribute format");
            names.add(parsed[1]!);
            if (element.getAttribute(parsed[1]!) === null ||
                encode(element.getAttribute(parsed[1]!)!) !== parsed[2]) mismatch("static attribute");
          }
          if (element.attributes.length !== names.size) mismatch("unexpected attribute");
          elements.set(scope ? spec.id + ":" + scope : spec.id, element);
          const remainder = cursorFor(element, element.firstChild, null, spec.children, item, depth+1,scope);
          if (remainder !== null) mismatch("unexpected element children");
          cursor = element.nextSibling;
          break;
        }
        case "literal":
          if (!cursor || cursor === end || cursor.nodeType !== 3 ||
              cursor.nodeValue !== spec.value) mismatch("static text");
          cursor = cursor.nextSibling;
          break;
        case "data": {
          if (!ID.test(spec.id) || !Array.isArray(spec.path) ||
              !["props","item"].includes(spec.source)) mismatch("slot definition");
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-d2:" + spec.id + ":start") mismatch("slot start");
          cursor = cursor.nextSibling;
          const value = dataText(spec.source === "item" ? own(item, spec.path) : read(spec.path));
          let text: Text | null = null;
          if (cursor && cursor !== end && cursor.nodeType === 3) {
            text = cursor as Text;
            if (text.data !== value) mismatch("slot initial value");
            cursor = cursor.nextSibling;
          } else if (value) mismatch("missing data text");
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-d2:" + spec.id + ":end") mismatch("slot end");
          slots.push({text, end: cursor as Comment, path: spec.path, source: spec.source, item});
          cursor = cursor.nextSibling;
          break;
        }
        case "conditional": {
          if (!ID.test(spec.id) || !cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":start")
            mismatch("conditional start");
          const selected = read(spec.path) ? spec.yes : spec.no;
          cursor = cursorFor(parent,cursor.nextSibling,end,selected,item,depth+1,scope);
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":end") mismatch("conditional end");
          cursor = cursor.nextSibling;
          break;
        }
        case "keyed": {
          if (!ID.test(spec.id) || !cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":start") mismatch("keyed region start");
          const rows = read(spec.path);
          if (!Array.isArray(rows) || rows.length > 4096) mismatch("keyed rows");
          cursor = cursor.nextSibling;
          const seen = new Set<string>();
          for (const row of rows) {
            const value = own(row, [spec.key]);
            if (typeof value !== "string" && typeof value !== "number") mismatch("key type");
            const key = String(value);
            if (!SAFE_KEY.test(key) || seen.has(key)) mismatch("duplicate/unsafe key");
            seen.add(key);
            if (!cursor || cursor === end || cursor.nodeType !== 8 ||
                cursor.nodeValue !== "zaakiy-k2:" + spec.id + ":" + key + ":start")
              mismatch("keyed item start");
            cursor = cursorFor(parent,cursor.nextSibling,end,spec.rows,row,depth+1,key);
            if (!cursor || cursor === end || cursor.nodeType !== 8 ||
                cursor.nodeValue !== "zaakiy-k2:" + spec.id + ":" + key + ":end")
              mismatch("keyed item end");
            cursor = cursor.nextSibling;
          }
          if (!cursor || cursor === end || cursor.nodeType !== 8 ||
              cursor.nodeValue !== "zaakiy-r2:" + spec.id + ":end") mismatch("keyed region end");
          cursor = cursor.nextSibling;
          break;
        }
        default: mismatch("unsupported compiler region");
      }
    }
    return cursor;
  };
  const extra = cursorFor(container, root, null, plan.nodes, null, 0);
  if (extra !== null) mismatch("unexpected route siblings");
  return { elements, slots };
}
/** Hydrate only an exact SSR region snapshot; no implicit client rerender. */
export function hydrateRegionPage(
  container: Element, plan: RegionHydrationPlanV2,
  envelope: HydrationEnvelopeV1, manifest: TrustedServerBuildManifestV1,
  routeId: string, bindings: RegionHydrationBindingsV2
): HydrationMountHandle {
  if (!container || container.nodeType !== 1 || !plan ||
      plan.schema !== "zaakiy.region-hydration/2" || plan.routeId !== routeId ||
      !ID.test(plan.markerId) || !HASH.test(plan.templateDigest) ||
      !Array.isArray(plan.nodes) || !bindings || typeof bindings.read !== "function" ||
      !Array.isArray(envelope?.boundaries) || envelope.boundaries.length !== 1 ||
      envelope.boundaries[0]?.markerId !== plan.markerId ||
      envelope.boundaries[0]?.templateDigest !== plan.templateDigest)
    mismatch("plan/envelope identity");
  if (bindings.signal?.aborted) mismatch("navigation aborted");
  if (!inspectHydration(container,envelope,manifest,routeId).compatible)
    mismatch("manifest/build/route identity");
  const found = discover(container,plan,bindings.read);
  const events = bindings.events ?? [];
  if (!Array.isArray(events) || events.length > 4096) mismatch("event budget");
  const seen = new Set<string>();
  for (const event of events) {
    if (!event || !/^([a-f0-9]{32})(:[A-Za-z0-9_.:]{1,64})?$/.test(event.elementId) || !found.elements.has(event.elementId) ||
        !EVENT.test(event.name) || typeof event.handler !== "function" ||
        seen.has(event.elementId + ":" + event.name)) mismatch("event target/duplicate");
    seen.add(event.elementId + ":" + event.name);
  }
  if (bindings.signal?.aborted) mismatch("navigation aborted");
  const inserted: Text[] = [];
  try {
    const handle = hydrate(container.childNodes[1]!, owner => {
      for (const slot of found.slots) {
        let target = slot.text;
        if (!target) {
          target = slot.end.ownerDocument.createTextNode("");
          slot.end.parentNode!.insertBefore(target,slot.end);
          inserted.push(target);
        }
        bindText(owner,target,() => slot.source === "item" ? own(slot.item,slot.path) : bindings.read(slot.path));
      }
      for (const event of events)
        listen(owner,found.elements.get(event.elementId)!,event.name,event.handler,event.options);
    });
    const signal = bindings.signal;
    if (!signal) return handle;
    let disposed = false;
    const close = () => {
      if (disposed) return;
      disposed = true;
      signal.removeEventListener("abort",close);
      handle.dispose();
    };
    signal.addEventListener("abort",close,{once:true});
    if (signal.aborted) close();
    return {root:handle.root,owner:handle.owner,dispose:close};
  } catch (error) {
    for (const node of inserted) node.parentNode?.removeChild(node);
    throw error;
  }
}
