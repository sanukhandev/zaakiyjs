import { createHttpClient } from "../src/index.js";
import type { HttpResponse, QueryParams, Validator } from "../src/index.js";
interface User { id: number }
interface Input { name: string }
const c = createHttpClient({ baseURL: "https://example.test/api" });
const validator: Validator<User> = { parse: value => value as User };
const user: Promise<User> = c.get<User>("/user", { responseSchema: validator });
const created: Promise<User> = c.post<User, Input>("/user", { name: "Ada" });
const detailed: Promise<HttpResponse<User>> = c.requestDetailed<User>({ method: "GET", url: "/", responseSchema: validator });
const params: QueryParams = { count: 1, tags: ["a", "b"] };
void user; void created; void detailed; void params;
// @ts-expect-error generics must not be silently reassigned
const wrong: Promise<string> = c.get<User>("/");
void wrong;
// @ts-expect-error invalid nested query
const nested: QueryParams = { bad: { x: 1 } };
void nested;
// @ts-expect-error unsupported verb
void c.request({ method: "TRACE", url: "/" });
