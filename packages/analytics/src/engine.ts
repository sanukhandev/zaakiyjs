import type {
  Analytics, AnalyticsOptions, AnalyticsRecordV1, AnalyticsProviderV1, AnalyticsIdentityV1,
  ConsentPurposeV1, EventMetadata, AnalyticsDiagnostics, TrackResultV1, EventSchema
} from './types.js';
import { safeMetadata, safeName, safePath, safeOpaqueId } from './privacy.js';

type EventMapConstraint<M> = { [K in keyof M]: EventMetadata };
interface Queued { readonly event: AnalyticsRecordV1; attempts: number }
interface Runtime {
  readonly id: string;
  readonly purpose: ConsentPurposeV1;
  readonly load: () => AnalyticsProviderV1 | Promise<AnalyticsProviderV1>;
  readonly queue: Queued[];
  provider?: AnalyticsProviderV1;
  opening?: Promise<AnalyticsProviderV1 | undefined>;
  sending?: Promise<void>;
  abort?: AbortController;
  flushAbort?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  allowed: boolean;
  revision: number;
}
function bounded(n: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const v = n ?? fallback;
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new RangeError('Invalid ' + name);
  return v;
}
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Analytics operation aborted'));
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(new Error('Analytics operation aborted')); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    work.then(x => { cleanup(); resolve(x); }, e => { cleanup(); reject(e); });
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function createAnalytics<M extends EventMapConstraint<M>>(options: AnalyticsOptions<M>): Analytics<M> {
  const consent = options?.consent;
  if (!consent || consent.schema !== 'zaakiy.consent/1' || typeof consent.can !== 'function' ||
      typeof consent.snapshot !== 'function' || typeof consent.subscribe !== 'function') {
    throw new TypeError('A frozen ConsentCapabilityV1 is required');
  }
  if (options.policy && (options.policy.version !== 1 || options.policy.requiredPurposes.length !== 1 ||
      options.policy.requiredPurposes[0] !== 'analytics')) throw new TypeError('Invalid analytics policy');
  const rate = options.policy?.sampleRate ?? options.sampleRate ?? 1;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new RangeError('Invalid sampleRate');
  const max = bounded(options.policy?.maxQueueSize ?? options.maxQueueSize, 256, 1, 10000, 'maxQueueSize');
  const batch = bounded(options.policy?.maxBatchSize ?? options.batchSize, 32, 1, max, 'batchSize');
  const interval = bounded(options.policy?.flushIntervalMs ?? options.flushIntervalMs, 5000, 0, 3600000, 'flushIntervalMs');
  const payloadMax = bounded(options.policy?.maxPayloadBytes, 16384, 128, 65536, 'maxPayloadBytes');
  const timeout = bounded(options.deliveryTimeoutMs, 10000, 100, 120000, 'deliveryTimeoutMs');
  const retries = bounded(options.maxRetries, 2, 0, 5, 'maxRetries');
  const retryDelay = bounded(options.retryDelayMs, 500, 0, 60000, 'retryDelayMs');
  const schemas = options.schemas;
  if (!schemas || typeof schemas !== 'object') throw new TypeError('Event schemas required');
  const fields = new Map<string, ReadonlySet<string>>();
  for (const [name, schema] of Object.entries(schemas)) {
    safeName(name);
    const spec = schema as EventSchema<EventMetadata> | undefined;
    if (!spec || typeof spec.validate !== 'function' || !Array.isArray(spec.fields) || spec.fields.length > 20 ||
        spec.fields.some(k => typeof k !== 'string')) throw new TypeError('Missing event schema fields: ' + name);
    const keys = new Set<string>(spec.fields);
    if (keys.size !== spec.fields.length) throw new TypeError('Duplicate metadata fields');
    safeMetadata(Object.fromEntries(spec.fields.map(k => [k, null])));
    fields.set(name, keys);
  }
  function permission(purpose: ConsentPurposeV1): boolean {
    try {
      const snap = consent.snapshot();
      return snap?.schema === 'zaakiy.consent/1' && Number.isSafeInteger(snap.revision) &&
        snap.grants?.[purpose]?.decision === 'granted' && snap.grants[purpose]?.purpose === purpose &&
        consent.can(purpose) === true;
    } catch { return false; }
  }
  const ids = new Set<string>();
  const runtimes: Runtime[] = (options.providers ?? []).map(spec => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(spec.id) || ids.has(spec.id) ||
        typeof spec.load !== 'function' || !['analytics','advertising','ad-personalization','functional-third-party','essential'].includes(spec.purpose)) {
      throw new TypeError('Invalid provider definition');
    }
    ids.add(spec.id);
    return { id: spec.id, purpose: spec.purpose, load: spec.load, queue: [], allowed: false, revision: 0 };
  });
  let disposed = false;
  let accepted = 0;
  let dropped = 0;
  let delivered = 0;
  let errors = 0;
  const dedup = new Set<string>();
  const retired = new WeakSet<AnalyticsProviderV1>();
  const disposalPromises = new Set<Promise<void>>();
  let disposing: Promise<void> | undefined;
  const onError = options.onError;
  function report(error: unknown, runtime: Runtime): void {
    errors++;
    try { onError?.(error, runtime.id); } catch { /* observational callback never escapes */ }
  }
  function retire(provider: AnalyticsProviderV1 | undefined, runtime: Runtime): void {
    if (!provider || retired.has(provider)) return;
    retired.add(provider);
    const job = Promise.resolve().then(() => provider.dispose()).catch(error => { report(error, runtime); });
    disposalPromises.add(job);
    void job.finally(() => disposalPromises.delete(job));
  }
  function clearTimer(runtime: Runtime): void {
    if (runtime.timer !== undefined) clearTimeout(runtime.timer);
    runtime.timer = undefined;
  }
  function permitted(runtime: Runtime): boolean {
    return !disposed && runtime.allowed && permission('analytics') && permission(runtime.purpose);
  }
  function schedule(runtime: Runtime, waitMs: number): void {
    if (!permitted(runtime) || runtime.timer !== undefined || runtime.queue.length === 0) return;
    runtime.timer = setTimeout(() => {
      runtime.timer = undefined;
      void flushOne(runtime);
    }, waitMs);
  }
  /** A late provider load is disposed even if its loading promise ignores AbortSignal. */
  function open(runtime: Runtime, revision: number, signal: AbortSignal): Promise<AnalyticsProviderV1 | undefined> {
    if (!permitted(runtime) || runtime.revision !== revision || signal.aborted) return Promise.resolve(undefined);
    if (runtime.provider) return Promise.resolve(runtime.provider);
    if (runtime.opening) return runtime.opening;
    const pending = (async () => {
      let provider: AnalyticsProviderV1 | undefined;
      let adopted = false;
      try {
        provider = await runtime.load();
        if (!provider || provider.version !== 1 || typeof provider.start !== 'function' ||
            typeof provider.send !== 'function' || typeof provider.flush !== 'function' ||
            typeof provider.dispose !== 'function') throw new TypeError('Invalid versioned provider');
        if (!permitted(runtime) || runtime.revision !== revision || signal.aborted) return undefined;
        await cancellable(Promise.resolve().then(() => provider!.start({ signal })), signal);
        if (!permitted(runtime) || runtime.revision !== revision || signal.aborted) return undefined;
        runtime.provider = provider;
        adopted = true;
        return provider;
      } finally {
        if (!adopted && provider && typeof provider.dispose === 'function') retire(provider, runtime);
      }
    })();
    runtime.opening = pending;
    void pending.finally(() => { if (runtime.opening === pending) runtime.opening = undefined; }).catch(() => {});
    return pending;
  }
  async function flushOne(runtime: Runtime): Promise<void> {
    if (runtime.sending) return runtime.sending;
    if (!permitted(runtime) || runtime.queue.length === 0) return;
    clearTimer(runtime);
    const revision = runtime.revision;
    const controller = new AbortController();
    runtime.abort = controller;
    const selected = runtime.queue.slice(0, batch);
    let failed = false;
    const sending = (async () => {
      const deadline = setTimeout(() => controller.abort('delivery-timeout'), timeout);
      try {
        const provider = await cancellable(open(runtime, revision, controller.signal), controller.signal);
        if (!provider || !permitted(runtime) || runtime.revision !== revision || controller.signal.aborted) return;
        await cancellable(Promise.resolve().then(() => provider.send(selected.map(x => x.event), controller.signal)), controller.signal);
        if (!permitted(runtime) || runtime.revision !== revision || controller.signal.aborted) return;
        const done = new Set(selected);
        for (let i = runtime.queue.length - 1; i >= 0; i--) if (done.has(runtime.queue[i]!)) runtime.queue.splice(i, 1);
        delivered += selected.length;
      } catch (error) {
        if (!permitted(runtime) || runtime.revision !== revision) return;
        failed = true;
        report(error, runtime);
        const exhausted = new Set(selected.filter(entry => ++entry.attempts > retries));
        for (let i = runtime.queue.length - 1; i >= 0; i--) {
          if (exhausted.has(runtime.queue[i]!)) { runtime.queue.splice(i, 1); dropped++; }
        }
      } finally { clearTimeout(deadline); }
    })();
    runtime.sending = sending;
    try { await sending; }
    finally {
      if (runtime.abort === controller) runtime.abort = undefined;
      if (runtime.sending === sending) runtime.sending = undefined;
      if (runtime.queue.length && permitted(runtime)) {
        const attempts = runtime.queue[0]?.attempts ?? 0;
        schedule(runtime, failed ? Math.min(60000, retryDelay * 2 ** Math.max(0, attempts - 1)) : interval);
      }
    }
  }
  function sanitize(input: AnalyticsRecordV1): AnalyticsRecordV1 {
    if (!isRecord(input) || input.schema !== 'zaakiy.analytics/1' || typeof input.name !== 'string' ||
        typeof input.timestampMs !== 'number' || !Number.isFinite(input.timestampMs) || input.timestampMs < 0 ||
        !['event','conversion','pageview','web-vital'].includes(String(input.kind))) throw new TypeError('Invalid analytics protocol');
    safeName(input.name);
    const properties = safeMetadata(input.properties ?? {});
    const dedupeKey = input.dedupeKey ? safeOpaqueId(input.dedupeKey) : undefined;
    const base = { schema: 'zaakiy.analytics/1' as const, name: input.name, timestampMs: input.timestampMs,
      ...(Object.keys(properties).length ? { properties } : {}), ...(dedupeKey ? { dedupeKey } : {}) };
    let output: AnalyticsRecordV1;
    switch (input.kind) {
      case 'event': {
        const schema = schemas[input.name as keyof M];
        const builtin = ['navigation_duration', 'FCP', 'TTFB'].includes(input.name);
        const allow = fields.get(input.name);
        if (builtin) {
          if (Object.keys(properties).some(k => !['value','path','metricId'].includes(k)) ||
              typeof properties.value !== 'number' || !Number.isFinite(properties.value) || properties.value < 0) {
            throw new TypeError('Invalid built-in performance event');
          }
        } else if (!schema || !schema.validate(properties) || !allow ||
                   Object.keys(properties).some(key => !allow.has(key))) {
          throw new TypeError('Unregistered or invalid event');
        }
        output = { ...base, kind: 'event' };
        break;
      }
      case 'pageview':
        if (!input.routeId) throw new TypeError('Route ID required');
        output = { ...base, kind: 'pageview', routeId: /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.routeId) ? input.routeId : (() => { throw new TypeError('Invalid route ID'); })(), path: safePath(input.path),
          ...(input.referrerOrigin ? { referrerOrigin: safeReferrerOrigin(input.referrerOrigin) } : {}) };
        break;
      case 'conversion': {
        const schema = schemas[input.name as keyof M];
        if (!schema || !schema.validate(properties) || !fields.has(input.name) ||
            Object.keys(properties).some(key => !fields.get(input.name)!.has(key))) throw new TypeError('Invalid conversion event');
        if (!input.goalId) throw new TypeError('Conversion goal required');
        if (input.value !== undefined && (!Number.isFinite(input.value) || input.value < 0)) throw new TypeError('Invalid conversion value');
        if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) throw new TypeError('Invalid currency');
        output = { ...base, kind: 'conversion', goalId: safeName(input.goalId),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.currency ? { currency: input.currency } : {}) };
        break;
      }
      case 'web-vital':
        if (input.metric !== 'LCP' && input.metric !== 'INP' && input.metric !== 'CLS') throw new TypeError('Unknown web vital');
        if (input.name !== input.metric) throw new TypeError('Metric name mismatch');
        if (input.rating && !['good','needs-improvement','poor'].includes(input.rating)) throw new TypeError('Invalid rating');
        if (input.navigationType && !['navigate','reload','back-forward','prerender'].includes(input.navigationType)) throw new TypeError('Invalid navigation type');
        if (!Number.isFinite(input.value) || input.value < 0) throw new TypeError('Invalid metric');
        output = { ...base, kind: 'web-vital', metric: input.metric, value: input.value,
          ...(input.rating ? { rating: input.rating } : {}),
          ...(input.navigationType ? { navigationType: input.navigationType } : {}) };
        break;
    }
    if (new TextEncoder().encode(JSON.stringify(output)).byteLength > payloadMax) throw new RangeError('Payload limit');
    return Object.freeze(output);
  }
  function safeReferrerOrigin(value: string): string {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new TypeError('Referrer must be origin only');
    return u.origin;
  }
  function emit(record: AnalyticsRecordV1, onlyPurpose?: ConsentPurposeV1): TrackResultV1 {
    if (disposed) return 'blocked';
    const targets = runtimes.filter(r => permitted(r) && (!onlyPurpose || r.purpose === onlyPurpose));
    if (targets.length === 0) return 'blocked';
    if (record.dedupeKey && dedup.has(record.dedupeKey)) return 'blocked';
    if (rate < 1 && Math.random() >= rate) { dropped++; return 'sampled-out'; }
    for (const runtime of targets) {
      if (runtime.queue.length >= max) { runtime.queue.shift(); dropped++; }
      runtime.queue.push({ event: record, attempts: 0 });
      if (runtime.queue.length >= batch) void flushOne(runtime);
      else schedule(runtime, interval);
    }
    accepted++;
    if (record.dedupeKey) {
      dedup.add(record.dedupeKey);
      if (dedup.size > 1024) dedup.delete(dedup.values().next().value!);
    }
    return 'accepted';
  }
  function enqueue(input: AnalyticsRecordV1, purpose?: ConsentPurposeV1): TrackResultV1 {
    try { return emit(sanitize(input), purpose); } catch { return 'invalid'; }
  }
  function revoke(runtime: Runtime): void {
    runtime.revision++;
    dropped += runtime.queue.length;
    runtime.queue.length = 0;
    clearTimer(runtime);
    runtime.abort?.abort('consent-revoked');
    runtime.flushAbort?.abort('consent-revoked');
    const old = runtime.provider;
    runtime.provider = undefined;
    retire(old, runtime);
    dedup.clear();
  }
  function onConsent(): void {
    for (const runtime of runtimes) {
      const allowed = permission('analytics') && permission(runtime.purpose);
      if (runtime.allowed === allowed) continue;
      runtime.allowed = allowed;
      if (!allowed) revoke(runtime);
    }
  }
  const unsubscribe = consent.subscribe((_next, _previous) => onConsent());
  if (typeof unsubscribe !== 'function') throw new TypeError('Consent subscription must return unsubscribe');
  onConsent();
  const api: Analytics<M> = {
    consent,
    track(nameOrRecord: string | AnalyticsRecordV1, properties?: EventMetadata): boolean | TrackResultV1 {
      if (typeof nameOrRecord !== 'string') return enqueue(nameOrRecord);
      safeName(nameOrRecord);
      const record: AnalyticsRecordV1 = { schema: 'zaakiy.analytics/1', kind: 'event',
        name: nameOrRecord, timestampMs: Date.now(), properties };
      const result = enqueue(record);
      if (result === 'invalid') throw new TypeError('Event payload failed schema validation');
      return result === 'accepted';
    },
    pageview(page): boolean {
      const result = enqueue({ schema: 'zaakiy.analytics/1', kind: 'pageview', name: 'pageview',
        timestampMs: Date.now(), routeId: page.routeId, path: page.path });
      if (result === 'invalid') throw new TypeError('Invalid pageview');
      return result === 'accepted';
    },
    conversion(input): boolean {
      if (input.confirmed !== true) throw new TypeError('Application must confirm conversion');
      const result = enqueue({ schema: 'zaakiy.analytics/1', kind: 'conversion', name: input.name,
        timestampMs: Date.now(), properties: input.properties, goalId: input.goalId,
        ...(input.deduplicationId ? { dedupeKey: input.deduplicationId } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.currency ? { currency: input.currency } : {}) });
      if (result === 'invalid') throw new TypeError('Invalid conversion');
      return result === 'accepted';
    },
    identify(identity): boolean {
      if (!options.identity || !permission(options.identity.purpose) || !permission('analytics')) return false;
      let opaque: string;
      try { opaque = safeOpaqueId(options.identity.encode(identity)); } catch { return false; }
      // Identity is an explicit custom event requiring an application schema.
      return enqueue({ schema: 'zaakiy.analytics/1', kind: 'event', name: 'identify',
        timestampMs: Date.now(), properties: { opaqueId: opaque } }, 'analytics') === 'accepted';
    },
    measure(name, value, id, path): boolean {
      if (!Number.isFinite(value) || value < 0) return false;
      let record: AnalyticsRecordV1;
      try {
        const opaque = safeOpaqueId(id);
        if (name === 'FCP' || name === 'TTFB') {
          // Optional supporting metrics are registered explicitly as ordinary custom events.
          return enqueue({ schema: 'zaakiy.analytics/1', kind: 'event', name,
            timestampMs: Date.now(), properties: { value, metricId: opaque } }) === 'accepted';
        }
        record = { schema: 'zaakiy.analytics/1', kind: 'web-vital', metric: name, name,
          timestampMs: Date.now(), value,
          ...(path ? { properties: { path: safePath(path), metricId: opaque } } : { properties: { metricId: opaque } }) };
      } catch { return false; }
      return enqueue(record) === 'accepted';
    },
    timing(name, durationMs, path): boolean {
      if (!Number.isFinite(durationMs) || durationMs < 0) return false;
      return enqueue({ schema: 'zaakiy.analytics/1', kind: 'event', name,
        timestampMs: Date.now(), properties: { value: durationMs,
          ...(path ? { path: safePath(path) } : {}) } }) === 'accepted';
    },
    async flush(): Promise<void> {
      if (disposed) return;
      await Promise.all(runtimes.map(async runtime => {
        if (!permitted(runtime)) return;
        while (permitted(runtime) && runtime.queue.length) {
          const previous = runtime.queue.length;
          await flushOne(runtime);
          if (runtime.queue.length >= previous) break;
        }
        if (runtime.provider && permitted(runtime)) {
          const controller = new AbortController();
          runtime.flushAbort = controller;
          const deadline = setTimeout(() => controller.abort('flush-timeout'), timeout);
          try { await cancellable(runtime.provider.flush(controller.signal), controller.signal); }
          catch (error) { if (permitted(runtime)) report(error, runtime); }
          finally { clearTimeout(deadline); if (runtime.flushAbort === controller) runtime.flushAbort = undefined; }
        }
      }));
    },
    async dispose(): Promise<void> {
      if (disposing) return disposing;
      disposed = true;
      unsubscribe();
      dedup.clear();
      for (const runtime of runtimes) {
        runtime.allowed = false;
        revoke(runtime);
      }
      disposing = Promise.all([...disposalPromises]).then(() => {});
      return disposing;
    },
    diagnostics(): AnalyticsDiagnostics {
      return Object.freeze({ accepted, dropped, delivered, errors,
        queueLength: runtimes.reduce((sum, r) => sum + r.queue.length, 0) });
    }
  } as Analytics<M>;
  try { options.registerCleanup?.(() => { void api.dispose(); }); }
  catch (error) { void api.dispose(); throw error; }
  return api;
}
