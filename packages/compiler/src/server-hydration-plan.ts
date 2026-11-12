/**
 * H1: explicit data-bound hydration ABI. Build-only: never imported in the
 * browser. An element/slot ID is stable for a route and compiled structure.
 */
import { createHash } from "node:crypto";
import type { IRNode } from "./index.js";
import { renderLiteralAttribute, SSR_STATIC_TAGS } from "./server-static.js";

export interface HydrationElementV1 {
  readonly kind: "element";
  readonly id: string;
  readonly tag: string;
  /** Values are HTML-escaped strings emitted by the SSR encoder. */
  readonly attributes: readonly (readonly [name: string, encodedValue: string])[];
  readonly children: readonly HydrationNodeV1[];
}
export interface HydrationLiteralV1 {
  readonly kind: "text";
  readonly value: string;
}
export interface HydrationSlotV1 {
  readonly kind: "slot";
  readonly id: string;
  readonly path: readonly string[];
}
export type HydrationNodeV1 = HydrationElementV1 | HydrationLiteralV1 | HydrationSlotV1;
export interface DataHydrationPlanV1 {
  readonly schema: "zaakiy.data-hydration/1";
  readonly routeId: string;
  readonly markerId: string;
  readonly templateDigest: string;
  readonly root: HydrationElementV1;
}
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const PATH = /^props(?:\.[A-Za-z_$][\w$]*){1,4}$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
/** Fixed, 32-hex ID for one scoped bound text slot. */
export function hydrationSlotId(routeId: string, ordinal: number): string {
  return digest("zaakiy-hydrate-slot:" + routeId + ":" + ordinal).slice(0, 32);
}
export function buildDataHydrationPlan(root: IRNode, routeId: string): DataHydrationPlanV1 {
  if (root.kind !== "StaticElement" || !/^[A-Za-z0-9][\w.-]{0,199}$/.test(routeId)) {
    throw new TypeError("Hydration needs one native root and an approved route");
  }
  let elementCount = 0;
  let slotCount = 0;
  const visit = (node: IRNode, depth: number): HydrationNodeV1 | undefined => {
    if (depth > 64 || elementCount + slotCount > 4096)
      throw new RangeError("Hydration plan exceeds structural budget");
    switch (node.kind) {
      case "StyleToken":
        return undefined;
      case "StaticText":
        return node.text ? { kind: "text", value: node.text } : undefined;
      case "DynamicText": {
        const source = node.expression.source.trim();
        if (node.expression.reactive || !PATH.test(source)) {
          throw new TypeError("Hydration slots must be approved nonreactive props paths");
        }
        const path = source.split(".").slice(1);
        if (path.some(item => FORBIDDEN.has(item))) {
          throw new TypeError("Hydration slot path is forbidden");
        }
        return { kind: "slot", id: hydrationSlotId(routeId, slotCount++), path };
      }
      case "StaticElement": {
        if (node.namespace !== "html" || !SSR_STATIC_TAGS.has(node.tag) ||
            // These tags can be reparented/normalized by HTML tree construction.
            ["table", "tbody", "thead", "tfoot", "tr", "td", "th", "select", "option", "optgroup", "template"].includes(node.tag)) {
          throw new TypeError("Hydration does not support HTML parser-reparented elements");
        }
        const id = digest("zaakiy-hydrate-element:" + routeId + ":" + elementCount++).slice(0, 32);
        const attributes: Array<readonly [string, string]> = [];
        const children: HydrationNodeV1[] = [];
        const names = new Set<string>();
        for (const child of node.children) {
          if (child.kind === "PropertyBinding") {
            const raw = renderLiteralAttribute(child);
            if (!raw) continue;
            const parts = /^ ([a-z][a-z0-9:_-]*)="([^"]*)"$/.exec(raw);
            if (!parts || names.has(parts[1]!))
              throw new TypeError("Hydration needs unique, literal HTML attributes");
            names.add(parts[1]!);
            attributes.push([parts[1]!, parts[2]!]);
          } else {
            const next = visit(child, depth + 1);
            if (next) children.push(next);
          }
        }
        return { kind: "element", id, tag: node.tag, attributes, children };
      }
      default:
        throw new TypeError("Hydration v1 rejects executable JSX, components and dynamic regions");
    }
  };
  const tree = visit(root, 0);
  if (!tree || tree.kind !== "element")
    throw new TypeError("Hydration plan needs a single native element root");
  const templateDigest = digest(JSON.stringify(tree));
  const markerId = digest("zaakiy-hydrate-root:" + routeId + ":" + templateDigest).slice(0, 32);
  return { schema: "zaakiy.data-hydration/1", routeId, markerId, templateDigest, root: tree };
}
