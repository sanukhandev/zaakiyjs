// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner, createContext, provide, onCleanup } from "@zaakiyjs/core";
import { createElement, createText, bindText } from "@zaakiyjs/dom/compiler";
import { signal, flushSync } from "@zaakiyjs/signals";
import { createRouter } from "../src/router.js";
import { createMemoryHistory } from "../src/history.js";

describe("Core + Signals + public DOM ABI integration", () => {
  it("retains application services and updates only the active route's text binding", async () => {
    const appOwner = createOwner();
    const count = signal(0);
    const repositoryToken = createContext<{ value: string }>("shared");
    provide(appOwner, repositoryToken, { value: "kept" });
    const cleanup = vi.fn();
    let oldText: Text | undefined;
    const host = document.createElement("main");
    document.body.appendChild(host);

    const router = createRouter({
      owner: appOwner,
      history: createMemoryHistory("/counter"),
      routes: [
        {
          id: "counter", path: "/counter", adapter: {
            setup: ({ services }) => {
              expect(services.require(repositoryToken).value).toBe("kept");
              onCleanup(cleanup);
            },
            render: (_, { owner }) => {
              const element = createElement("p", "html");
              const text = createText("");
              oldText = text;
              element.appendChild(text);
              bindText(owner, text, () => String(count.value));
              return { node: element };
            }
          }
        },
        {
          id: "other", path: "/other", adapter: {
            render: (_, { services }) => {
              const node = createElement("aside", "html");
              node.textContent = services.require(repositoryToken).value;
              return { node };
            }
          }
        }
      ]
    });
    router.attachOutlet(host);
    try {
      await router.start();
      expect(oldText?.data).toBe("0");
      const initialParagraph = host.querySelector("p");
      count.value = 1;
      flushSync();
      expect(oldText?.data).toBe("1");
      expect(host.querySelector("p")).toBe(initialParagraph);

      await router.navigate("/other");
      expect(host.querySelector("aside")?.textContent).toBe("kept");
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(oldText?.isConnected).toBe(false);
      count.value = 2;
      flushSync();
      expect(oldText?.data).toBe("1"); // Disposed binding must never write.
      expect(appOwner.disposed).toBe(false);
    } finally {
      router.dispose();
      disposeOwner(appOwner);
      host.remove();
    }
  });
});
