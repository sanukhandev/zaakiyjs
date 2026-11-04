import { expect, it } from "vitest";
import { createRouter, createMemoryHistory, defineRoute, type RouteParams, type RouteTarget } from "../src/index.js";
import { createOwner, disposeOwner } from "@zaakiyjs/core";

const product = defineRoute({ id: "product", path: "/products/:id" });
const params: RouteParams<"/products/:id"> = { id: "42" };
const target: RouteTarget<"/products/:id"> = { route: product, params };
const pair = defineRoute({ id: "pair", path: "/shops/:shopId/products/:productId" });
const pairTarget: RouteTarget<"/shops/:shopId/products/:productId"> =
  { route: pair, params: { shopId: "s", productId: "p" } };
// @ts-expect-error required dynamic segment parameter
const wrong: RouteParams<"/products/:id"> = {};
// @ts-expect-error parameter must be a string
const wrongType: RouteParams<"/products/:id"> = { id: 123 };
// @ts-expect-error second required dynamic segment
const incomplete: RouteTarget<"/shops/:shopId/products/:productId"> = { route: pair, params: { shopId: "s" } };
void wrong;
void wrongType;
void incomplete;

it("builds registered typed routes without implicit parameter inference", () => {
  const owner = createOwner();
  const router = createRouter({ routes: [product, pair], owner, history: createMemoryHistory("/") });
  try {
    expect(router.href(target)).toBe("/products/42");
    expect(router.href(pairTarget)).toBe("/shops/s/products/p");
  } finally {
    router.dispose();
    disposeOwner(owner);
  }
});
