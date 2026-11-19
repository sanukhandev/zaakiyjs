import { describe, expect, it } from "vitest";
import { compileRoutes, matchRoutes, buildRoutePath } from "../src/match.js";
import { defineRoute, RouteConfigurationError } from "../src/types.js";

describe("pure route matcher", () => {
  const product = defineRoute({ id: "product", path: "products/:id" });
  const table = compileRoutes([
    { id: "root", path: "/", children: [
      { id: "products", path: "products" },
      product,
      { id: "index", path: "home" }
    ] },
    { id: "not-found", path: "*" }
  ]);

  it("ranks static before dynamic and decodes path params", () => {
    const match = matchRoutes(table, "/products/hello%20world");
    expect(match.map(x => x.route.id)).toEqual(["root", "product"]);
    expect(match[1]?.params.id).toBe("hello world");
    expect(buildRoutePath(table.byId.get("product")!, { id: "test/slug" })).toBe("/products/test%2Fslug");
    expect(matchRoutes(table, "/products")[1]?.route.id).toBe("products");
  });
  it("resolves nested index routes and terminal wildcard fallback", () => {
    const nested = compileRoutes([{ id: "layout", path: "/shop", children: [{ id: "index", path: "" }] }]);
    expect(matchRoutes(nested, "/shop").map(x => x.route.id)).toEqual(["layout", "index"]);
    expect(matchRoutes(table, "/unknown").at(-1)?.route.id).toBe("not-found");
    expect(matchRoutes(table, "/").at(-1)?.route.id).toBe("root");
  });
  it("does not inherit child-only params into a persistent parent layout", () => {
    const nested = compileRoutes([{
      id: "layout", path: "/shops/:shopId", children: [{ id: "detail", path: "products/:productId" }]
    }]);
    const matches = matchRoutes(nested, "/shops/a/products/b");
    expect(matches[0]?.params).toEqual({ shopId: "a" });
    expect(matches[1]?.params).toEqual({ shopId: "a", productId: "b" });
  });
  it("preserves nested inherited parameters and safely captures reserved path names", () => {
    const nested = compileRoutes([{
      id: "a", path: "/:__proto__", children: [{
        id: "b", path: "shops/:constructor", children: [{
          id: "c", path: "products/:productId"
        }]
      }]
    }]);
    const matches = matchRoutes(nested, "/tenant/shops/x/products/y");
    expect(matches.map(item => item.route.id)).toEqual(["a", "b", "c"]);
    expect(Object.getOwnPropertyDescriptor(matches[0]!.params, "__proto__")?.value).toBe("tenant");
    expect(matches[1]?.params.constructor).toBe("x");
    expect(matches[2]?.params).toMatchObject({productId: "y"});
    expect(Object.hasOwn(matches[2]!.params, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(matches[2]!.params)).toBe(Object.prototype);
    expect(Object.isFrozen(matches[2]!.params)).toBe(true);
    expect(matches[0]?.params).not.toHaveProperty("productId");
  });
  it("keeps parameter snapshots independent across nested route matches", () => {
    const nested = compileRoutes([{
      id: "company", path: "/:company", children: [{
        id: "team", path: "team/:team", children: [{
          id: "item", path: "work/:item"
        }]
      }]
    }]);
    const routes = matchRoutes(nested, "/acme/team/engineering/work/123");
    expect(routes.map(r => r.params)).toEqual([
      {company: "acme"},
      {company: "acme", team: "engineering"},
      {company: "acme", team: "engineering", item: "123"}
    ]);
    expect(routes.map(r => r.pathname)).toEqual([
      "/:company", "/:company/team/:team", "/:company/team/:team/work/:item"
    ]);
    expect(routes[0]?.params).not.toBe(routes[1]?.params);
    expect(routes[1]?.params).not.toBe(routes[2]?.params);
  });
  it("rejects ambiguous, duplicate, unsafe and unsupported grammar", () => {
    expect(() => compileRoutes([{ id: "a", path: "/users/:id" }, { id: "b", path: "/users/:name" }]))
      .toThrow(RouteConfigurationError);
    expect(() => compileRoutes([{ id: "a", path: "/users" }, { id: "a", path: "/other" }]))
      .toThrow(RouteConfigurationError);
    for (const path of ["/x/:", "/x/*/y", "/x/:id?", "/x/../y", "/x/%2f"]) {
      expect(() => compileRoutes([{ id: "a", path }])).toThrow(RouteConfigurationError);
    }
    expect(() => compileRoutes([{ id: "p", path: "/", children: [{ id: "c", path: "/absolute" }] }]))
      .toThrow(RouteConfigurationError);
  });
});
