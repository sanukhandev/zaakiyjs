/** Prototype-safe path operations; never interpret user input as executable code. */
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = Object.prototype.hasOwnProperty;
export function splitPath(path: string): string[] {
  if (!path || path.length > 1024) throw new RangeError('Invalid field path length');
  const parts = path.split('.');
  if (parts.length > 16 || parts.some(p => !p || forbidden.has(p))) throw new TypeError('Unsafe or invalid field path');
  return parts;
}
/** An omitted optional property is different from an explicit undefined value. */
export function hasPath(root: unknown, path: string): boolean {
  let value: unknown = root;
  for (const key of splitPath(path)) {
    if (value === null || typeof value !== 'object' || !own.call(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}
export function readPath(root: unknown, path: string): unknown {
  return splitPath(path).reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object' || !own.call(value, key)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}
export function writePath<T>(root: T, path: string, next: unknown): T {
  const parts = splitPath(path);
  const write = (value: unknown, index: number): unknown => {
    if (index === parts.length) return next;
    const key = parts[index]!;
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new TypeError('Expected numeric array index');
      const pos = Number(key);
      if (!Number.isSafeInteger(pos) || pos > value.length) throw new RangeError('Array index out of bounds');
      const copy: unknown[] = [...value];
      copy[pos] = write(copy[pos], index + 1);
      return copy;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Cannot write into non-object field');
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if (!own.call(copy, key)) throw new TypeError('Field path does not exist');
    copy[key] = write(copy[key], index + 1);
    return copy;
  };
  return write(root, 0) as T;
}
/**
 * Clone editable containers while retaining immutable Blob/File objects by identity.
 * Native structuredClone duplicates Blob/File objects, which makes a pristine form
 * incorrectly dirty when comparing separately cloned initial and current values.
 * Other supported built-ins use native cloning or explicit value-preserving copies.
 */
export function copyValue<T>(value: T): T {
  const seen = new WeakMap<object, object>();
  const clone = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    // Blob bytes are immutable. Preserve identity for Blob and its File subclass
    // so equality cannot incorrectly treat different same-size payloads as equal.
    if (typeof Blob !== 'undefined' && input instanceof Blob) return input;
    const cached = seen.get(input);
    if (cached !== undefined) return cached;
    if (input instanceof Date) return new Date(input.getTime());
    if (input instanceof RegExp) {
      const result = new RegExp(input.source, input.flags);
      result.lastIndex = input.lastIndex;
      return result;
    }
    const prototype: unknown = Object.getPrototypeOf(input);
    if (Array.isArray(input) || prototype === Object.prototype || prototype === null) {
      const result: Record<string, unknown> | unknown[] =
        Array.isArray(input) ? new Array<unknown>(input.length) : Object.create(prototype as object | null) as Record<string, unknown>;
      seen.set(input, result);
      for (const key of Object.keys(input)) {
        // defineProperty handles own __proto__ keys without changing the prototype.
        Object.defineProperty(result, key, {
          value: clone(Reflect.get(input, key)), enumerable: true, writable: true, configurable: true
        });
      }
      return result;
    }
    return structuredClone(input);
  };
  return clone(value) as T;
}
export function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
}
export function pathInArray(path: string, arrayPath: string): { index: number; suffix: string } | null {
  if (!path.startsWith(arrayPath + '.')) return null;
  const tail = path.slice(arrayPath.length + 1);
  const [index, ...rest] = tail.split('.');
  if (!index || !/^(0|[1-9][0-9]*)$/.test(index)) return null;
  return { index: Number(index), suffix: rest.length ? '.' + rest.join('.') : '' };
}
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags && a.lastIndex === b.lastIndex;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x: unknown, i: number) => sameValue(x, b[i]));
  }
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ak = Object.keys(a); const bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => own.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
