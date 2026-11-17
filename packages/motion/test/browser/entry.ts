import * as motion from "../../src/index.js";
import * as route from "../../src/route.js";
import { createOwner, disposeOwner, mountOwner, onCleanup } from "@zaakiyjs/core";
import { createRegion } from "@zaakiyjs/dom/compiler";
import { signal, flushSync } from "@zaakiyjs/signals";
declare global {
  interface Window {
    motionQA: typeof motion & typeof route & {
      createOwner: typeof createOwner;
      disposeOwner: typeof disposeOwner;
      mountOwner: typeof mountOwner;
      onCleanup: typeof onCleanup;
      createRegion: typeof createRegion;
      signal: typeof signal;
      flushSync: typeof flushSync;
    };
  }
}
window.motionQA = { ...motion, ...route, createOwner, disposeOwner, mountOwner, onCleanup, createRegion, signal, flushSync };
