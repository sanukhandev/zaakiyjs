import { createRouter, createMemoryHistory, defineRoute, type RouteParams, type RouteTarget } from "../src/index.js";
import { createOwner } from "@zaakiyjs/core";

const product = defineRoute({ id: "product", path: "/products/:id" });
const params: RouteParams<"/products/:id"> = { id: "42" };
const target: RouteTarget<"/products/:id"> = { route: product, params };
const router = createRouter({ routes: [product], owner: createOwner(), history: createMemoryHistory("/") });
const href: string = router.href(target);
void href;
// @ts-expect-error required dynamic segment parameter
const wrong: RouteParams<"/products/:id"> = {};
// @ts-expect-error parameter must be a string
const wrongType: RouteParams<"/products/:id"> = { id: 123 };
void wrong;
void wrongType;
