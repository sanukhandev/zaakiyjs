import {mount} from "@zaakiyjs/dom";
import {App, runBenchmark} from "./App";
import "virtual:zaakiy-styles.css";
import "./style.css";

const host = document.getElementById("app");
if (!host) throw new Error("Missing app host");
const handle = mount(() => <App />, host);
const target = window as typeof window & {__benchmark?: {run(operation: string): void; dispose(): void}};
target.__benchmark = {run: runBenchmark, dispose: () => handle.dispose()};
performance.mark("bench-mounted");
