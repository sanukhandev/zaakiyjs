/**
 * H5 ordered, bounded hydration payload assembly.
 * Produces inert bytes ONLY. Never writes HTML, executes scripts or adopts DOM.
 * A caller must validate manifest/route identity and pass the current
 * hydration transaction before committing the result to an owned boundary.
 */
export interface HydrationStreamFragment {
  readonly buildId: string;
  readonly routeId: string;
  readonly boundaryId: string;
  readonly index: number;
  readonly final: boolean;
  readonly bytes: Uint8Array;
}
export interface HydrationStreamOptions {
  readonly buildId: string;
  readonly routeId: string;
  readonly boundaryId: string;
  readonly signal?: AbortSignal;
  readonly maxFragments?: number;
  readonly maxBytes?: number;
}
export interface HydrationStreamAssembler {
  push(fragment: HydrationStreamFragment): Uint8Array | null;
  readonly complete: boolean;
  readonly receivedBytes: number;
  abort(): void;
}
const BUILD = /^[a-f0-9]{64}$/;
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const BOUNDARY = /^[a-f0-9]{32}$/;

export function createHydrationStreamAssembler(options: HydrationStreamOptions): HydrationStreamAssembler {
  if (!options || !BUILD.test(options.buildId) || !ROUTE.test(options.routeId) ||
      !BOUNDARY.test(options.boundaryId)) {
    throw new TypeError("Hydration stream requires verified build, route and boundary IDs");
  }
  const maxFragments = options.maxFragments ?? 256;
  const maxBytes = options.maxBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxFragments) || maxFragments < 1 || maxFragments > 4096 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8_388_608)
    throw new RangeError("Hydration stream budgets invalid");
  let cancelled = false;
  let finished = false;
  let total = 0;
  const parts: Uint8Array[] = [];
  const release = () => { parts.length = 0; };
  const abort = () => { cancelled = true; release(); };
  const signal = options.signal;
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const detach = () => signal?.removeEventListener("abort", abort);

  return {
    get complete() { return finished; },
    get receivedBytes() { return total; },
    abort() { detach(); abort(); },
    push(fragment) {
      if (cancelled || signal?.aborted) throw new Error("Hydration stream aborted");
      if (finished) throw new Error("Hydration stream already complete");
      if (!fragment || fragment.buildId !== options.buildId ||
          fragment.routeId !== options.routeId ||
          fragment.boundaryId !== options.boundaryId) {
        detach(); abort();
        throw new TypeError("Hydration stream identity mismatch");
      }
      // Out-of-order, duplicate and missing fragments always fail closed.
      if (!Number.isSafeInteger(fragment.index) || fragment.index !== parts.length ||
          fragment.index >= maxFragments || typeof fragment.final !== "boolean" ||
          !(fragment.bytes instanceof Uint8Array)) {
        detach(); abort();
        throw new TypeError("Hydration stream sequence or fragment invalid");
      }
      // Ensure input can no longer be mutated by the producer after acceptance.
      const bytes = new Uint8Array(fragment.bytes);
      total += bytes.byteLength;
      if (total > maxBytes) {
        detach();
        abort();
        throw new RangeError("Hydration stream byte limit exceeded");
      }
      parts.push(bytes);
      if (!fragment.final) return null;
      const all = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) { all.set(part, offset); offset += part.byteLength; }
      finished = true;
      release();
      detach();
      return all;
    }
  };
}
