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
