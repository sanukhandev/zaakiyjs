import { label } from "./util.js";
export const untouched = label;
globalThis.document.body.dataset.vite = untouched;
void import("./async.js");
