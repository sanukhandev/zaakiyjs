"""Real WAAPI, lifecycle and interaction smoke in Chromium, Firefox and WebKit.

Uses production Vite output and browser-native APIs, not jsdom stand-ins.
Requires playwright==1.64.1 and all three pinned browsers.
"""
from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

CASES = [
    ("waapi-completion-release", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("div"); document.body.append(el);
      if (typeof el.animate !== "function") throw new Error("WAAPI unavailable");
      const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:45}});
      if(h.phase.value !== "running") throw new Error("phase not running");
      const result = await h.finished;
      if(result.reason !== "completed" || result.phase !== "finished" || h.phase.value !== "finished")
        throw new Error(JSON.stringify(result));
      if(el.getAnimations().length !== 0) throw new Error("finished WAAPI timeline retained");
      m.disposeOwner(owner); el.remove();
      return true;
    }"""),
    ("waapi-explicit-cancel", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("div"); document.body.append(el);
      const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:10000}});
      h.cancel("aborted"); h.cancel();
      const result = await h.finished;
      if(result.phase !== "cancelled" || result.reason !== "aborted") throw new Error(JSON.stringify(result));
      if(el.getAnimations().length !== 0) throw new Error("WAAPI not cancelled");
      m.disposeOwner(owner); el.remove(); return true;
    }"""),
    ("waapi-owner-disposal", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("div"); document.body.append(el);
      const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:10000}});
      m.disposeOwner(owner);
      const result = await h.finished;
      if(result.phase !== "cancelled" || result.reason !== "owner-disposed") throw new Error(JSON.stringify(result));
      if(el.getAnimations().length !== 0) throw new Error("owned WAAPI retained");
      el.remove(); return true;
    }"""),
    ("waapi-signal-abort", """async () => {
      const m = window.motionQA, owner = m.createOwner(), ac = new AbortController();
      const el = document.createElement("div"); document.body.append(el);
      const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:10000},signal:ac.signal});
      ac.abort();
      const result = await h.finished;
      if(result.reason !== "aborted" || result.phase !== "cancelled") throw new Error(JSON.stringify(result));
      if(el.getAnimations().length !== 0) throw new Error("signal WAAPI retained");
      m.disposeOwner(owner); el.remove(); return true;
    }"""),
    ("reduced-motion-default", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("div"); document.body.append(el);
      if(!matchMedia("(prefers-reduced-motion: reduce)").matches) throw new Error("test media setup failed");
      const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:900}});
      const result = await h.finished;
      if(result.reason !== "reduced-motion" || result.phase !== "finished") throw new Error(JSON.stringify(result));
      if(el.getAnimations().length) throw new Error("motion should be bypassed");
      m.disposeOwner(owner); el.remove(); return true;
    }"""),
    ("reduced-motion-explicit-override", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("div"); document.body.append(el);
      if(!matchMedia("(prefers-reduced-motion: reduce)").matches) throw new Error("test media setup failed");
      const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:35},reducedMotion:"never"});
      if(h.phase.value !== "running") throw new Error("explicit override did not animate");
      const result = await h.finished;
      if(result.reason !== "completed") throw new Error(JSON.stringify(result));
      m.disposeOwner(owner); el.remove(); return true;
    }"""),
    ("presence-exit-reentry", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("div"); document.body.append(el);
      const cfg = {keyframes:[{opacity:0},{opacity:1}],timing:{duration:30}};
      const p = m.createPresence({owner,element:el,enter:cfg,exit:cfg});
      const old = p.exit();
      const next = p.enter();
      const cancelled = await old, finished = await next.finished;
      await Promise.resolve();
      if(cancelled.reason !== "superseded" || finished.reason !== "completed" ||
         p.phase.value !== "present" || !el.isConnected) throw new Error("stale presence result");
      m.disposeOwner(owner);
      if(p.phase.value !== "exited") throw new Error("presence leaked on dispose");
      el.remove(); return true;
    }"""),
    ("spring-rest", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      let last = 0, count = 0;
      const h = m.createSpring({from:0,to:4,owner,stiffness:260,damping:32,onUpdate(x){
        if(!Number.isFinite(x)) throw new Error("non-finite spring state");
        last = x; count++;
      }});
      const result = await h.finished;
      if(result.status !== "finished" || last !== 4 || count > 600) throw new Error("spring did not rest");
      m.disposeOwner(owner); return true;
    }"""),
    ("spring-disposal", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      let n = 0;
      const h = m.createSpring({from:0,to:20,owner,onUpdate(){n++}});
      m.disposeOwner(owner);
      const out = await h.finished, before = n;
      await new Promise(r => setTimeout(r,80));
      if(out.status !== "cancelled" || out.reason !== "owner-disposed" || n !== before)
        throw new Error("RAF leak after owner disposal");
      return true;
    }"""),
    ("keyed-layout-focus", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const host = document.createElement("div");
      host.style.display = "flex";
      const a = document.createElement("input"), b = document.createElement("input");
      for(const el of [a,b]) { el.style.width="100px"; el.style.height="20px"; }
      host.append(a,b); document.body.append(host);
      a.value = "selection"; a.focus(); a.setSelectionRange(2,5);
      const before = m.captureLayout([a,b]);
      host.insertBefore(b,a);
      const handles = m.animateKeyedMoves(before,{owner,duration:25});
      if(host.children[0] !== b || host.children[1] !== a ||
         document.activeElement !== a || a.selectionStart !== 2 || a.selectionEnd !== 5)
        throw new Error("keyed identity/focus/selection lost");
      await Promise.all([...handles.values()].map(h => h.finished));
      if(a.getAnimations().length || b.getAnimations().length) throw new Error("FLIP animations retained");
      m.disposeOwner(owner); host.remove(); return true;
    }"""),
    ("element-removal-cancel", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const host = document.createElement("div"), el = document.createElement("div");
      host.append(el); document.body.append(host);
      const h = m.animateElement(el,{owner,keyframes:[{opacity:0},{opacity:1}],duration:10000,observeRemoval:true});
      el.remove();
      const result = await h.finished;
      if(result.status !== "cancelled" || result.reason !== "element-removed") throw new Error(JSON.stringify(result));
      m.disposeOwner(owner); host.remove(); return true;
    }"""),
    ("gesture-keyboard-dispose", """async () => {
      const m = window.motionQA, owner = m.createOwner();
      const el = document.createElement("button"); document.body.append(el);
      let keyboard = 0, taps = 0;
      const h = m.createGestures(el,{owner,onTap(){taps++},onKeyActivate(){keyboard++}});
      el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
      if(keyboard !== 1) throw new Error("keyboard alternative missing");
      m.disposeOwner(owner);
      el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
      if(keyboard !== 1 || taps !== 0) throw new Error("gesture listener leaked");
      h.dispose(); el.remove(); return true;
    }"""),
    ("route-fallback-failure", """async () => {
      const m = window.motionQA, doc = document.implementation.createHTMLDocument("mock");
      Object.defineProperty(doc,"startViewTransition",{value:undefined,configurable:true});
      let committed = 0;
      const out = await m.runRouteTransition(()=>{committed++},{document:doc});
      if(out.animated || committed !== 1) throw new Error("fallback lost commit");
      let failed = false;
      try {await m.runRouteTransition(()=>{throw new Error("guarded commit failed")},{document:doc});}
      catch(e) {failed = e.message === "guarded commit failed";}
      if(!failed) throw new Error("failed commit incorrectly marked successful");
      return true;
    }"""),
    ("repeated-owner-teardown", """async () => {
      const m = window.motionQA, el = document.createElement("div");
      document.body.append(el);
      for(let i=0;i<80;i++){
        const owner = m.createOwner();
        const h = m.animateOwned({owner,element:el,keyframes:[{opacity:0},{opacity:1}],timing:{duration:10000}});
        m.disposeOwner(owner);
        const result = await h.finished;
        if(result.reason !== "owner-disposed" || el.getAnimations().length)
          throw new Error("leaked animation at iteration "+i);
      }
      el.remove(); return true;
    }"""),
]

