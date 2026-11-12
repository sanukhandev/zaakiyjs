import { describe, expect, it } from "vitest";
import { compileRegionServer } from "../src/server-region.js";

const fileName = "packages/compiler/test/h4-region-example.tsx";
function build(source: string) {
  return compileRegionServer({ fileName, routeId: "products", source });
}
describe("H4 compiler-backed region SSR target", () => {
  it("emits deterministic conditional regions and data slot markers", () => {
    const source = "function Page(props: { active: boolean; name: string }) { return <main>{props.active ? <b>{props.name}</b> : <i>hidden</i>}</main>; }";
    const result = build(source);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.js).toHaveLength(1);
    expect(result.hydrationPlan?.schema).toBe("zaakiy.region-hydration/2");
    expect(result.js[0]?.code).toContain("zaakiy-r2:");
    expect(result.js[0]?.code).toContain("zaakiy-d2:");
    expect(build(source).hydrationPlan).toEqual(result.hydrationPlan);
  });
  it("compiles keyed region identity with stable own-property keys", () => {
    const source = "function Page(props: { rows: { id: string; label: string }[] }) { return <main>{props.rows.map(item => <p key={item.id}>{item.label}</p>)}</main>; }";
    const result = build(source);
    expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.hydrationPlan?.nodes).toHaveLength(1);
    expect(result.js[0]?.code).toContain("zaakiy-k2:");
  });
  it("rejects unsafe dynamic expressions and arbitrary JSX components", () => {
    const sources = [
      "function Page(props:{name:string}) { return <main>{props.name.toUpperCase()}</main>; }",
      "function Page(props:{name:string}) { return <main>{props.name + '!'}</main>; }",
      "function Card(){return <p>card</p>;} function Page(){return <main><Card /></main>;}",
      "function Page(props:{name:string}) { return <main><a href={props.name}>unsafe</a></main>; }"
    ];
    for (const source of sources) {
      const result = build(source);
      expect(result.js, source).toHaveLength(0);
      expect(result.diagnostics.some(d => d.severity === "error"), source).toBe(true);
    }
  });
});
