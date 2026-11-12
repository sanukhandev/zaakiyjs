/**
 * H2/H3: fail-closed, existing-node adoption for the restricted data-bound SSR
 * compiler. No HTML parsing, dynamic imports, virtual DOM or user code eval.
 */
import { bindText, listen } from "@zaakiyjs/dom/compiler";
import { hydrate } from "@zaakiyjs/dom";
import type { HydrationMountHandle } from "@zaakiyjs/dom";
import { inspectHydration } from "./client.js";
import type {
  DataHydrationNodeV1, DataHydrationPlanV1,
  HydrationEnvelopeV1, TrustedServerBuildManifestV1
} from "./protocol.js";

export interface HydrationEventV1 {
  /** Compiler-generated stable element ID, never an arbitrary CSS selector. */
  readonly elementId: string;
  readonly name: string;
  readonly handler: EventListener;
  readonly options?: AddEventListenerOptions;
}
export interface DataHydrationBindings {
  /** Trusted client-side state read; must match SSR data at the adoption boundary. */
  readonly read: (path: readonly string[]) => unknown;
  /** Explicit client handlers. TSX onClick lowering is not supported by data SSR. */
  readonly events?: readonly HydrationEventV1[];
}
export type DataHydrationHandle = HydrationMountHandle;

const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const TAG = /^[a-z][a-z0-9-]*$/;
const ATTR = /^[a-z][a-z0-9:_-]*$/;
const EVENT = /^[a-z][a-z0-9:_-]*$/;
const FIELD = /^[a-zA-Z_$][\w$]*$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NODES = 4096;

function asText(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
    throw new TypeError("Hydration values must be primitive");
  const text = String(value);
  if (text.length > 65536) throw new RangeError("Hydration value exceeds server text limit");
  return text;
}
function encodeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fail(message: string): never { throw new TypeError("Hydration mismatch: " + message); }
interface Slot {
  readonly parent: Node;
  readonly end: Comment;
  readonly text: Text | null;
  readonly path: readonly string[];
}
interface Inspection {
  readonly elements: Map<string, Element>;
  readonly slots: readonly Slot[];
}
function inspectExisting(container: Element, plan: DataHydrationPlanV1,
  read: DataHydrationBindings["read"]): Inspection {
  if (!Array.isArray(container.childNodes) && typeof container.childNodes?.length !== "number")
    fail("invalid container");
  if (container.childNodes.length !== 2) fail("unexpected route siblings");
  const marker = container.childNodes[0];
  const root = container.childNodes[1];
  if (!marker || marker.nodeType !== 8 ||
      marker.nodeValue !== "zaakiy-h:" + plan.markerId + ":" + plan.templateDigest)
    fail("root marker differs");
  if (!root || root.nodeType !== 1) fail("missing native root element");
  const elements = new Map<string, Element>();
  const slots: Slot[] = [];
  const usedIds = new Set<string>();
  let budget = 0;
  const check = (node: Node, spec: DataHydrationNodeV1, depth: number): void => {
    if (++budget > MAX_NODES || depth > 64 || !spec ||
        typeof spec !== "object") fail("plan budget or malformed node");
    if (spec.kind === "text") {
      if (typeof spec.value !== "string" || node.nodeType !== 3 ||
          node.nodeValue !== spec.value) fail("static text differs");
      return;
    }
    if (spec.kind !== "element" || node.nodeType !== 1 ||
        !ID.test(spec.id) || usedIds.has(spec.id) || !TAG.test(spec.tag) ||
        !Array.isArray(spec.children) || !Array.isArray(spec.attributes))
      fail("element identity or structure differs");
    const el = node as Element;
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml" || el.localName !== spec.tag)
      fail("native tag/namespace differs");
    usedIds.add(spec.id);
    elements.set(spec.id, el);
    const expectedAttributes = new Set<string>();
    for (const attr of spec.attributes) {
      if (!Array.isArray(attr) || attr.length !== 2 ||
          typeof attr[0] !== "string" || !ATTR.test(attr[0]) ||
          typeof attr[1] !== "string" || expectedAttributes.has(attr[0])) {
        fail("invalid compiled attribute");
      }
      expectedAttributes.add(attr[0]);
      const actual = el.getAttribute(attr[0]);
      if (actual === null || encodeAttribute(actual) !== attr[1])
        fail("static attribute differs");
    }
    if (el.attributes.length !== expectedAttributes.size)
      fail("unexpected native attributes");
    let cursor = 0;
    for (const child of spec.children) {
      if (child?.kind === "slot") {
        if (++budget > MAX_NODES || !ID.test(child.id) ||
            usedIds.has(child.id) || !Array.isArray(child.path) ||
            child.path.length < 1 || child.path.length > 4 ||
            child.path.some(p => typeof p !== "string" || !FIELD.test(p) || FORBIDDEN.has(p)))
          fail("invalid data slot");
        usedIds.add(child.id);
        const start = el.childNodes[cursor++];
        if (!start || start.nodeType !== 8 ||
            start.nodeValue !== "zaakiy-t:" + child.id + ":start")
          fail("data slot start marker differs");
        const expected = asText(read(child.path));
        let middle: Text | null = null;
        if (el.childNodes[cursor]?.nodeType === 3) {
          middle = el.childNodes[cursor++] as Text;
          if (middle.data !== expected) fail("server/client data text differs");
        } else if (expected) fail("server text node missing");
        const end = el.childNodes[cursor++];
        if (!end || end.nodeType !== 8 ||
            end.nodeValue !== "zaakiy-t:" + child.id + ":end")
          fail("data slot end marker differs");
        slots.push({ parent: el, end: end as Comment, text: middle, path: child.path });
      } else {
        const actual = el.childNodes[cursor++];
        if (!actual) fail("missing static child");
        check(actual, child, depth + 1);
      }
    }
    if (cursor !== el.childNodes.length) fail("unexpected native children");
  };
  check(root, plan.root, 0);
  return { elements, slots };
}

