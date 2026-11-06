import type { RenderedMetadata } from "./types.js";
import { serializeHeadTags } from "./metadata.js";
import { serializeJsonLd } from "./structured.js";

/** Separate browser entry: pure SEO imports never read document/window. */
export interface HeadManager {
  update(result: RenderedMetadata, options?: { readonly version?: number; readonly signal?: AbortSignal }): boolean;
  dispose(): void;
}
/** Adopt only SEO-relevant SSR nodes; preserve viewport, charset, styles, etc. */
function existingSeoKey(element: Element): string | undefined {
  const tag = element.tagName.toLowerCase();
  if (tag === "title") return "title";
  if (tag === "meta") {
    const name = element.getAttribute("name");
    if (name && (["description", "robots", "author", "publisher"].includes(name) ||
      name.startsWith("twitter:"))) return name;
    const property = element.getAttribute("property");
    if (property?.startsWith("og:")) return property;
  }
  if (tag === "link") {
    const rel = element.getAttribute("rel");
    if (rel === "canonical") return "canonical";
    if (rel === "alternate" && element.hasAttribute("hreflang")) {
      return "hreflang:" + element.getAttribute("hreflang");
    }
  }
  if (tag === "script" && element.getAttribute("type") === "application/ld+json") return "jsonld";
  return undefined;
}

export function createHeadManager(doc: Document, lifetime?: AbortSignal): HeadManager {
  let disposed = false;
  let version = -1;
  const owned = new Map<string, Element>();
  const duplicates = new Set<Element>();
  let adopted = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const node of owned.values()) node.remove();
    for (const node of duplicates) node.remove();
    owned.clear();
    duplicates.clear();
    lifetime?.removeEventListener("abort", dispose);
  };
  if (lifetime?.aborted) dispose();
  else lifetime?.addEventListener("abort", dispose, { once: true });
  return {
    update(result, options = {}) {
      if (disposed || lifetime?.aborted || options.signal?.aborted) return false;
      // Validate all tag names, attributes, links and JSON-LD before any DOM mutation.
      serializeHeadTags(result.tags);
      const nextVersion = options.version ?? version + 1;
      if (!Number.isSafeInteger(nextVersion) || nextVersion < 0)
        throw new RangeError("SEO head navigation version must be a nonnegative safe integer");
      if (nextVersion <= version) return false;
      version = nextVersion;
      // Reconcile the complete server-rendered SEO head on first navigation.
      // Otherwise metadata omitted by the new route would remain indexed.
      if (!adopted) {
        adopted = true;
        for (const node of [...doc.head.children]) {
          const key = existingSeoKey(node);
          if (key === undefined) continue;
          if (owned.has(key)) duplicates.add(node);
          else owned.set(key, node);
        }
      }
      const next = new Map<string, Element>();
      for (const tag of result.tags) {
        const element = owned.get(tag.key) ?? doc.createElement(tag.kind === "title" ? "title" : tag.kind);
        if (tag.kind === "title") element.textContent = tag.text;
        if (tag.kind === "script") {
          const value = JSON.parse(tag.text) as import("./types.js").StructuredDataInput;
          element.textContent = serializeJsonLd(value);
        }
        if (tag.kind !== "title") {
          for (const attribute of [...element.attributes]) {
            if (attribute.name !== "data-zaakiy-seo" && !(attribute.name in tag.attributes))
              element.removeAttribute(attribute.name);
          }
          for (const [key, value] of Object.entries(tag.attributes)) element.setAttribute(key, value);
        }
        element.setAttribute("data-zaakiy-seo", tag.key);
        if (!element.parentNode) doc.head.appendChild(element);
        next.set(tag.key, element);
      }
      for (const [key, element] of owned) if (!next.has(key)) element.remove();
      for (const node of duplicates) node.remove();
      duplicates.clear();
      owned.clear();
      for (const [key, element] of next) owned.set(key, element);
      return true;
    },
    dispose
  };
}
