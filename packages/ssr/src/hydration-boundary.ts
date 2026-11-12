/**
 * H5 opt-in bounded SSR boundary adoption and local recovery primitive.
 * Call only after application trust/manifest and route checks have succeeded.
 * Never parses HTML or replaces an ancestor of the verified boundary.
 */
import { createOwner, disposeOwner, initializeOwnedComponent, mountOwner } from "@zaakiyjs/core";
import type { OwnerScope } from "@zaakiyjs/core";

const HEX = /^[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const adopted = new WeakSet<Comment>();
export interface OwnedHydrationBoundary {
  readonly start: Comment;
  readonly end: Comment;
  readonly boundaryId: string;
  readonly templateDigest: string;
}
export interface OwnedBoundaryHydrationOptions {
  readonly boundary: OwnedHydrationBoundary;
  /** Optional lexical parent owner; child hydration disposes with its parent. */
  readonly parentOwner?: OwnerScope;
  /** Must validate the existing DOM against a trusted compiler blueprint. */
  readonly matches: (nodes: readonly Node[]) => boolean;
  /** Called only when mismatch recovery is explicitly allowed. */
  readonly recover?: () => Node | readonly Node[];
  /** Registers listeners/effects under the new boundary owner. */
  readonly attach: (owner: OwnerScope, nodes: readonly Node[]) => void;
  readonly signal?: AbortSignal;
}
export interface OwnedBoundaryHydrationHandle {
  readonly owner: OwnerScope;
  readonly recovered: boolean;
  dispose(): void;
}
function between(start: Comment, end: Comment): Node[] {
  const nodes: Node[] = [];
  let node = start.nextSibling;
  while (node && node !== end) {
    if (nodes.length >= 4096) throw new RangeError("Hydration boundary exceeds node budget");
    nodes.push(node);
    node = node.nextSibling;
  }
  if (node !== end) throw new TypeError("Unclosed hydration boundary");
  return nodes;
}
function validate(boundary: OwnedHydrationBoundary): void {
  if (!boundary || !HEX.test(boundary.boundaryId) ||
      !DIGEST.test(boundary.templateDigest) ||
      boundary.start?.nodeType !== 8 || boundary.end?.nodeType !== 8 ||
      !boundary.start.parentNode || boundary.start.parentNode !== boundary.end.parentNode ||
      boundary.start.nodeValue !== "zaakiy-r2:" + boundary.boundaryId + ":start" ||
      boundary.end.nodeValue !== "zaakiy-r2:" + boundary.boundaryId + ":end") {
    throw new TypeError("Invalid trusted hydration region boundary");
  }
}
function prepared(value: Node | readonly Node[], doc: Document, start: Node, end: Node): Node[] {
  const nodes: readonly Node[] = Array.isArray(value) ? value as readonly Node[] : [value as Node];
  if (nodes.length > 4096 || new Set(nodes).size !== nodes.length)
    throw new TypeError("Duplicate or oversized recovery nodes");
  for (const node of nodes) {
    if (!node || typeof node.nodeType !== "number" ||
        node.ownerDocument !== doc || node.parentNode ||
        node === start || node === end || node.nodeType === 9 ||
        node.nodeType === 10 || node.nodeType === 11)
      throw new TypeError("Recovery requires detached native nodes in same document");
  }
  return [...nodes];
}
export function hydrateOwnedBoundary(options: OwnedBoundaryHydrationOptions): OwnedBoundaryHydrationHandle {
  if (!options || typeof options.matches !== "function" ||
      typeof options.attach !== "function") throw new TypeError("Invalid hydration boundary callbacks");
  const { boundary, signal } = options;
  validate(boundary);
  if (adopted.has(boundary.start)) throw new Error("Hydration region already adopted");
  if (signal?.aborted) throw new Error("Hydration boundary navigation aborted");
  const old = between(boundary.start, boundary.end);
  const isMatch = options.matches(old);
  if (signal?.aborted) throw new Error("Hydration boundary navigation aborted");
  if (!isMatch && typeof options.recover !== "function")
    throw new TypeError("Hydration mismatch: owned region abort");
  const parent = boundary.start.parentNode!;
  const doc = boundary.start.ownerDocument;
  const replacements = isMatch ? [] : prepared(options.recover!(), doc, boundary.start, boundary.end);
  if (signal?.aborted) throw new Error("Hydration boundary navigation aborted");
  const owner = createOwner(options.parentOwner);
  let replaced = false;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", cleanup);
    try { disposeOwner(owner); } finally { adopted.delete(boundary.start); }
  };
  adopted.add(boundary.start);
  try {
    // Prepares owner bindings first. Factory failures cannot mutate SSR markup.
    initializeOwnedComponent(owner, () => options.attach(owner, isMatch ? old : replacements));
    if (!isMatch) {
      const fragment = doc.createDocumentFragment();
      for (const node of replacements) fragment.appendChild(node);
      parent.insertBefore(fragment, boundary.end);
      for (const node of old) parent.removeChild(node);
      replaced = true;
    }
    if (signal?.aborted) throw new Error("Hydration boundary navigation aborted");
    mountOwner(owner);
    signal?.addEventListener("abort", cleanup, { once: true });
    if (signal?.aborted) cleanup();
  } catch (error) {
    if (replaced) {
      for (const node of replacements) node.parentNode?.removeChild(node);
      for (const node of old) parent.insertBefore(node, boundary.end);
    }
    try { cleanup(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Hydration recovery and cleanup failed");
    }
    throw error;
  }
  return { owner, recovered: !isMatch, dispose: cleanup };
}