/**
 * Adopt the already-rendered DOM. Every structural, template and state check
 * completes before listeners/effects are installed. Matching nonempty slots
 * retain their original Text nodes. Empty slots acquire an empty Text node,
 * which is needed for future reactive updates.
 *
 * Unlike generic React hydration this only supports restricted data SSR.
 * It deliberately refuses keyed regions, components and executable server JSX.
 */
export function hydrateDataPage(
  container: Element,
  plan: DataHydrationPlanV1,
  envelope: HydrationEnvelopeV1,
  manifest: TrustedServerBuildManifestV1,
  routeId: string,
  bindings: DataHydrationBindings
): DataHydrationHandle {
  if (!container || container.nodeType !== 1 || !plan ||
      plan.schema !== "zaakiy.data-hydration/1" || plan.routeId !== routeId ||
      !ID.test(plan.markerId) || !HASH.test(plan.templateDigest) ||
      !bindings || typeof bindings.read !== "function" ||
      !Array.isArray(envelope?.boundaries) || envelope.boundaries.length !== 1 ||
      envelope.boundaries[0]?.markerId !== plan.markerId ||
      envelope.boundaries[0]?.templateDigest !== plan.templateDigest) {
    fail("invalid plan or hydration envelope");
  }
  const probe = inspectHydration(container, envelope, manifest, routeId);
  if (!probe.compatible) fail("incompatible SSR build: " + probe.reason);
  const result = inspectExisting(container, plan, bindings.read);
  const events = bindings.events ?? [];
  if (!Array.isArray(events) || events.length > 4096)
    fail("invalid event registration count");
  const registered = new Set<string>();
  for (const event of events) {
    if (!event || !ID.test(event.elementId) || !result.elements.has(event.elementId) ||
        !EVENT.test(event.name) || typeof event.handler !== "function" ||
        registered.has(event.elementId + ":" + event.name))
      fail("invalid/duplicate event registration");
    registered.add(event.elementId + ":" + event.name);
  }
  const inserted: Text[] = [];
  try {
    return hydrate(container.childNodes[1]!, (owner) => {
      for (const slot of result.slots) {
        let target = slot.text;
        if (!target) {
          const doc = slot.end.ownerDocument;
          target = doc.createTextNode("");
          slot.parent.insertBefore(target, slot.end);
          inserted.push(target);
        }
        bindText(owner, target, () => bindings.read(slot.path));
      }
      for (const event of events) {
        listen(owner, result.elements.get(event.elementId)!, event.name,
          event.handler, event.options);
      }
    });
  } catch (error) {
    for (const node of inserted) node.parentNode?.removeChild(node);
    throw error;
  }
}
