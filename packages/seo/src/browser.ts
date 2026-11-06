import type { HeadTag, RenderedMetadata } from "./types.js";
import { serializeHeadTags } from "./metadata.js";

/** Separate browser entry: pure SEO imports never read document/window. */
export interface HeadManager {
  update(result: RenderedMetadata, options?: { readonly version?: number; readonly signal?: AbortSignal }): boolean;
  dispose(): void;
}
function matchElement(doc: Document, tag: HeadTag): Element | null {
  const candidates = [...doc.head.children];
  for (const element of candidates) {
    if (tag.kind === "title" && element.tagName.toLowerCase() === "title") return element;
    if (tag.kind === "meta" && element.tagName.toLowerCase() === "meta" &&
      (element.getAttribute("name") === tag.attributes.name ||
       element.getAttribute("property") === tag.attributes.property)) return element;
    if (tag.kind === "link" && element.tagName.toLowerCase() === "link" &&
      element.getAttribute("rel") === tag.attributes.rel &&
      (tag.attributes.rel !== "alternate" || element.getAttribute("hreflang") === tag.attributes.hreflang)) return element;
    if (tag.kind === "script" && element.tagName.toLowerCase() === "script" &&
      element.getAttribute("type") === "application/ld+json") return element;
  }
  return null;
}
export function createHeadManager(doc: Document, lifetime?: AbortSignal): HeadManager {
  let disposed = false;
  let version = -Infinity;
  const owned = new Map<string, Element>();
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const node of owned.values()) node.remove();
    owned.clear();
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
      if (nextVersion < version) return false;
      version = nextVersion;
      const next = new Map<string, Element>();
      for (const tag of result.tags) {
        const element = owned.get(tag.key) ?? matchElement(doc, tag) ??
          doc.createElement(tag.kind === "title" ? "title" : tag.kind);
        if (tag.kind === "title" || tag.kind === "script") element.textContent = tag.text;
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
      owned.clear();
      for (const [key, element] of next) owned.set(key, element);
      return true;
    },
    dispose
  };
}
