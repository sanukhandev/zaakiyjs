/** Prototype-safe path operations; never interpret user input as executable code. */
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = Object.prototype.hasOwnProperty;
export function splitPath(path: string): string[] {
  if (!path || path.length > 1024) throw new RangeError('Invalid field path length');
  const parts = path.split('.');
  if (parts.length > 16 || parts.some(p => !p || forbidden.has(p))) throw new TypeError('Unsafe or invalid field path');
  return parts;
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
/** Preserves Date, File and Blob via native clone where available; no JSON serialization. */
export function copyValue<T>(value: T): T {
  return structuredClone(value);
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
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x: unknown, i: number) => sameValue(x, b[i]));
  }
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ak = Object.keys(a); const bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => own.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
