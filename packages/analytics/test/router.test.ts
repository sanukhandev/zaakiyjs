import { it, expect, vi } from "vitest";
import { trackRouter } from "../src/router.js";

it("reports only successful route commits, redacts query, and cleans up", () => {
  const report = vi.fn(() => true);
  let url = "/";
  let matches: { route: { id: string } }[] = [];
  let subscriber: ((matches: readonly { route: { id: string } }[]) => void) | undefined;
  const router = {
    signals: { url: { peek: () => url }, matches: { peek: () => matches } },
    subscribe(fn: typeof subscriber) { subscriber = fn; return () => { subscriber = undefined; }; }
  };
  const detach = trackRouter({ pageview: report }, router, { initialPageview: true });
  expect(report).not.toHaveBeenCalled();
  matches = [{ route: { id: "home" } }];
  url = "/?token=sensitive";
  subscriber?.(matches);
  subscriber?.(matches);
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenLastCalledWith({ path: "/", routeId: "home" });
  url = "/shop?token=private";
  matches = [{ route: { id: "shop" } }];
  subscriber?.(matches);
  expect(report).toHaveBeenCalledTimes(2);
  detach();
  expect(subscriber).toBeUndefined();
});
