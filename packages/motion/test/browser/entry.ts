import * as motion from "../../src/index.js";
import * as route from "../../src/route.js";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
import { createRegion } from "@zaakiyjs/dom/compiler";
import { signal, flushSync } from "@zaakiyjs/signals";
import { bindMotionConditionalRegion } from "../../src/dom-regions.js";
declare global {
  interface Window {
    motionQA: typeof motion & typeof route & {
      createOwner: typeof createOwner;
      disposeOwner: typeof disposeOwner;
      createRegion: typeof createRegion;
      signal: typeof signal;
      flushSync: typeof flushSync;
      bindMotionConditionalRegion: typeof bindMotionConditionalRegion;
    };
  }
}
window.motionQA = { ...motion, ...route, createOwner, disposeOwner, createRegion, signal, flushSync, bindMotionConditionalRegion };
