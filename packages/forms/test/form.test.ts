import { describe, expect, it, vi } from 'vitest';
import { createOwner, disposeOwner, runWithOwner } from '@zaakiyjs/core';
import { effect, flushSync } from '@zaakiyjs/signals';
import { createForm, SubmissionValidationError } from '../src/index.js';

interface Values {
  email: string;
  password: string;
  confirm: string;
  profile: { name: string };
  items: { label: string; tags: string[] }[];
}
const defaults = (): Values => ({ email: '', password: '', confirm: '', profile: { name: '' }, items: [
  { label: 'A', tags: ['x'] }, { label: 'B', tags: ['y'] }
] });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('@zaakiyjs/forms', () => {
  it('tracks fine-grained value, dirty, touched, required and reset state', async () => {
    const form = createForm({ initialValues: defaults() });
    const email = form.field('email', { required: 'Enter email' });
    expect(email.value.value).toBe('');
    expect(email.dirty.value).toBe(false);
    expect(form.dirty.value).toBe(false);
    expect(email.touched.value).toBe(false);
    email.value.value = 'hello';
    expect(email.dirty.value).toBe(true);
    expect(form.dirty.value).toBe(true);
    email.blur();
    expect(email.touched.value).toBe(true);
    await email.validate();
    expect(email.status.value).toBe('valid');
    form.reset();
    expect(email.value.value).toBe('');
    expect(email.dirty.value).toBe(false);
    expect(email.touched.value).toBe(false);
    expect(form.submitCount.value).toBe(0);
    form.dispose();
    expect(() => email.value.value).toThrow('disposed');
  });

  it('runs only requested/triggered validators and returns structured issues', async () => {
    const a = vi.fn((v: string) => v ? undefined : 'Email required');
    const b = vi.fn((v: string) => v ? undefined : 'Password required');
    const form = createForm({ initialValues: defaults() });
    const email = form.field('email', { validators: [a], validateOn: ['change'] });
    form.field('password', { validators: [b], validateOn: ['blur'] });
    email.value.value = 'a';
    await Promise.resolve();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    email.value.value = '';
    const validated = await email.validate();
    expect(validated.status).toBe('invalid');
    expect(validated.issues[0]).toMatchObject({ code: 'invalid', path: 'email', message: 'Email required', source: 'field' });
    form.dispose();
  });

  it('exposes visible errors, aria flags and disabled behavior', async () => {
    const form = createForm({ initialValues: defaults(), errorVisibility: 'touched' });
    const email = form.field('email', { required: true });
    await email.validate();
    expect(email.errors.value.length).toBe(1);
    expect(email.visibleErrors.value).toEqual([]);
    email.blur();
    expect(email.ariaInvalid.value).toBe(true);
    expect(email.ariaRequired.value).toBe(true);
    email.setDisabled(true);
    expect(email.disabled.value).toBe(true);
    expect(email.ariaInvalid.value).toBe(false);
    const validation = await email.validate();
    expect(validation.valid).toBe(true);
    form.dispose();
  });

  it('validates nested paths and groups, and permits typed setValues', () => {
    const form = createForm({ initialValues: defaults() });
    const profile = form.group('profile');
    const name = profile.field('name');
    name.value.value = 'X';
    expect(form.getValue('profile.name')).toBe('X');
    expect(profile.value.value.name).toBe('X');
    form.setValue('profile.name', 'Y');
    expect(name.value.value).toBe('Y');
    form.setValues({ ...defaults(), profile: { name: 'Z' } });
    expect(name.value.value).toBe('Z');
    form.dispose();
  });

  it('supports explicit cross-field dependencies without rerunning unrelated validators', async () => {
    const password = vi.fn(() => undefined);
    const match = vi.fn((v: string, context: { values: Values }) => v === context.values.password ? undefined : 'Mismatch');
    const form = createForm({ initialValues: defaults() });
    form.field('email', { validators: [password], validateOn: ['change'] });
    const confirm = form.field('confirm', { validators: [match], dependencies: ['password'], validateOn: ['change'] });
    form.setValue('password', 'secret');
    await Promise.resolve();
    expect(match).toHaveBeenCalledTimes(1);
    expect(password).not.toHaveBeenCalled();
    expect(confirm.errors.value[0]?.message).toBe('Mismatch');
    form.dispose();
  });

  it('applies form-level cross-field issues to registered fields', async () => {
    const form = createForm({
      initialValues: defaults(),
      validators: [values => values.password === values.confirm ? undefined :
        { code: 'mismatch', message: 'Confirmation differs', path: 'confirm', source: 'form' as const }]
    });
    const confirm = form.field('confirm');
    form.setValue('password', 'pass');
    const validated = await form.validate();
    expect(validated.valid).toBe(false);
    expect(confirm.errors.value[0]?.source).toBe('form');
    expect(form.errors.value.length).toBe(1);
    form.setValue('confirm', 'pass');
    expect((await form.validate()).valid).toBe(true);
    form.dispose();
  });

  it('aborts a superseded validator and rejects stale completions', async () => {
    const jobs: Array<{ signal: AbortSignal; job: ReturnType<typeof deferred<string | undefined>> }> = [];
    const form = createForm({ initialValues: defaults() });
    const email = form.field('email', { validateOn: ['change'], validators: [(_value, { signal }) => {
      const job = deferred<string | undefined>(); jobs.push({ signal, job }); return job.promise;
    }] });
    email.value.value = 'first';
    expect(email.pending.value).toBe(true);
    email.value.value = 'second';
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.signal.aborted).toBe(true);
    jobs[1]!.job.resolve(undefined);
    await vi.waitFor(() => expect(email.status.value).toBe('valid'));
    jobs[0]!.job.resolve('stale error');
    await Promise.resolve();
    expect(email.errors.value).toEqual([]);
    form.dispose();
  });

  it('distinguishes validator errors and aborts', async () => {
    const form = createForm({ initialValues: defaults() });
    const invalid = form.field('email', { validators: [() => Promise.reject(new Error('secret backend error'))] });
    const bad = await invalid.validate();
    expect(bad.status).toBe('error');
    expect(bad.issues[0]?.code).toBe('validation_unavailable');
    expect(JSON.stringify(bad)).not.toContain('secret');
    form.dispose();
  });

  it('enforces a validator timeout even for non-cooperative promises', async () => {
    vi.useFakeTimers();
    try {
      const form = createForm({ initialValues: defaults(), validationTimeoutMs: 100 });
      const pending = form.field('email', { validators: [() => new Promise(() => undefined)] });
      const validation = pending.validate();
      await vi.advanceTimersByTimeAsync(101);
      const outcome = await validation;
      expect(outcome.status).toBe('error');
      expect(outcome.issues[0]?.code).toBe('validation_timeout');
      form.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('keeps keyed identities and field state through insertion and reorder', () => {
    const form = createForm({ initialValues: defaults() });
    const array = form.array('items');
    const b = form.field('items.1.label');
    b.blur();
    const initialKeys = [...array.keys.value];
    const addedKey = array.insert(0, { label: 'NEW', tags: [] });
    expect(array.keys.value).toEqual([addedKey, ...initialKeys]);
    expect(b.path.value).toBe('items.2.label');
    expect(b.value.value).toBe('B');
    expect(b.touched.value).toBe(true);
    array.move(2, 1);
    expect(b.path.value).toBe('items.1.label');
    expect(b.value.value).toBe('B');
    expect(array.keys.value[1]).toBe(initialKeys[1]);
    array.remove(0);
    expect(b.path.value).toBe('items.0.label');
    expect(b.id).toMatch(/^field-/);
    form.dispose();
  });

  it('disposes removed item fields and restores array structures on reset', () => {
    const form = createForm({ initialValues: defaults() });
    const array = form.array('items');
    const original = [...array.keys.value];
    const removed = form.field('items.0.label');
    array.remove(0);
    expect(() => removed.value.value).toThrow('disposed');
    array.append({ label: 'C', tags: [] });
    form.reset();
    expect(form.getValue('items').map(x => x.label)).toEqual(['A', 'B']);
    expect(array.keys.value).toEqual(original);
    form.dispose();
  });

  it('reindexes nested arrays without dropping array registrations on cyclic moves', () => {
    const form = createForm({ initialValues: defaults() });
    const outer = form.array('items');
    const firstTags = form.array('items.0.tags');
    const secondTags = form.array('items.1.tags');
    outer.move(0, 1);
    expect(firstTags.path.value).toBe('items.1.tags');
    expect(secondTags.path.value).toBe('items.0.tags');
    firstTags.append('z');
    expect(form.getValue('items.1.tags')).toEqual(['x', 'z']);
    form.dispose();
  });


  it('preserves field errors with corrected paths across keyed moves', async () => {
    const form = createForm({ initialValues: defaults() });
    const array = form.array('items');
    const label = form.field('items.1.label', { validators: [() => 'Not allowed'] });
    expect((await label.validate()).status).toBe('invalid');
    expect(label.errors.value[0]?.path).toBe('items.1.label');
    array.move(1, 0);
    expect(label.path.value).toBe('items.0.label');
    expect(label.errors.value[0]?.path).toBe('items.0.label');
    expect(label.status.value).toBe('invalid');
    form.dispose();
  });

  it('aborts a pending validator captured at the prior item path during reorder', async () => {
    const deferredValidation = deferred<string | undefined>();
    let observedSignal: AbortSignal | undefined;
    const form = createForm({ initialValues: defaults() });
    const array = form.array('items');
    const field = form.field('items.0.label', { validators: [(_v, { signal }) => {
      observedSignal = signal;
      return deferredValidation.promise;
    }] });
    const validation = field.validate();
    expect(field.pending.value).toBe(true);
    array.move(0, 1);
    expect(observedSignal?.aborted).toBe(true);
    expect((await validation).status).toBe('cancelled');
    expect(field.pending.value).toBe(false);
    deferredValidation.resolve('stale error');
    await Promise.resolve();
    expect(field.errors.value).toEqual([]);
    expect(field.path.value).toBe('items.1.label');
    form.dispose();
  });

  it('refreshes ancestor field signals when a keyed array changes', () => {
    const form = createForm({ initialValues: defaults() });
    const items = form.field('items');
    const array = form.array('items');
    array.insert(0, { label: 'NEW', tags: [] });
    expect(items.value.value.map(x => x.label)).toEqual(['NEW', 'A', 'B']);
    expect(items.dirty.value).toBe(true);
    form.reset();
    expect(items.value.value.map(x => x.label)).toEqual(['A', 'B']);
    form.dispose();
  });

  it('rejects structural writes through parents of keyed nested arrays atomically', () => {
    const form = createForm({ initialValues: defaults() });
    const nested = form.array('items.0.tags');
    expect(() => form.setValue('items.0', { label: 'Replaced', tags: ['x', 'y'] })).toThrow('keyed array');
    expect(form.getValue('items.0.label')).toBe('A');
    expect(nested.keys.value).toHaveLength(1);
    form.setValue('items.0', { label: 'Edited', tags: ['y'] });
    expect(nested.keys.value).toHaveLength(1);
    expect(form.getValue('items.0.label')).toBe('Edited');
    form.dispose();
  });

  it('removes nested keyed-array registrations when setValues deletes their parent item', () => {
    const form = createForm({ initialValues: defaults() });
    form.array('items');
    const nested = form.array('items.1.tags');
    form.setValues({ ...defaults(), items: [{ label: 'A2', tags: ['x'] }] });
    expect(form.getValue('items')).toHaveLength(1);
    expect(() => nested.append('bad')).toThrow('disposed');
    form.reset();
    expect(form.getValue('items')).toHaveLength(2);
    form.dispose();
  });

  it('cancels validations when declared dependencies change without a change trigger', async () => {
    const pending = deferred<string | undefined>();
    const form = createForm({ initialValues: defaults() });
    const confirm = form.field('confirm', {
      dependencies: ['password'],
      validateOn: ['submit'],
      validators: [() => pending.promise]
    });
    const first = confirm.validate();
    form.setValue('password', 'changed');
    expect((await first).status).toBe('cancelled');
    pending.resolve('stale result');
    await Promise.resolve();
    expect(confirm.errors.value).toEqual([]);
    expect(confirm.status.value).toBe('idle');
    form.dispose();
  });


  it('defensively copies object-valued field and group reads and freezes array keys', () => {
    const form = createForm({ initialValues: defaults() });
    const profile = form.field('profile');
    const group = form.group('profile');
    const array = form.array('items');
    const fieldSnapshot = profile.value.value;
    fieldSnapshot.name = 'mutated outside signals';
    expect(form.getValue('profile.name')).toBe('');
    const groupSnapshot = group.value.value;
    groupSnapshot.name = 'mutated group';
    expect(form.getValue('profile.name')).toBe('');
    const initialSnapshot = profile.initialValue.value;
    initialSnapshot.name = 'mutated baseline';
    expect(profile.initialValue.value.name).toBe('');
    expect(Object.isFrozen(array.keys.value)).toBe(true);
    expect(() => (array.keys.value as string[]).push('corrupt')).toThrow();
    expect(array.keys.value).toHaveLength(2);
    form.dispose();
  });

  it('does not attach old server validation errors after the user edits submitted values', async () => {
    const remote = deferred<never>();
    const form = createForm({ initialValues: defaults(), onSubmit: () => remote.promise });
    const email = form.field('email');
    form.setValue('email', 'old@example.com');
    const submission = form.submit();
    await vi.waitFor(() => expect(form.submitting.value).toBe(true));
    await Promise.resolve(); await Promise.resolve();
    form.setValue('email', 'new@example.com');
    remote.reject(new SubmissionValidationError([{ code: 'taken', source: 'server', path: 'email', message: 'Old email taken' }]));
    expect((await submission).status).toBe('invalid');
    expect(email.errors.value).toEqual([]);
    expect(form.getValue('email')).toBe('new@example.com');
    form.dispose();
  });

  it('invalidates declared dependents after whole-form values are replaced', async () => {
    const job = deferred<string | undefined>();
    const form = createForm({ initialValues: defaults() });
    const confirm = form.field('confirm', { dependencies: ['password'], validateOn: ['submit'], validators: [() => job.promise] });
    const pending = confirm.validate();
    form.setValues({ ...defaults(), password: 'new password' });
    expect((await pending).status).toBe('cancelled');
    job.resolve('stale');
    await Promise.resolve();
    expect(confirm.errors.value).toEqual([]);
    expect(confirm.status.value).toBe('idle');
    form.dispose();
  });

  it('refuses to register a nonexistent runtime path', () => {
    const form = createForm({ initialValues: defaults() });
    expect(() => form.field('items.2.label')).toThrow('does not exist');
    expect(() => form.field('profile.unknown' as never)).toThrow('does not exist');
    form.dispose();
  });

  it('blocks structural replacement that would corrupt keyed array state', () => {
    const form = createForm({ initialValues: defaults() });
    form.array('items');
    expect(() => form.setValue('items', [])).toThrow('keyed array');
    expect(form.getValue('items')).toHaveLength(2);
    expect(() => form.setValue('__proto__' as never, {} as never)).toThrow('Unsafe');
    form.dispose();
  });

  it('submits a validated immutable snapshot once and returns a typed result', async () => {
    const onSubmit = vi.fn(async (values: Values) => ({ receipt: values.email }));
    const form = createForm({ initialValues: defaults(), onSubmit });
    form.field('email', { required: true });
    expect((await form.submit()).status).toBe('invalid');
    form.setValue('email', 'a@example.com');
    expect(await form.submit()).toEqual({ status: 'success', value: { receipt: 'a@example.com' } });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(form.submitted.value).toBe(true);
    expect(form.submitSucceeded.value).toBe(true);
    expect(form.submitCount.value).toBe(2);
    form.dispose();
  });

  it('blocks duplicate submissions without replaying mutations', async () => {
    const work = deferred<number>();
    const onSubmit = vi.fn(() => work.promise);
    const form = createForm({ initialValues: defaults(), onSubmit });
    const first = form.submit();
    expect(await form.submit()).toEqual({ status: 'duplicate' });
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    work.resolve(9);
    expect(await first).toEqual({ status: 'success', value: 9 });
    form.dispose();
  });

  it('maps domain errors to field errors while preserving values', async () => {
    const form = createForm({ initialValues: defaults(), onSubmit: async () => {
      throw new SubmissionValidationError([{ code: 'taken', message: 'Email taken', path: 'email', source: 'server' }]);
    } });
    const email = form.field('email');
    email.value.value = 'used@example.com';
    const outcome = await form.submit();
    expect(outcome.status).toBe('invalid');
    expect(form.submitFailure.value?.kind).toBe('domain');
    expect(email.errors.value[0]?.code).toBe('taken');
    expect(email.value.value).toBe('used@example.com');
    form.dispose();
  });


  it('times out a submission that ignores cancellation without leaving pending state', async () => {
    vi.useFakeTimers();
    try {
      const form = createForm({ initialValues: defaults(), submitTimeoutMs: 40, onSubmit: () => new Promise(() => undefined) });
      const submission = form.submit();
      await vi.advanceTimersByTimeAsync(41);
      expect(await submission).toEqual({ status: 'failed', failure: { kind: 'transport', message: 'Submission timed out' } });
      expect(form.submitting.value).toBe(false);
      expect(form.submitSucceeded.value).toBe(false);
      form.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('returns transport failure and requires explicit retry', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('private stacktrace'); });
    const form = createForm({ initialValues: defaults(), onSubmit });
    const failure = await form.submit();
    expect(failure).toEqual({ status: 'failed', failure: { kind: 'transport', message: 'Submission failed' } });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(form.getValue('email')).toBe('');
    form.dispose();
  });

  it('aborts submitted work, prevents late success, and releases pending state', async () => {
    const job = deferred<string>();
    let observedSignal: AbortSignal | undefined;
    const form = createForm({ initialValues: defaults(), onSubmit: (_values, { signal }) => {
      observedSignal = signal; return job.promise;
    } });
    const pending = form.submit();
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    form.abortSubmit();
    expect(observedSignal?.aborted).toBe(true);
    expect(await pending).toEqual({ status: 'aborted' });
    job.resolve('too late');
    await Promise.resolve();
    expect(form.submitSucceeded.value).toBe(false);
    form.dispose();
  });

  it('binds to an explicit or current synchronous Core owner and cancels on disposal', async () => {
    const owner = createOwner();
    const job = deferred<string>();
    let cancelled = false;
    let form!: ReturnType<typeof createForm<Values, string>>;
    runWithOwner(owner, () => {
      form = createForm({ initialValues: defaults(), onSubmit: (_values, { signal }) => {
        signal.addEventListener('abort', () => { cancelled = true; });
        return job.promise;
      } });
    });
    const pending = form.submit();
    await vi.waitFor(() => expect(form.submitting.value).toBe(true));
    await Promise.resolve(); await Promise.resolve();
    disposeOwner(owner);
    expect(await pending).toEqual({ status: 'aborted' });
    expect(cancelled).toBe(true);
    expect(() => form.getValue('email')).toThrow('disposed');
  });

  it('isolates independent forms and avoids unrelated reactive updates', () => {
    const first = createForm({ initialValues: defaults() });
    const second = createForm({ initialValues: defaults() });
    const firstEmail = first.field('email');
    const firstProfile = first.field('profile.name');
    const secondEmail = second.field('email');
    let unrelatedRuns = 0;
    const unrelated = effect(() => { firstProfile.value.value; secondEmail.value.value; unrelatedRuns++; });
    firstEmail.value.value = 'changed';
    flushSync();
    expect(unrelatedRuns).toBe(1);
    expect(secondEmail.value.value).toBe('');
    unrelated.dispose(); first.dispose(); second.dispose();
  });
});

describe('concurrent edit and submit safety', () => {
  it('never submits data that changed while async validation was pending', async () => {
    const validation = deferred<string | undefined>();
    const handler = vi.fn(async () => true);
    const form = createForm({ initialValues: defaults(), onSubmit: handler });
    form.field('email', { validators: [() => validation.promise] });
    const request = form.submit();
    form.setValue('email', 'edited');
    validation.resolve(undefined);
    expect(await request).toEqual({ status: 'aborted' });
    expect(handler).not.toHaveBeenCalled();
    form.dispose();
  });
});
