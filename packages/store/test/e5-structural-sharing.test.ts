import { describe, expect, it } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { createStore } from "../src/index.js";

describe("E5 — Store structural sharing for keyed CRUD rows", () => {
  it("preserves owner-owned immutable records while cloning only the edited row", () => {
    const owner = createOwner();
    const external = [{ id: 1, profile: { name: "A" } }, { id: 2, profile: { name: "B" } }];
    const store = createStore({
      owner, state: { rows: external },
      actions: write => ({
        rename(id: number, name: string) {
          write.update("rows", rows => rows.map(row => row.id === id
            ? { id: row.id, profile: { name } }
            : row));
        },
        setRows(rows: typeof external) { write.set("rows", rows); }
      })
    });
    try {
      const original = store.state.rows.value;
      store.actions.rename(2, "changed");
      const current = store.state.rows.value;
      expect(current).not.toBe(original);
      expect(current[0]).toBe(original[0]);
      expect(current[0]?.profile).toBe(original[0]?.profile);
      expect(current[1]).not.toBe(original[1]);
      expect(current[1]?.profile.name).toBe("changed");
      expect(Object.isFrozen(current[0])).toBe(true);
      expect(Object.isFrozen(current[1])).toBe(true);

      external[0]!.profile.name = "external mutation";
      expect(store.state.rows.value[0]?.profile.name).toBe("A");
      const externallyFrozen = Object.freeze({
        id: 3, profile: { name: "external" }
      });
      store.actions.setRows([externallyFrozen]);
      externallyFrozen.profile.name = "tampered";
      expect(store.state.rows.value[0]?.profile.name).toBe("external");
      expect(store.state.rows.value[0]).not.toBe(externallyFrozen);
    } finally { disposeOwner(owner); }
  });

  it("does not reuse immutable snapshots owned by another store", () => {
    const firstOwner = createOwner();
    const secondOwner = createOwner();
    const first = createStore({
      owner: firstOwner, state: { rows: [{ id: 1 }] },
      actions: () => ({})
    });
    const second = createStore({
      owner: secondOwner, state: { rows: first.state.rows.value },
      actions: () => ({})
    });
    try {
      expect(second.state.rows.value).not.toBe(first.state.rows.value);
      expect(second.state.rows.value[0]).not.toBe(first.state.rows.value[0]);
      expect(second.state.rows.value).toEqual(first.state.rows.value);
    } finally {
      disposeOwner(firstOwner);
      disposeOwner(secondOwner);
    }
  });
});