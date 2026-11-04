import { getOwner, onCleanup, runWithOwner } from '@zaakiyjs/core';
import { batch, computed, signal } from '@zaakiyjs/signals';
import type { WritableSignal } from '@zaakiyjs/signals';
import { copyValue, hasPath, overlaps, pathInArray, readPath, sameValue, splitPath, writePath } from './path.js';
import type {
  ArrayHandle, FieldGroup, FieldHandle, FieldOptions, FieldPath,
  FieldValidationContext, FormController, FormOptions, PathValue,
  SubmissionFailure, SubmitResult, ValidationIssue, ValidationOutput,
  ValidationResult, ValidationStatus, ValidationTrigger
} from './types.js';

type Validator<T> = (value: unknown, context: FieldValidationContext<T>) => ValidationOutput | Promise<ValidationOutput>;
type CheckStatus = Exclude<ValidationStatus, 'idle'>;

interface FieldRecord<T extends object> {
  readonly id: string;
  readonly path: WritableSignal<string>;
  readonly value: WritableSignal<unknown>;
  readonly initial: WritableSignal<unknown>;
  readonly touched: WritableSignal<boolean>;
  readonly disabled: WritableSignal<boolean>;
  readonly fieldIssues: WritableSignal<readonly ValidationIssue[]>;
  readonly crossIssues: WritableSignal<readonly ValidationIssue[]>;
  readonly serverIssues: WritableSignal<readonly ValidationIssue[]>;
  readonly pending: WritableSignal<boolean>;
  readonly status: WritableSignal<ValidationStatus>;
  readonly validators: readonly Validator<T>[];
  readonly dependencies: string[];
  readonly triggers: ReadonlySet<ValidationTrigger>;
  readonly required: boolean | string;
  generation: number;
  controller: AbortController | null;
  release: (() => void) | null;
  disposed: boolean;
}
interface ArrayRecord {
  readonly path: WritableSignal<string>;
  readonly keys: WritableSignal<readonly string[]>;
  initialKeys: readonly string[];
  disposed: boolean;
}

/** Domain/server validation rejection. The caller must supply presentation-safe messages. */
export class SubmissionValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super('Submission failed domain validation');
    this.name = 'SubmissionValidationError';
  }
}

function normalize(output: ValidationOutput, source: ValidationIssue['source'], path?: string): ValidationIssue[] {
  if (output === null || output === undefined || output === '') return [];
  const inputs = Array.isArray(output) ? output : [output];
  return inputs.map((entry: string | ValidationIssue) => typeof entry === 'string'
    ? { code: 'invalid', message: entry, source, ...(path ? { path } : {}) }
    : { ...entry, source: entry.source ?? source, ...(entry.path === undefined && path ? { path } : {}) });
}
function result(status: CheckStatus, issues: readonly ValidationIssue[] = []): ValidationResult {
  return { status, valid: status === 'valid', issues };
}
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function';
}
function isRequiredEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}
function positiveTimeout(ms: number | undefined): void {
  if (ms !== undefined && (!Number.isFinite(ms) || ms <= 0)) throw new RangeError('Timeout must be a positive finite number');
}
function linkAbort(controller: AbortController, external?: AbortSignal, timeoutMs?: number): { release(): void; timedOut(): boolean } {
  let timeout = false;
  const cancel = (): void => controller.abort(external?.reason);
  if (external?.aborted) cancel();
  else external?.addEventListener('abort', cancel, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
    timeout = true;
    controller.abort(new DOMException('Operation timed out', 'TimeoutError'));
  }, timeoutMs);
  return {
    timedOut: () => timeout,
    release: () => { if (timer !== undefined) clearTimeout(timer); external?.removeEventListener('abort', cancel); }
  };
}
/** Unlike awaiting a cooperative validator alone, this settles promptly even if it ignores AbortSignal. */
function abortable<T>(promise: Promise<T>, abortSignal: AbortSignal): Promise<T> {
  if (abortSignal.aborted) {
    // Consume eventual rejection of a non-cooperative promise as well.
    void promise.catch(() => undefined);
    return Promise.reject(abortSignal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => { abortSignal.removeEventListener('abort', cancel); reject(abortSignal.reason); };
    abortSignal.addEventListener('abort', cancel, { once: true });
    void promise.then(
      value => { abortSignal.removeEventListener('abort', cancel); resolve(value); },
      reason => { abortSignal.removeEventListener('abort', cancel); reject(reason); }
    );
  });
}

