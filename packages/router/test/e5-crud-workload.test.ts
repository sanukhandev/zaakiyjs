// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, mountOwner, onCleanup } from "@zaakiyjs/core";
import { flushSync } from "@zaakiyjs/signals";
import { bindKeyedRegion, createRegion } from "@zaakiyjs/dom/compiler";
import { createForm } from "../../forms/src/index.js";
import { createStore } from "../../store/src/index.js";
import { createTask } from "../../async/src/index.js";
import { createRouter, createMemoryHistory } from "../src/index.js";

afterEach(() => { document.body.replaceChildren(); });

describe("E5 — integrated CRUD workload", () => {
  it("keeps unrelated DOM stable through editing, form validation, submission and route navigation", async () => {
    const owner = createOwner();
    const host = document.createElement("section");
    document.body.append(host);
    const cleanup: number[] = [];
    const render = vi.fn();
    const update = vi.fn();
    const validate = vi.fn((value: string) => value.trim() ? undefined : "Title required");
    const items = Array.from({ length: 300 }, (_, id) => ({ id, title: "Record " + id }));
    const store = createStore({
      owner,
      state: { items, selectedId: 150 },
      actions: write => ({
        rename(id: number, title: string) {
          write.update("items", current => current.map(row =>
            row.id === id ? { id: row.id, title } : row));
        }
      })
    });
    const form = createForm({
      owner, initialValues: { title: "Edited 150" },
      onSubmit: async values => {
        store.actions.rename(150, values.title);
        return "saved";
      }
    });
    const title = form.field("title", { validators: [validate], validateOn: ["blur"] });
    const save = createTask({
      owner, concurrency: "latest" as const,
      execute: async ({ input }: { input: string }) => input.toUpperCase()
    });
    const router = createRouter({
      owner, history: createMemoryHistory("/records"),
      routes: [
        { id: "records", path: "/records" },
        { id: "record", path: "/records/:id", loader: ({ params }) => ({ id: Number(params.id) }) },
        { id: "slow", path: "/slow", loader: () => new Promise(() => undefined) }
      ]
    });
    bindKeyedRegion(owner, createRegion(host), () => store.state.items.value, row => row.id, row => {
      render();
      onCleanup(() => cleanup.push(row.id));
      const node = document.createElement("input");
      node.dataset.recordId = String(row.id);
      node.value = row.title;
      return {
        node,
        update(next: { readonly id: number; readonly title: string }) {
          update(next.id);
          if (node.value !== next.title) node.value = next.title;
        }
      };
    });
    mountOwner(owner);
    const original = [...host.querySelectorAll("input")];
    const focused = original[150]!;
    focused.focus();
    focused.setSelectionRange(2, 5, "backward");
    const observer = new MutationObserver(() => undefined);
    observer.observe(host, { childList: true, subtree: true });
    try {
      expect(render).toHaveBeenCalledTimes(300);
      await router.start();
      const route = await router.navigate("/records/150");
      expect(route.status).toBe("committed");
      expect(router.signals.params.value).toEqual({ id: "150" });

      title.value.value = "";
      expect((await title.validate()).valid).toBe(false);
      expect(validate).toHaveBeenCalledTimes(1);
      title.value.value = "Edited 150";
      expect((await title.validate()).valid).toBe(true);
      expect((await form.submit()).status).toBe("success");
      flushSync();

      expect(update).toHaveBeenCalledTimes(1);
      expect(host.querySelectorAll("input")[150]).toBe(focused);
      expect(focused.value).toBe("Edited 150");
      expect(focused.selectionStart).toBe(2);
      expect(focused.selectionEnd).toBe(5);
      expect([...host.querySelectorAll("input")]).toEqual(original);
      expect(observer.takeRecords()).toHaveLength(0);
      expect(cleanup).toHaveLength(0);

      expect(await save.run("saved")).toBe("SAVED");
      expect(save.result.value).toBe("SAVED");
      const stale = router.navigate("/slow");
      expect((await router.navigate("/records/151")).status).toBe("committed");
      expect((await stale).status).toBe("cancelled");
      expect(router.signals.params.value).toEqual({ id: "151" });
      expect(render).toHaveBeenCalledTimes(300);
    } finally {
      observer.disconnect();
      router.dispose();
      form.dispose();
      save.dispose();
      disposeOwner(owner);
    }
    expect(cleanup).toHaveLength(300);
    expect(new Set(cleanup).size).toBe(300);
    expect(host.querySelectorAll("input")).toHaveLength(0);
  });
});
