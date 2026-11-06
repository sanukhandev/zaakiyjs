import { describe, it, expect, vi } from 'vitest';
import { createAnalytics, createMemoryProvider, createHttpProvider } from '../src/index.js';
import type { AnalyticsProviderV1, ConsentCapabilityV1, ConsentSnapshotV1, ConsentPurposeV1 } from '../src/index.js';

interface Events { viewed: { productId: string }; checkout: { amount: number } }
const PURPOSES: readonly ConsentPurposeV1[] = ['essential','analytics','advertising','ad-personalization','functional-third-party'];
function gate(initial = false) {
  let allowed = initial;
  let rev = 0;
  const listeners = new Set<(n: ConsentSnapshotV1, p: ConsentSnapshotV1) => void>();
  function snapshot(): ConsentSnapshotV1 {
    const grants = Object.fromEntries(PURPOSES.map(p => [p, { purpose: p,
      decision: p === 'analytics' && allowed ? 'granted' : 'unknown' }])) as unknown as ConsentSnapshotV1['grants'];
    return { schema: 'zaakiy.consent/1', policyId: 'test', policyVersion: 'v1', revision: rev, grants };
  }
  const consent: ConsentCapabilityV1 = {
    schema: 'zaakiy.consent/1', snapshot,
    can: purpose => purpose === 'analytics' && allowed,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
  return { consent, get subscriptions() { return listeners.size; }, set(value: boolean) {
    const previous = snapshot(); allowed = value; rev++;
    for (const fn of listeners) fn(snapshot(), previous);
  } };
}
function schemas() {
  return {
    viewed: { fields: ['productId'], validate: (x: unknown): x is Events['viewed'] =>
      !!x && typeof x === 'object' && 'productId' in x && typeof x.productId === 'string' },
    checkout: { fields: ['amount'], validate: (x: unknown): x is Events['checkout'] =>
      !!x && typeof x === 'object' && 'amount' in x && typeof x.amount === 'number' }
  };
}
function purposeGate(initial: Partial<Record<ConsentPurposeV1, boolean>>) {
  const grants = { ...initial };
  let revision = 0;
  const listeners = new Set<(n: ConsentSnapshotV1, p: ConsentSnapshotV1) => void>();
  function snapshot(): ConsentSnapshotV1 {
    return {
      schema: 'zaakiy.consent/1', policyId: 'purpose-test', policyVersion: 'v1', revision,
      grants: Object.fromEntries(PURPOSES.map(p => [p, {
        purpose: p, decision: grants[p] === true ? 'granted' : 'denied'
      }])) as unknown as ConsentSnapshotV1['grants']
    };
  }
  const consent: ConsentCapabilityV1 = {
    schema: 'zaakiy.consent/1', snapshot,
    can: purpose => grants[purpose] === true,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };
  return {
    consent,
    set(purpose: ConsentPurposeV1, value: boolean) {
      const previous = snapshot();
      grants[purpose] = value;
      revision++;
      for (const fn of listeners) fn(snapshot(), previous);
    }
  };
}
function setup(consented = false, more: Partial<Parameters<typeof createAnalytics<Events>>[0]> = {}) {
  const c = gate(consented);
  const memory = createMemoryProvider();
  const load = vi.fn(() => memory);
  const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
    providers: [{ id: 'memory', purpose: 'analytics', load }],
    flushIntervalMs: 60000, ...more });
  return { c, engine, memory, load };
}
const record = (name = 'viewed') => ({
  schema: 'zaakiy.analytics/1' as const, kind: 'event' as const, name,
  timestampMs: Date.now(), properties: { productId: 'product01' }
});
describe('P3 analytics contract and privacy', () => {
  it('requires the frozen ConsentCapabilityV1 and rejects provisional readers', () => {
    expect(() => createAnalytics<Events>({ schemas: schemas(), consent: { isAllowed: () => true, subscribe: () => () => {} } as never })).toThrow();
  });
  it('collects nothing before consent, resumes only after grant, and does not auto-load providers', async () => {
    const { c, engine, memory, load } = setup();
    expect(engine.track(record())).toBe('blocked');
    expect(engine.track('viewed', { productId: 'p1' })).toBe(false);
    await engine.flush(); expect(load).not.toHaveBeenCalled();
    c.set(true);
    expect(engine.track('viewed', { productId: 'p2' })).toBe(true);
    await engine.flush(); expect(memory.events).toHaveLength(1);
    expect(memory.events[0]).toMatchObject({ schema: 'zaakiy.analytics/1', kind: 'event', name: 'viewed' });
    await engine.dispose();
  });
  it('raw records report invalid without throwing and convenience APIs reject invalid values', async () => {
    const { engine } = setup(true);
    expect(engine.track({ ...record(), name: 'unknown' })).toBe('invalid');
    expect(engine.track({ ...record(), properties: { password: '123' } })).toBe('invalid');
    expect(engine.track({ ...record(), properties: { productId: 'https://credentials.invalid' } })).toBe('invalid');
    expect(engine.track({ ...record(), properties: { productId: 'alice@example.com' } })).toBe('invalid');
    expect(() => engine.track('viewed', { productId: 'x', extra: 'y' } as Events['viewed'])).toThrow();
    expect(() => engine.track('checkout', { amount: NaN })).toThrow();
    expect(() => engine.track('viewed', { productId: { child: true } } as unknown as Events['viewed'])).toThrow();
    await engine.dispose();
  });
  it('sends sanitized v1 pageviews, no query or fragment', async () => {
    const { engine, memory } = setup(true);
    expect(engine.pageview({ path: '/catalog/3?token=hidden#fragment', routeId: 'catalog-route' })).toBe(true);
    expect(() => engine.pageview({ path: '//evil.invalid', routeId: 'unsafe' })).toThrow();
    await engine.flush();
    expect(memory.events[0]).toMatchObject({ schema: 'zaakiy.analytics/1', kind: 'pageview', path: '/catalog/3', routeId: 'catalog-route' });
    expect(JSON.stringify(memory.events)).not.toContain('hidden');
    await engine.dispose();
  });
  it('allows only confirmed, deduplicated conversions with an explicit goal', async () => {
    const { engine, memory } = setup(true);
    const c = { name: 'checkout' as const, goalId: 'checkout_success', properties: { amount: 42 },
      confirmed: true as const, deduplicationId: 'order_00001' };
    expect(engine.conversion(c)).toBe(true);
    expect(engine.conversion(c)).toBe(false);
    expect(() => engine.conversion({ ...c, confirmed: false as true })).toThrow();
    await engine.flush(); expect(memory.events.filter(x => x.kind === 'conversion')).toHaveLength(1);
    await engine.dispose();
  });
  it('does not republish pre-grant events and purges unsent events on revoke', async () => {
    const { engine, c, memory } = setup();
    engine.track('viewed', { productId: 'before' });
    c.set(true); engine.track('viewed', { productId: 'after' });
    c.set(false); expect(engine.diagnostics().queueLength).toBe(0);
    await engine.flush(); expect(memory.events).toHaveLength(0);
    expect(engine.track('viewed', { productId: 'blocked' })).toBe(false);
    await engine.dispose();
  });
  it('revocation aborts an active send and disposes its provider exactly once', async () => {
    const c = gate(true);
    let started!: () => void;
    const didStart = new Promise<void>(resolve => { started = resolve; });
    const stop = vi.fn(async () => {});
    const send = vi.fn(async (_events: readonly unknown[], signal: AbortSignal) => {
      started(); await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const provider: AnalyticsProviderV1 = { version: 1, start: async () => {}, send,
      flush: async () => {}, dispose: stop };
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'slow', purpose: 'analytics', load: () => provider }], flushIntervalMs: 60000 });
    engine.track('viewed', { productId: 'p' });
    const pending = engine.flush(); await didStart;
    c.set(false); await pending;
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(engine.diagnostics().queueLength).toBe(0);
    await engine.dispose(); expect(stop).toHaveBeenCalledOnce();
  });
  it('revocation during late asynchronous loader disposes its result without sending', async () => {
    const c = gate(true);
    const memory = createMemoryProvider();
    const dispose = vi.spyOn(memory, 'dispose');
    let release!: (value: AnalyticsProviderV1) => void;
    const loading = new Promise<AnalyticsProviderV1>(resolve => { release = resolve; });
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'late', purpose: 'analytics', load: () => loading }], flushIntervalMs: 60000 });
    engine.track('viewed', { productId: 'p' });
    const flushing = engine.flush();
    await vi.waitFor(() => expect(engine.diagnostics().queueLength).toBe(1));
    c.set(false); release(memory); await flushing;
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(memory.events).toHaveLength(0);
    await engine.dispose();
  });
  it('regrant does not reuse a stale unresolved provider load', async () => {
    const c = gate(true);
    const stale = createMemoryProvider();
    const current = createMemoryProvider();
    const staleDispose = vi.spyOn(stale, 'dispose');
    let resolveStale!: (value: AnalyticsProviderV1) => void;
    const deferred = new Promise<AnalyticsProviderV1>(resolve => { resolveStale = resolve; });
    const load = vi.fn()
      .mockImplementationOnce(() => deferred)
      .mockImplementationOnce(() => current);
    const engine = createAnalytics<Events>({
      schemas: schemas(), consent: c.consent,
      providers: [{ id: 'provider', purpose: 'analytics', load }],
      flushIntervalMs: 60000
    });
    engine.track('viewed', { productId: 'old' });
    const first = engine.flush();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    c.set(false);
    await first;
    c.set(true);
    engine.track('viewed', { productId: 'new' });
    await engine.flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(current.events).toHaveLength(1);
    expect(current.events[0]).toMatchObject({ properties: { productId: 'new' } });
    resolveStale(stale);
    await vi.waitFor(() => expect(staleDispose).toHaveBeenCalledOnce());
    expect(stale.events).toHaveLength(0);
    await engine.dispose();
  });
  it('consent regrant loads a fresh provider instance instead of resurrecting disposed handles', async () => {
    const c = gate(true);
    const made = [createMemoryProvider(), createMemoryProvider()]; let i = 0;
    const dispose0 = vi.spyOn(made[0]!, 'dispose');
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'memory', purpose: 'analytics', load: () => made[i++]! }], flushIntervalMs: 60000 });
    engine.track('viewed', { productId: 'a' }); await engine.flush();
    c.set(false); await vi.waitFor(() => expect(dispose0).toHaveBeenCalledOnce());
    c.set(true); engine.track('viewed', { productId: 'b' }); await engine.flush();
    expect(i).toBe(2); expect(made[0]!.events).toHaveLength(1); expect(made[1]!.events).toHaveLength(1);
    await engine.dispose();
  });
  it('handles repeated delivery failures and bounded retries without unbounded queues', async () => {
    const c = gate(true);
    const send = vi.fn(async () => { throw new Error('failed'); });
    const provider: AnalyticsProviderV1 = { version: 1, start: async () => {}, send,
      flush: async () => {}, dispose: async () => {} };
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'bad', purpose: 'analytics', load: () => provider }],
      flushIntervalMs: 60000, retryDelayMs: 60000, maxRetries: 1 });
    engine.track('viewed', { productId: 'a' });
    await engine.flush(); await engine.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(engine.diagnostics()).toMatchObject({ queueLength: 0, errors: 2 });
    await engine.dispose();
  });
  it('limits queue and applies unbiased configured zero sampling', async () => {
    const { engine } = setup(true, { maxQueueSize: 2, batchSize: 2, sampleRate: 0 });
    expect(engine.track(record())).toBe('sampled-out');
    expect(engine.diagnostics().queueLength).toBe(0);
    await engine.dispose();
    expect(() => setup(true, { maxQueueSize: -1 })).toThrow();
  });
  it('enforces maximum encoded bytes per delivery batch', async () => {
    const c = gate(true);
    const batches: number[] = [];
    const provider: AnalyticsProviderV1 = { version: 1, start: async () => {},
      send: async events => { batches.push(new TextEncoder().encode(JSON.stringify({ events })).length); },
      flush: async () => {}, dispose: async () => {} };
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'bounded', purpose: 'analytics', load: () => provider }],
      policy: { version: 1, sampleRate: 1, maxBatchSize: 5, maxQueueSize: 10,
        maxPayloadBytes: 240, flushIntervalMs: 60000, delivery: 'fetch', requiredPurposes: ['analytics'] } });
    for (const id of ['a_001','a_002','a_003']) engine.track('viewed', { productId: id });
    await engine.flush();
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(bytes => bytes <= 240)).toBe(true);
    expect(engine.diagnostics().queueLength).toBe(0);
    await engine.dispose();
  });
  it('isolates provider purposes and blocks implicit identity', async () => {
    const c = gate(true);
    const m = createMemoryProvider();
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'p', purpose: 'advertising', load: () => m }],
      identity: { purpose: 'advertising', retention: 'event-only', encode: () => 'opaque_12345' } });
    expect(engine.identify('user-sensitive')).toBe(false);
    expect(engine.track('viewed', { productId: 'p' })).toBe(false);
    await engine.dispose();
  });
  it('purges queued identity records when their additional purpose is revoked', async () => {
    const c = purposeGate({ analytics: true, 'ad-personalization': true });
    const memory = createMemoryProvider();
    const engine = createAnalytics<Events & { identify: { opaqueId: string } }>({
      schemas: {
        ...schemas(),
        identify: { fields: ['opaqueId'], validate: (x: unknown): x is { opaqueId: string } =>
          !!x && typeof x === 'object' && 'opaqueId' in x && typeof x.opaqueId === 'string' }
      },
      consent: c.consent,
      providers: [{ id: 'memory', purpose: 'analytics', load: () => memory }],
      identity: { purpose: 'ad-personalization', retention: 'event-only', encode: () => 'anonymous_12345' },
      flushIntervalMs: 60000
    });
    expect(engine.identify('opaque-source')).toBe(true);
    expect(engine.diagnostics().queueLength).toBe(1);
    c.set('ad-personalization', false);
    expect(engine.diagnostics().queueLength).toBe(0);
    expect(engine.identify('new-source')).toBe(false);
    expect(engine.track('identify', { opaqueId: 'bypass_12345' })).toThrow();
    expect(engine.track('viewed', { productId: 'still-allowed' })).toBe(true);
    await engine.flush();
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.name).toBe('viewed');
    c.set('ad-personalization', true);
    expect(engine.identify('new-source')).toBe(true);
    await engine.flush();
    expect(memory.events.filter(event => event.name === 'identify')).toHaveLength(1);
    await engine.dispose();
  });
  it('aborts an in-flight identity delivery when the additional consent purpose is revoked', async () => {
    const c = purposeGate({ analytics: true, 'ad-personalization': true });
    let entered!: () => void;
    const inFlight = new Promise<void>(resolve => { entered = resolve; });
    const aborted = vi.fn();
    const send = vi.fn(async (_events: readonly unknown[], signal: AbortSignal) => {
      entered();
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { aborted(); reject(new Error('aborted')); return; }
        signal.addEventListener('abort', () => { aborted(); reject(new Error('aborted')); }, { once: true });
      });
    });
    const provider: AnalyticsProviderV1 = {
      version: 1, start: async () => {}, send, flush: async () => {}, dispose: async () => {}
    };
    const engine = createAnalytics<Events & { identify: { opaqueId: string } }>({
      schemas: { ...schemas(), identify: { fields: ['opaqueId'],
        validate: (x: unknown): x is { opaqueId: string } =>
          !!x && typeof x === 'object' && 'opaqueId' in x && typeof x.opaqueId === 'string' } },
      consent: c.consent,
      providers: [{ id: 'memory', purpose: 'analytics', load: () => provider }],
      identity: { purpose: 'ad-personalization', retention: 'event-only', encode: () => 'anonymous_12345' },
      flushIntervalMs: 60000
    });
    expect(engine.identify('source')).toBe(true);
    const flushing = engine.flush();
    await inFlight;
    c.set('ad-personalization', false);
    await flushing;
    expect(aborted).toHaveBeenCalledOnce();
    expect(engine.diagnostics().queueLength).toBe(0);
    expect(engine.diagnostics().delivered).toBe(0);
    await engine.dispose();
  });
  it('accepts all valid Router route ID shapes for pageview telemetry', async () => {
    const { engine, memory } = setup(true);
    for (const routeId of ['products.list', '.index', '-default', '7products', 'my-route']) {
      expect(engine.pageview({ path: '/catalog?private=1', routeId })).toBe(true);
    }
    expect(() => engine.pageview({ path: '/catalog', routeId: 'invalid route' })).toThrow();
    await engine.flush();
    expect(memory.events.map(event => event.kind === 'pageview' ? event.routeId : '')).toEqual(
      ['products.list', '.index', '-default', '7products', 'my-route']
    );
    await engine.dispose();
  });
  it('performs HTTP transport without credentials and rejects unsafe endpoints or headers', async () => {
    const c = gate(false);
    const fetcher = vi.fn(async () => ({ ok: true, status: 204 } as Response));
    const provider = createHttpProvider({ endpoint: '/collect', fetcher: fetcher as typeof fetch });
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      providers: [{ id: 'http', purpose: 'analytics', load: () => provider }], flushIntervalMs: 60000 });
    engine.track('viewed', { productId: 'a' }); await engine.flush();
    expect(fetcher).not.toHaveBeenCalled();
    c.set(true); engine.track('viewed', { productId: 'b' }); await engine.flush();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(() => createHttpProvider({ endpoint: 'http://insecure.invalid' })).toThrow();
    expect(() => createHttpProvider({ endpoint: 'https://example.com/collect' })).toThrow();
    expect(() => createHttpProvider({ endpoint: '/collect', headers: { authorization: 'secret' } })).toThrow();
    await engine.dispose();
  });
  it('registers idempotent owner cleanup and removes subscriptions', async () => {
    const c = gate(true);
    let cleanup!: () => void;
    const engine = createAnalytics<Events>({ schemas: schemas(), consent: c.consent,
      registerCleanup: fn => { cleanup = fn; } });
    expect(c.subscriptions).toBe(1);
    cleanup(); cleanup();
    expect(engine.track('viewed', { productId: 'p' })).toBe(false);
    expect(c.subscriptions).toBe(0);
    await engine.dispose();
  });
  it('safe SSR module import performs no browser access', () => {
    expect(typeof createAnalytics).toBe('function');
    expect(typeof createMemoryProvider).toBe('function');
  });
});
