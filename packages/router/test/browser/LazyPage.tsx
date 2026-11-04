import { onCleanup, onMount } from "@zaakiyjs/core";
import type { PageAdapter } from "@zaakiyjs/router";
import { metrics } from "./App";

export const adapter: PageAdapter = {
  setup() {
    metrics.lazySetup++;
    onMount(() => { /* Asserted through the rendered DOM and explicit cleanup. */ });
    onCleanup(() => { metrics.lazyCleanup++; });
  },
  render() {
    return {
      node: (<main id="lazy-page"><h2>Lazy module loaded</h2><p>Real compiled TSX</p></main>) as unknown as Node
    };
  }
};
