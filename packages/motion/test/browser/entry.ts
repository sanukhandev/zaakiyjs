import * as motion from "../../src/index.js";
import * as route from "../../src/route.js";
import { createOwner, disposeOwner } from "@zaakiyjs/core";
declare global {
  interface Window {
    motionQA: typeof motion & typeof route & {
      createOwner: typeof createOwner;
      disposeOwner: typeof disposeOwner;
    };
  }
}
window.motionQA = { ...motion, ...route, createOwner, disposeOwner };