/** A headless form engine; no DOM, schema library, cache, or second scheduler. */
export function createForm<T extends object, TResult = void>(options: FormOptions<T, TResult>): FormController<T, TResult> {
  const { validators: formValidators, onSubmit, validationTimeoutMs, submitTimeoutMs } = options;
  positiveTimeout(validationTimeoutMs);
  positiveTimeout(submitTimeoutMs);
  let initial: T | null = copyValue(options.initialValues);
  let current: T | null = copyValue(options.initialValues);
  let disposed = false;
  let nextId = 0;
  const revision = signal(0);
  const registryRevision = signal(0);
  const records = new Set<FieldRecord<T>>();
  const byPath = new Map<string, FieldRecord<T>>();
  const arrays = new Map<string, ArrayRecord>();
  const formIssues = signal<readonly ValidationIssue[]>([]);
  const formPending = signal(false);
  const formStatus = signal<ValidationStatus>('idle');
  const submitting = signal(false);
  const submitted = signal(false);
  const submitSucceeded = signal(false);
  const submitFailure = signal<SubmissionFailure | null>(null);
  const submitCount = signal(0);
  let formController: AbortController | null = null;
  let formRelease: (() => void) | null = null;
  let formGeneration = 0;
  let submissionController: AbortController | null = null;
  let submissionRelease: (() => void) | null = null;
  let submissionGeneration = 0;
  const formTriggers = new Set(options.formValidateOn ?? ['submit']);
  const fieldTriggers = options.validateOn ?? ['blur', 'submit'];
  const visibility = options.errorVisibility ?? 'touched';

  function alive(): void {
    if (disposed || current === null) throw new Error('Form has been disposed');
  }
  function valuesNow(): T { alive(); return current as T; }
  function snapshot(): T { return copyValue(valuesNow()); }
  function touchRevision(): void { revision.value++; }
  function invalidateForm(): void {
    formGeneration++;
    formController?.abort(); formController = null;
    formRelease?.(); formRelease = null;
    formPending.value = false; formStatus.value = 'idle';
    formIssues.value = [];
    for (const rec of records) rec.crossIssues.value = [];
  }
  function cancelField(rec: FieldRecord<T>): void {
    rec.generation++;
    rec.controller?.abort(); rec.controller = null;
    rec.release?.(); rec.release = null;
    rec.pending.value = false;
  }
  function disposeField(rec: FieldRecord<T>): void {
    if (rec.disposed) return;
    cancelField(rec);
    rec.disposed = true;
    records.delete(rec);
    byPath.delete(rec.path.peek());
    batch(() => {
      rec.value.value = undefined;
      rec.initial.value = undefined;
      rec.fieldIssues.value = [];
      rec.crossIssues.value = [];
      rec.serverIssues.value = [];
      registryRevision.value++;
    });
  }
  function handleFieldChange(rec: FieldRecord<T>, previous: unknown, next: unknown): void {
    if (sameValue(previous, next)) return;
    cancelField(rec);
    rec.status.value = 'idle';
    rec.fieldIssues.value = [];
    rec.serverIssues.value = [];
    if (rec.triggers.has('change') && !rec.disabled.peek()) void validateRecord(rec).catch(() => undefined);
  }
  function refreshRecords(changedPath: string, revalidate = true): Set<FieldRecord<T>> {
    const changed = new Set<FieldRecord<T>>();
    for (const rec of [...records]) {
      const path = rec.path.peek();
      if (!overlaps(path, changedPath)) continue;
      const next = readPath(valuesNow(), path);
      const previous = rec.value.peek();
      if (sameValue(previous, next)) continue;
      changed.add(rec);
      rec.value.value = copyValue(next);
      if (revalidate) handleFieldChange(rec, previous, next);
    }
    return changed;
  }
  function validateDependents(path: string, refreshed: ReadonlySet<FieldRecord<T>>): void {
    for (const rec of records) {
      if (rec.disposed || rec.disabled.peek() || refreshed.has(rec)) continue;
      if (!rec.dependencies.some(dependency => overlaps(dependency, path))) continue;
      // Even if change validation was not requested, an old async result
      // may no longer be valid for the declared cross-field dependency.
      cancelField(rec);
      rec.status.value = 'idle';
      rec.fieldIssues.value = [];
      rec.serverIssues.value = [];
      if (rec.triggers.has('change')) void validateRecord(rec).catch(() => undefined);
    }
  }
  function validateChangedDependencies(before: T, after: T, refreshed: ReadonlySet<FieldRecord<T>>): void {
    for (const rec of records) {
      if (rec.disposed || rec.disabled.peek() || refreshed.has(rec)) continue;
      if (!rec.dependencies.some(path => !sameValue(readPath(before, path), readPath(after, path)))) continue;
      cancelField(rec);
      rec.status.value = 'idle';
      rec.fieldIssues.value = [];
      rec.serverIssues.value = [];
      if (rec.triggers.has('change')) void validateRecord(rec).catch(() => undefined);
    }
  }
  function mutate(path: string, value: unknown): void {
    alive(); splitPath(path);
    const old = valuesNow();
    const updated = writePath(old, path, copyValue(value));
    // Structural changes to ANY registered descendant array must go through
    // the keyed array API. Checking the exact path alone misses parent writes.
    for (const arr of arrays.values()) {
      if (arr.disposed) continue;
      const arrayPath = arr.path.peek();
      if (!overlaps(arrayPath, path)) continue;
      const before = readPath(old, arrayPath);
      const after = readPath(updated, arrayPath);
      if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
        throw new Error('Use keyed array insert/remove for structural changes');
      }
    }
    if (sameValue(old, updated)) return;
    batch(() => {
      current = updated;
      invalidateForm();
      const changed = refreshRecords(path);
      validateDependents(path, changed);
      touchRevision();
      if (formTriggers.has('change')) void validateFormOnly().catch(() => undefined);
    });
  }
  function createField<P extends FieldPath<T>>(path: P, configuration: FieldOptions<T, PathValue<T, P>> = {}): FieldHandle<T, P> {
    alive(); splitPath(path);
    if (!hasPath(valuesNow(), path)) throw new RangeError('Field path does not exist in current values');
    const existing = byPath.get(path);
    if (existing) return makeFieldHandle<P>(existing);
    const raw = copyValue(readPath(valuesNow(), path));
    const rec: FieldRecord<T> = {
      id: `field-${++nextId}`, path: signal<string>(path), value: signal<unknown>(raw),
      initial: signal<unknown>(copyValue(readPath(initial, path))),
      touched: signal(false), disabled: signal(configuration.disabled ?? false),
      fieldIssues: signal([]), crossIssues: signal([]), serverIssues: signal([]),
      pending: signal(false), status: signal<ValidationStatus>('idle'),
      validators: (configuration.validators ?? []).map(validator =>
        (value, context) => validator(value as PathValue<T, P>, context)),
      dependencies: [...(configuration.dependencies ?? [])],
      triggers: new Set(configuration.validateOn ?? fieldTriggers),
      required: configuration.required ?? false,
      generation: 0, controller: null, release: null, disposed: false
    };
    records.add(rec); byPath.set(path, rec); registryRevision.value++;
    return makeFieldHandle<P>(rec);
  }
  function makeFieldHandle<P extends FieldPath<T>>(rec: FieldRecord<T>): FieldHandle<T, P> {
    const read = (): void => { if (rec.disposed) throw new Error('Field has been disposed'); alive(); };
    const fieldErrors = computed(() => [...rec.fieldIssues.value, ...rec.crossIssues.value, ...rec.serverIssues.value]);
    const value: WritableSignal<PathValue<T, P>> = {
      get value() { read(); return copyValue(rec.value.value) as PathValue<T, P>; },
      set value(next) { read(); mutate(rec.path.peek(), next); },
      peek() { read(); return copyValue(rec.value.peek()) as PathValue<T, P>; }
    };
    const visibleErrors = computed(() => {
      const errors = fieldErrors.value;
      if (visibility === 'always' || (visibility === 'touched' && rec.touched.value) || (visibility === 'submitted' && submitCount.value > 0)) return errors;
      return [];
    });
    return {
      id: rec.id,
      path: computed(() => rec.path.value),
      value,
      initialValue: {
        get value() { read(); return copyValue(rec.initial.value) as PathValue<T, P>; },
        peek() { read(); return copyValue(rec.initial.peek()) as PathValue<T, P>; }
      },
      dirty: computed(() => !sameValue(rec.value.value, rec.initial.value)),
      pristine: computed(() => sameValue(rec.value.value, rec.initial.value)),
      touched: computed(() => rec.touched.value),
      untouched: computed(() => !rec.touched.value),
      errors: fieldErrors,
      visibleErrors,
      pending: computed(() => rec.pending.value),
      disabled: computed(() => rec.disabled.value),
      status: computed(() => rec.status.value),
      ariaInvalid: computed(() => visibleErrors.value.length > 0),
      ariaRequired: computed(() => rec.required !== false),
      blur: () => {
        read(); rec.touched.value = true;
        if (rec.triggers.has('blur') && !rec.disabled.peek()) void validateRecord(rec).catch(() => undefined);
        if (formTriggers.has('blur')) void validateFormOnly().catch(() => undefined);
      },
      setDisabled: (next) => {
        read(); rec.disabled.value = next;
        if (next) { cancelField(rec); rec.fieldIssues.value = []; rec.crossIssues.value = []; rec.serverIssues.value = []; rec.status.value = 'idle'; }
      },
      validate: (request) => { read(); return validateRecord(rec, request?.signal); },
      dispose: () => disposeField(rec)
    };
  }
  async function validateRecord(rec: FieldRecord<T>, external?: AbortSignal): Promise<ValidationResult> {
    alive();
    cancelField(rec);
    const generation = rec.generation;
    if (rec.disabled.peek()) {
      rec.fieldIssues.value = []; rec.status.value = 'valid';
      return result('valid');
    }
    const controller = new AbortController();
    const linked = linkAbort(controller, external, validationTimeoutMs);
    rec.controller = controller; rec.release = linked.release;
    const issues: ValidationIssue[] = [];
    const path = rec.path.peek();
    const value = copyValue(rec.value.peek());
    const context = { path, values: snapshot() as Readonly<T>, signal: controller.signal };
    const required = rec.required;
    if (required && isRequiredEmpty(value)) issues.push({ code: 'required', message: typeof required === 'string' ? required : 'Required', path, source: 'field' });
    try {
      for (const validator of rec.validators) {
        if (controller.signal.aborted) break;
        const output = validator(value, context);
        if (isPromise(output)) {
          rec.pending.value = true;
          issues.push(...normalize(await abortable(Promise.resolve(output), controller.signal), 'field', path));
        } else issues.push(...normalize(output, 'field', path));
      }
      if (rec.generation !== generation || rec.disposed || disposed || controller.signal.aborted) {
        return result('cancelled');
      }
      rec.fieldIssues.value = issues;
      rec.status.value = issues.length ? 'invalid' : 'valid';
      return result(issues.length ? 'invalid' : 'valid', issues);
    } catch {
      if (rec.generation !== generation || rec.disposed || disposed || (controller.signal.aborted && !linked.timedOut())) return result('cancelled');
      const failure: ValidationIssue = { code: linked.timedOut() ? 'validation_timeout' : 'validation_unavailable', message: 'Validation could not be completed', source: 'system', path };
      rec.fieldIssues.value = [failure]; rec.status.value = 'error';
      return result('error', [failure]);
    } finally {
      if (rec.generation === generation) { rec.pending.value = false; rec.controller = null; rec.release = null; }
      linked.release();
    }
  }
  async function validateFormOnly(external?: AbortSignal): Promise<ValidationResult> {
    alive(); invalidateForm();
    const generation = formGeneration;
    if (!formValidators?.length) { formStatus.value = 'valid'; return result('valid'); }
    const controller = new AbortController();
    const linked = linkAbort(controller, external, validationTimeoutMs);
    formController = controller; formRelease = linked.release;
    const issues: ValidationIssue[] = [];
    const values = snapshot();
    try {
      for (const validator of formValidators) {
        if (controller.signal.aborted) break;
        const output = validator(values, { signal: controller.signal });
        if (isPromise(output)) {
          formPending.value = true;
          issues.push(...normalize(await abortable(Promise.resolve(output), controller.signal), 'form'));
        } else issues.push(...normalize(output, 'form'));
      }
      if (formGeneration !== generation || disposed || controller.signal.aborted) return result('cancelled');
      formIssues.value = issues.filter(issue => !issue.path || !byPath.has(issue.path));
      for (const rec of records) rec.crossIssues.value = issues.filter(issue => issue.path === rec.path.peek());
      formStatus.value = issues.length ? 'invalid' : 'valid';
      return result(issues.length ? 'invalid' : 'valid', issues);
    } catch {
      if (formGeneration !== generation || disposed || (controller.signal.aborted && !linked.timedOut())) return result('cancelled');
      const failure: ValidationIssue = { code: linked.timedOut() ? 'validation_timeout' : 'validation_unavailable', message: 'Form validation could not be completed', source: 'system' };
      formIssues.value = [failure]; formStatus.value = 'error';
      return result('error', [failure]);
    } finally {
      if (formGeneration === generation) { formPending.value = false; formController = null; formRelease = null; }
      linked.release();
    }
  }
  async function validateAll(external?: AbortSignal): Promise<ValidationResult> {
    alive();
    const validations = [...records].map(rec => validateRecord(rec, external));
    validations.push(validateFormOnly(external));
    const outcomes = await Promise.all(validations);
    const issues = outcomes.flatMap(outcome => outcome.issues);
    const status: CheckStatus = outcomes.some(x => x.status === 'error') ? 'error'
      : outcomes.some(x => x.status === 'cancelled') ? 'cancelled'
      : issues.length ? 'invalid' : 'valid';
    return result(status, issues);
  }
  function reindex(arrayPath: string, oldKeys: readonly string[], newKeys: readonly string[]): void {
    const newIndex = new Map(newKeys.map((key, index) => [key, index]));
    function remap(path: string): string | null {
      const position = pathInArray(path, arrayPath);
      if (!position) return path;
      const key = oldKeys[position.index];
      const index = key === undefined ? undefined : newIndex.get(key);
      return index === undefined ? null : `${arrayPath}.${index}${position.suffix}`;
    }
    function remapIssues(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
      return issues.map(issue => {
        if (!issue.path) return issue;
        const nextPath = remap(issue.path);
        return nextPath === null ? issue : nextPath === issue.path ? issue : { ...issue, path: nextPath };
      });
    }
    // Stage remaps before mutating maps: cyclic swaps must not clobber keys.
    const nested: { oldPath: string; arr: ArrayRecord; nextPath: string | null }[] = [];
    for (const [oldPath, arr] of arrays) {
      if (oldPath !== arrayPath && pathInArray(oldPath, arrayPath)) {
        nested.push({ oldPath, arr, nextPath: remap(oldPath) });
      }
    }
    for (const entry of nested) arrays.delete(entry.oldPath);
    for (const entry of nested) {
      if (entry.nextPath === null) { entry.arr.disposed = true; entry.arr.keys.value = []; continue; }
      entry.arr.path.value = entry.nextPath;
      arrays.set(entry.nextPath, entry.arr);
    }
    const staged: { rec: FieldRecord<T>; nextPath: string | null; previous: string }[] = [];
    for (const rec of records) {
      const previous = rec.path.peek();
      if (pathInArray(previous, arrayPath)) {
        staged.push({ rec, nextPath: remap(previous), previous });
      }
    }
    for (const entry of staged) byPath.delete(entry.previous);
    for (const { rec, nextPath, previous } of staged) {
      if (nextPath === null) { disposeField(rec); continue; }
      if (nextPath !== previous) {
        const wasPending = rec.pending.peek();
        cancelField(rec); // validators captured the old path and values snapshot
        if (wasPending) {
          rec.status.value = 'idle';
          rec.fieldIssues.value = [];
        } else {
          rec.fieldIssues.value = remapIssues(rec.fieldIssues.peek());
        }
        rec.serverIssues.value = remapIssues(rec.serverIssues.peek());
        // Dependencies within this same keyed item follow its identity.
        const previousItem = pathInArray(previous, arrayPath);
        if (previousItem) {
          const oldPrefix = `${arrayPath}.${previousItem.index}`;
          const nextPrefix = `${arrayPath}.${pathInArray(nextPath, arrayPath)!.index}`;
          for (let i = 0; i < rec.dependencies.length; i++) {
            const dependency = rec.dependencies[i]!;
            if (dependency === oldPrefix || dependency.startsWith(oldPrefix + '.')) {
              rec.dependencies[i] = nextPrefix + dependency.slice(oldPrefix.length);
            }
          }
        }
        rec.path.value = nextPath;
      }
    }
    for (const rec of records) byPath.set(rec.path.peek(), rec);
    registryRevision.value++;
  }

  function createArray<P extends FieldPath<T>>(path: P): ArrayHandle<T, P> {
    alive(); splitPath(path);
    const contents = readPath(valuesNow(), path);
    if (!Array.isArray(contents)) throw new TypeError('Array registration requires an array value');
    let arr = arrays.get(path);
    if (!arr) {
      const keys = contents.map(() => `item-${++nextId}`);
      arr = { path: signal<string>(path), keys: signal<readonly string[]>(Object.freeze(keys)), initialKeys: [...keys], disposed: false };
      arrays.set(path, arr);
    }
    const record = arr;
    function check(): unknown[] {
      alive(); if (record.disposed) throw new Error('Array has been disposed');
      const data = readPath(valuesNow(), record.path.peek());
      if (!Array.isArray(data)) throw new TypeError('Registered array is no longer an array');
      return data;
    }
    function replace(next: unknown[], keys: string[]): void {
      const pathNow = record.path.peek();
      const oldKeys = record.keys.peek();
      const updated = writePath(valuesNow(), pathNow, next);
      batch(() => {
        current = updated;
        invalidateForm();
        reindex(pathNow, oldKeys, keys);
        record.keys.value = Object.freeze(keys);
        const changed = refreshRecords(pathNow);
        validateDependents(pathNow, changed);
        touchRevision();
        if (formTriggers.has('change')) void validateFormOnly().catch(() => undefined);
      });
    }
    const handle: ArrayHandle<T, P> = {
      path: computed(() => record.path.value),
      keys: computed(() => record.keys.value),
      insert(index, value) {
        const data = check();
        if (!Number.isSafeInteger(index) || index < 0 || index > data.length) throw new RangeError('Insert index out of bounds');
        const key = `item-${++nextId}`;
        const keys = [...record.keys.peek()]; keys.splice(index, 0, key);
        const next = [...data]; next.splice(index, 0, copyValue(value)); replace(next, keys);
        return key;
      },
      append(value) { return handle.insert(check().length, value); },
      remove(index) {
        const data = check();
        if (!Number.isSafeInteger(index) || index < 0 || index >= data.length) throw new RangeError('Remove index out of bounds');
        const keys = [...record.keys.peek()]; keys.splice(index, 1);
        const next = [...data]; next.splice(index, 1); replace(next, keys);
      },
      move(from, to) {
        const data = check();
        if (![from, to].every(n => Number.isSafeInteger(n) && n >= 0 && n < data.length)) throw new RangeError('Move index out of bounds');
        if (from === to) return;
        const next = [...data]; const keys = [...record.keys.peek()];
        next.splice(to, 0, next.splice(from, 1)[0]);
        keys.splice(to, 0, keys.splice(from, 1)[0]!);
        replace(next, keys);
      }
    };
    return handle;
  }
  function setAll(values: T, setBaseline: boolean, restoreInitialKeys = false): void {
    alive();
    const old = valuesNow();
    const next = copyValue(values);
    // A nested array may disappear because an ancestor item was removed.
    // Otherwise registered array shapes must be preserved, atomically.
    const registered = [...arrays.values()].filter(arr => !arr.disposed)
      .sort((a, b) => splitPath(a.path.peek()).length - splitPath(b.path.peek()).length);
    for (const arr of registered) {
      const path = arr.path.peek();
      if (Array.isArray(readPath(next, path))) continue;
      const removedWithParent = registered.some(parent => {
        const parentPath = parent.path.peek();
        if (parentPath === path) return false;
        const pos = pathInArray(path, parentPath);
        const newParent = readPath(next, parentPath);
        return pos !== null && Array.isArray(newParent) && pos.index >= newParent.length;
      });
      if (!removedWithParent) throw new TypeError('Updated values must preserve registered arrays');
    }
    // Process parent arrays before their children so nested registrations
    // follow stable keys and removed descendants are disposed deterministically.
    batch(() => {
      current = next;
      invalidateForm();
      for (const arr of registered) {
        if (arr.disposed) continue;
        const path = arr.path.peek();
        const updated = readPath(next, path);
        if (!Array.isArray(updated)) throw new TypeError('Updated values must preserve registered arrays');
        const oldKeys = arr.keys.peek();
        const newKeys = restoreInitialKeys && arr.initialKeys.length === updated.length
          ? [...arr.initialKeys]
          : Array.from({ length: updated.length }, (_, index) => oldKeys[index] ?? `item-${++nextId}`);
        reindex(path, oldKeys, newKeys);
        arr.keys.value = Object.freeze(newKeys);
        if (setBaseline) arr.initialKeys = [...newKeys];
      }
      const refreshed = new Set<FieldRecord<T>>();
      for (const rec of records) {
        const value = readPath(next, rec.path.peek());
        const prev = rec.value.peek();
        rec.value.value = copyValue(value);
        if (!sameValue(prev, value)) refreshed.add(rec);
        if (setBaseline) rec.initial.value = copyValue(value);
        if (setBaseline) {
          cancelField(rec); rec.touched.value = false; rec.status.value = 'idle';
          rec.fieldIssues.value = []; rec.crossIssues.value = []; rec.serverIssues.value = [];
        } else handleFieldChange(rec, prev, value);
      }
      if (!setBaseline) validateChangedDependencies(old, next, refreshed);
      if (setBaseline) initial = copyValue(next);
      touchRevision();
      if (!setBaseline && formTriggers.has('change')) void validateFormOnly().catch(() => undefined);
    });
  }
  let form: FormController<T, TResult>;
  function abortSubmission(): void {
    submissionGeneration++;
    submissionController?.abort(); submissionController = null;
    submissionRelease?.(); submissionRelease = null;
    submitting.value = false;
  }
  async function doSubmit(external?: AbortSignal): Promise<SubmitResult<TResult>> {
    alive();
    if (submitting.peek()) return { status: 'duplicate' };
    const valuesRevision = revision.peek();
    submitCount.value++;
    submitting.value = true;
    submitted.value = false; submitSucceeded.value = false; submitFailure.value = null;
    for (const rec of records) rec.serverIssues.value = [];
    const controller = new AbortController();
    const linked = linkAbort(controller, external, submitTimeoutMs);
    const generation = ++submissionGeneration;
    submissionController = controller; submissionRelease = linked.release;
    try {
      const validation = await abortable(validateAll(controller.signal), controller.signal);
      if (submissionGeneration !== generation || disposed || controller.signal.aborted || revision.peek() !== valuesRevision || validation.status === 'cancelled') return { status: 'aborted' };
      if (!validation.valid) {
        submitted.value = true;
        return { status: 'invalid', issues: validation.issues };
      }
      if (!onSubmit) throw new Error('Submission handler not configured');
      const output = await abortable(Promise.resolve().then(() => onSubmit!(snapshot(), { signal: controller.signal })), controller.signal);
      if (submissionGeneration !== generation || disposed || controller.signal.aborted) return { status: 'aborted' };
      submitted.value = true; submitSucceeded.value = true;
      return { status: 'success', value: output };
    } catch (error) {
      if (submissionGeneration !== generation || disposed || (controller.signal.aborted && !linked.timedOut())) return { status: 'aborted' };
      if (error instanceof SubmissionValidationError) {
        // Do not attach errors from a previous submitted snapshot to
        // the user's newer in-progress edits.
        if (revision.peek() === valuesRevision) {
          for (const rec of records) rec.serverIssues.value = error.issues.filter(issue => issue.path === rec.path.peek());
          formIssues.value = [...formIssues.peek(), ...error.issues.filter(issue => !issue.path || !byPath.has(issue.path))];
        }
        submitted.value = true;
        const failure: SubmissionFailure = { kind: 'domain', message: 'Submission rejected by server validation' };
        submitFailure.value = failure;
        return { status: 'invalid', issues: error.issues };
      }
      submitted.value = true;
      const failure: SubmissionFailure = { kind: 'transport', message: linked.timedOut() ? 'Submission timed out' : 'Submission failed' };
      submitFailure.value = failure;
      return { status: 'failed', failure };
    } finally {
      if (generation === submissionGeneration) {
        submitting.value = false; submissionController = null; submissionRelease = null;
      }
      linked.release();
    }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    abortSubmission();
    invalidateForm();
    for (const rec of [...records]) disposeField(rec);
    arrays.clear(); byPath.clear(); records.clear();
    initial = null; current = null;
    revision.value++; registryRevision.value++;
    formIssues.value = [];
  }
  form = {
    // An uncached signal facade prevents form snapshots being retained by a
    // computed's memoized value after owner disposal.
    values: {
      get value() { revision.value; return snapshot() as Readonly<T>; },
      peek() { revision.peek(); return snapshot() as Readonly<T>; }
    },
    dirty: computed(() => { revision.value; return !sameValue(valuesNow(), initial); }),
    valid: computed(() => {
      registryRevision.value;
      return !formPending.value && formStatus.value !== 'error' && formStatus.value !== 'invalid' && formIssues.value.length === 0 &&
        [...records].every(rec => rec.disabled.value || (!rec.pending.value && rec.status.value !== 'invalid' && rec.status.value !== 'error' &&
          rec.fieldIssues.value.length + rec.crossIssues.value.length + rec.serverIssues.value.length === 0));
    }),
    pendingValidation: computed(() => { registryRevision.value; return formPending.value || [...records].some(rec => rec.pending.value); }),
    submitting: computed(() => submitting.value),
    submitted: computed(() => submitted.value),
    submitSucceeded: computed(() => submitSucceeded.value),
    submitFailure: computed(() => submitFailure.value),
    submitCount: computed(() => submitCount.value),
    errors: computed(() => {
      registryRevision.value;
      return [...formIssues.value, ...[...records].flatMap(rec =>
        [...rec.fieldIssues.value, ...rec.crossIssues.value, ...rec.serverIssues.value])];
    }),
    field: createField,
    group<P extends FieldPath<T>>(path: P): FieldGroup<T, P> {
      alive(); splitPath(path);
      return {
        path,
        value: {
          get value() { revision.value; return copyValue(readPath(valuesNow(), path)) as PathValue<T, P>; },
          peek() { revision.peek(); return copyValue(readPath(valuesNow(), path)) as PathValue<T, P>; }
        },
        field<C extends FieldPath<PathValue<T, P>>>(child: C, configuration?: FieldOptions<T, PathValue<PathValue<T, P>, C>>) {
          const combined = `${path}.${child}` as Extract<`${P}.${C}`, FieldPath<T>>;
          return createField(combined, configuration as FieldOptions<T, PathValue<T, typeof combined>>);
        }
      };
    },
    array: createArray,
    getValue<P extends FieldPath<T>>(path: P): PathValue<T, P> {
      return copyValue(readPath(valuesNow(), path)) as PathValue<T, P>;
    },
    setValue: mutate,
    setValues(values: T) { setAll(values, false); },
    validate: (request?: { readonly signal?: AbortSignal }) => validateAll(request?.signal),
    validateField<P extends FieldPath<T>>(path: P, request?: { readonly signal?: AbortSignal }) {
      return validateRecord(byPath.get(path) ?? (() => { createField(path); return byPath.get(path)!; })(), request?.signal);
    },
    reset(values?: T) {
      alive(); abortSubmission();
      submitted.value = false; submitSucceeded.value = false; submitFailure.value = null; submitCount.value = 0;
      setAll(values === undefined ? copyValue(initial as T) : values, true, values === undefined);
    },
    submit: (request?: { readonly signal?: AbortSignal }) => doSubmit(request?.signal),
    abortSubmit: abortSubmission,
    dispose
  };
  const owner = options.owner === undefined ? getOwner() : options.owner;
  if (owner) {
    if (owner.disposed) { form.dispose(); throw new Error('Cannot attach form to a disposed owner'); }
    try { runWithOwner(owner, () => onCleanup(form.dispose)); }
    catch (error) { form.dispose(); throw error; }
  }
  return form;
}
