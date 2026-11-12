// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hydrateOwnedBoundary } from "../src/hydration-boundary.js";
import { onCleanup } from "@zaakiyjs/core";

const boundaryId = "a".repeat(32);
const templateDigest = "b".repeat(64);
function fixture() {
  const parent = document.createElement("section");
  const outside = document.createElement("input");
  outside.value = "draft";
  parent.append(outside);
  const start = document.createComment("zaakiy-r2:" + boundaryId + ":start");
  const end = document.createComment("zaakiy-r2:" + boundaryId + ":end");
  const existing = document.createElement("button");
  existing.textContent = "old";
  parent.append(start, existing, end);
  const boundary = { start, end, boundaryId, templateDigest };
  return { parent, outside, existing, boundary };
}
describe("H5 owner-scoped hydration boundaries", () => {
  it("adopts a matching node with zero mutations, single ownership, and cleanup", () => {
    const { parent, outside, existing, boundary } = fixture();
    let cleanupCount = 0;
    let events = 0;
    const html = parent.innerHTML;
    const handle = hydrateOwnedBoundary({
      boundary, matches: nodes => nodes.length === 1 && nodes[0] === existing,
      attach: (_owner, nodes) => {
        const callback = () => { events++; };
        nodes[0]!.addEventListener("click", callback);
        onCleanup(() => { nodes[0]!.removeEventListener("click", callback); cleanupCount++; });
      }
    });
    expect(handle.recovered).toBe(false);
    expect(parent.innerHTML).toBe(html);
    expect(parent.firstChild).toBe(outside);
    existing.click();
    expect(events).toBe(1);
    expect(() => hydrateOwnedBoundary({ boundary, matches: () => true, attach: () => {} })).toThrow();
    handle.dispose();
    handle.dispose();
    existing.click();
    expect(events).toBe(1);
    expect(cleanupCount).toBe(1);
  });
  it("aborts on mismatch without changing siblings or ownership", () => {
    const { parent, boundary } = fixture();
    const html = parent.innerHTML;
    expect(() => hydrateOwnedBoundary({ boundary, matches: () => false,
      attach: () => { throw new Error("must not run"); } })).toThrow(/mismatch/);
    expect(parent.innerHTML).toBe(html);
  });
  it("recovers only owned region, preserving untouched sibling and active input", () => {
    const { parent, outside, existing, boundary } = fixture();
    parent.ownerDocument.body.appendChild(parent);
    outside.focus();
    let cleanups = 0;
    const handle = hydrateOwnedBoundary({
      boundary, matches: () => false,
      recover: () => {
        const next = document.createElement("button");
        next.textContent = "new";
        return next;
      },
      attach: () => { onCleanup(() => cleanups++); }
    });
    expect(handle.recovered).toBe(true);
    expect(parent.firstChild).toBe(outside);
    expect(document.activeElement).toBe(outside);
    expect(outside.value).toBe("draft");
    expect(existing.isConnected).toBe(false);
    expect(boundary.start.nextSibling?.textContent).toBe("new");
    handle.dispose();
    expect(cleanups).toBe(1);
    parent.remove();
  });
  it("rolls back after attachment failure without removing existing DOM", () => {
    const { parent, existing, boundary } = fixture();
    expect(() => hydrateOwnedBoundary({
      boundary, matches: () => false,
      recover: () => document.createElement("div"),
      attach: () => { throw new Error("attach failed"); }
    })).toThrow(/attach failed/);
    expect(boundary.start.nextSibling).toBe(existing);
    expect(existing.nextSibling).toBe(boundary.end);
    expect(parent.childNodes.length).toBe(4);
  });
  it("aborts and disposes listeners on route cancellation", () => {
    const { existing, boundary } = fixture();
    const navigation = new AbortController();
    let cleanups = 0;
    const handle = hydrateOwnedBoundary({
      boundary, signal: navigation.signal, matches: () => true,
      attach: () => { onCleanup(() => cleanups++); }
    });
    navigation.abort();
    expect(cleanups).toBe(1);
    handle.dispose();
    expect(cleanups).toBe(1);
    expect(existing.parentNode).toBe(boundary.start.parentNode);
  });
  it("rejects forged marker identity and detached nodes", () => {
    const { boundary } = fixture();
    boundary.start.data = "forged";
    expect(() => hydrateOwnedBoundary({
      boundary, matches: () => true, attach: () => {}
    })).toThrow(/Invalid trusted/);
  });
});
