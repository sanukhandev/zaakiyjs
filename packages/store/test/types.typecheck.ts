import { createOwner } from "@zaakiyjs/core";
import { createStore, createStoreContext, requireStore } from "../src/index.js";

const owner = createOwner();
const store = createStore({
  owner,
  state: { count: 0, item: { id: "a", labels: ["x"] } },
  actions: ({ get, set, update }) => ({
    increment(by: number) { update("count", previous => previous + by); },
    rename(value: string) { set("item", { ...get("item"), id: value, labels: [...get("item").labels] }); }
  })
});
store.actions.increment(1);
store.actions.rename("b");
const n: number = store.state.count.value;
const s: string = store.state.item.value.id;
// @ts-expect-error Consumer field signals are readonly.
store.state.count.value = 3;
// @ts-expect-error Field collection is readonly.
store.state.item = { value: store.state.item.value, peek: () => store.state.item.peek() };
// @ts-expect-error Nested state is deeply readonly.
store.state.item.value.id = "c";
// @ts-expect-error Nested arrays are readonly.
store.state.item.value.labels.push("y");
// @ts-expect-error Typed actions reject incorrect argument types.
store.actions.increment("wrong");
// @ts-expect-error Unknown store fields are rejected.
void store.state.missing;
// @ts-expect-error Unknown action is rejected.
store.actions.missing();
createStore({
  owner,
  state: { count: 0 },
  actions: ({ set }) => ({
    bad() {
      // @ts-expect-error Action writer cannot mutate unknown state keys.
      set("missing", 1);
      // @ts-expect-error Action writer respects field value types.
      set("count", "wrong");
    }
  })
});
const token = createStoreContext<Pick<typeof store, "actions" | "state">>("VM contract");
const projection = requireStore(owner, token);
projection.actions.increment(2);
void n; void s;