async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    failures: list[str] = []
    async with async_playwright() as pw:
        for engine in ("chromium", "firefox", "webkit"):
            browser = await getattr(pw, engine).launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 720})
            page = await context.new_page()
            page_errors: list[str] = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            try:
                for title, js in CASES:
                    page_errors.clear()
                    await page.emulate_media(reduced_motion="reduce" if title.startswith("reduced-motion-") else "no-preference")
                    try:
                        await page.goto(args.base_url, wait_until="networkidle")
                        await page.wait_for_function("typeof window.motionQA?.animateOwned === 'function'")
                        await asyncio.wait_for(page.evaluate(js), timeout=20)
                        if page_errors:
                            raise RuntimeError("page errors: " + " | ".join(page_errors))
                        print(f"PASS {engine}: {title}", flush=True)
                    except Exception as exc:
                        failures.append(f"{engine}/{title}: {exc}")
                        out = Path("/tmp") / f"zaakiy-motion-{engine}-{title}.png"
                        try:
                            await page.screenshot(path=str(out))
                        except Exception:
                            pass
                        print(f"FAIL {engine}: {title}: {exc}", flush=True)
            finally:
                await context.close()
                await browser.close()
    print(f"MOTION_BROWSER_RESULT cases={len(CASES) * 3} failures={len(failures)}", flush=True)
    if failures:
        raise AssertionError("\n".join(failures))

if __name__ == "__main__":
    asyncio.run(main())
