// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { createBrowserHistory } from "../src/history.js";
import { createRouter } from "../src/router.js";
import { createBrowserRestoration } from "../src/restoration.js";

describe("native browser History adapter", () => {
  beforeEach(() => window.history.replaceState(null, "", "/home"));
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("pushes/replaces URL without patching global navigation listeners", () => {
    const nativePush = vi.spyOn(window.history, "pushState");
    const nativeReplace = vi.spyOn(window.history, "replaceState");
    const history = createBrowserHistory(window);
    const notify = vi.fn();
    const unsubscribe = history.listen(notify);
    try {
      history.push("/products/4?q=yes#details");
      expect(window.location.pathname).toBe("/products/4");
      expect(window.location.search).toBe("?q=yes");
      expect(window.location.hash).toBe("#details");
      expect(nativePush).toHaveBeenCalledTimes(1);
      history.replace("/products/5");
      expect(window.location.pathname).toBe("/products/5");
      expect(nativeReplace).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new Event("hashchange"));
      expect(notify).toHaveBeenCalledTimes(2);
      unsubscribe();
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(notify).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      nativePush.mockRestore();
      nativeReplace.mockRestore();
    }
  });

  it("routes actual popstate and drops browser listeners on router disposal", async () => {
    const owner = createOwner();
    const router = createRouter({
      owner,
      history: createBrowserHistory(window),
      routes: [
        { id: "home", path: "/home" },
        { id: "detail", path: "/detail/:id" }
      ]
    });
    try {
      await router.start();
      await router.navigate("/detail/123");
      expect(window.location.pathname).toBe("/detail/123");
      expect(router.signals.params.value).toEqual({ id: "123" });
      window.history.replaceState(null, "", "/home");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await vi.waitFor(() => expect(router.signals.url.value).toBe("/home"));
      router.dispose();
      window.history.replaceState(null, "", "/detail/999");
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(router.signals.url.value).toBe("/home");
    } finally { router.dispose(); disposeOwner(owner); }
  });

  it("never steals focus without an explicit caller focus hook", () => {
    const focus = vi.fn();
    const announcement = vi.fn();
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const callback = createBrowserRestoration(window, { scroll: "auto", focus, announce: announcement });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    try {
      callback({ url: "/home", matches: [], isPop: false });
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(announcement).toHaveBeenCalledTimes(1);
      callback({ url: "/home", matches: [], isPop: true });
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally { scroll.mockRestore(); input.remove(); }
  });
});
