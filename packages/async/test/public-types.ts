import { createResource, createTask } from "../src/index.js";
import type { Resource, Task, TaskContext } from "../src/index.js";

const resource = createResource({
  key: () => "abc",
  load: async ({ key }) => key.length
});
const typed: Resource<number> = resource;
const value: number | undefined = typed.data.value;
void value;
const task = createTask({
  execute: async ({ input }: TaskContext<{ id: number }>) => input.id.toString()
});
const promise: Promise<string> = task.run({ id: 1 });
void promise;
const assigned: Task<string, { id: number }> = task;
void assigned;
// @ts-expect-error mutation input is not a string.
void task.run("wrong");
// @ts-expect-error resource.data is readonly.
resource.data.value = 123;
