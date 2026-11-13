import { describe, expect, it } from "vitest";
import { parseHydrationState, serializeHydrationState } from "../src/hydration-state.js";

const BUILD = "a".repeat(64);
const ROUTE = "account.details";

describe("H5 bounded hydration state", () => {
  it("round trips explicit public JSON data without executable markup", () => {
    const serialized = serializeHydrationState(BUILD, ROUTE, {
      title: "</script><img src=x onerror=alert(1)>",
      count: 3, nested: [null, true, { label: "&<>\u2028" }]
    });
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("&");
    expect(parseHydrationState(serialized, BUILD, ROUTE)).toEqual({
      title: "</script><img src=x onerror=alert(1)>",
      count: 3, nested: [null, true, { label: "&<>\u2028" }]
    });
  });

  it("rejects build and route mismatches without returning state", () => {
    const text = serializeHydrationState(BUILD, ROUTE, { count: 1 });
    expect(() => parseHydrationState(text, "b".repeat(64), ROUTE)).toThrow();
    expect(() => parseHydrationState(text, BUILD, "other")).toThrow();
    expect(() => parseHydrationState(text, BUILD, ROUTE + "/../")).toThrow();
  });

  it("refuses getters, prototype pollution, shared graphs and unsupported values", () => {
    const access = Object.defineProperty({}, "secret", {
      enumerable: true, get: () => { throw Error("must not execute getter"); }
    });
    expect(() => serializeHydrationState(BUILD, ROUTE, access)).toThrow(/getters/);
    const polluted = JSON.parse('{"__proto__":{"admin":true}}');
    expect(() => serializeHydrationState(BUILD, ROUTE, polluted)).toThrow();
    expect(() => parseHydrationState(
      '{"schema":"zaakiy.hydration-state/1","buildId":"' + BUILD +
      '","routeId":"' + ROUTE + '","value":{"constructor":true}}',
      BUILD, ROUTE)).toThrow();
    const shared = { x: 1 };
    expect(() => serializeHydrationState(BUILD, ROUTE, [shared, shared])).toThrow();
    expect(() => serializeHydrationState(BUILD, ROUTE, { data: Infinity })).toThrow();
    expect(() => serializeHydrationState(BUILD, ROUTE, { data: undefined })).toThrow();
  });

  it("enforces explicit byte and structural limits", () => {
    expect(() => serializeHydrationState(BUILD, ROUTE, "x".repeat(70000))).toThrow();
    expect(() => parseHydrationState("x".repeat(70000), BUILD, ROUTE)).toThrow();
    expect(() => serializeHydrationState(BUILD, ROUTE, new Array(4100).fill(1))).toThrow();
  });
});
