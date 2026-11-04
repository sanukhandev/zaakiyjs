import type { InterceptorList } from "./types.js";
export function interceptorList<T>(): InterceptorList<T> & { handlers(): readonly T[] } {
  const registered = new Set<T>();
  return {
    use(handler: T) {
      if (typeof handler !== "function") throw new TypeError("Interceptor must be a function");
      registered.add(handler);
      return () => { registered.delete(handler); };
    },
    clear() { registered.clear(); },
    handlers() { return [...registered]; }
  };
}
