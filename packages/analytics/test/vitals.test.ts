import { it, expect, vi, afterEach } from 'vitest';
import { startWebVitals, reportPerformanceMeasure } from '../src/vitals.js';
import type { ConsentCapabilityV1, ConsentSnapshotV1 } from '../src/types.js';
function gate(initial = false) {
  let on = initial;
  let revision = 0;
  const listeners = new Set<(n: ConsentSnapshotV1, p: ConsentSnapshotV1) => void>();
  const snap = (): ConsentSnapshotV1 => ({ schema: 'zaakiy.consent/1', revision,
    policyId: 'test', policyVersion: '1', grants: {
      essential: { purpose: 'essential', decision: 'unknown' }, analytics: { purpose: 'analytics', decision: on ? 'granted' : 'denied' },
      advertising: { purpose: 'advertising', decision: 'unknown' }, 'ad-personalization': { purpose: 'ad-personalization', decision: 'unknown' },
      'functional-third-party': { purpose: 'functional-third-party', decision: 'unknown' }
    } });
  const consent: ConsentCapabilityV1 = { schema: 'zaakiy.consent/1', snapshot: snap,
    can: p => p === 'analytics' && on,
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  return { consent, get listeners() { return listeners.size; }, update(value: boolean) {
    const old = snap(); on = value; revision++;
    listeners.forEach(fn => fn(snap(), old));
  } };
}
afterEach(() => { vi.unstubAllGlobals(); });
it('never starts collectors before browser availability or before consent', async () => {
  const c = gate();
  const start = vi.fn(() => () => {});
  const analytics = { measure: vi.fn(() => true), timing: vi.fn(() => true), consent: c.consent };
  const stop = await startWebVitals(analytics, { source: { start } });
  expect(start).not.toHaveBeenCalled(); stop();
  expect(c.listeners).toBe(0);
});
it('activates on grant, deactivates immediately on revoke and supports fresh regrant', async () => {
  vi.stubGlobal('window', {});
  const c = gate(false);
  const callbacks: ((metric: { name: 'LCP' | 'INP' | 'CLS'; id: string; value: number }) => void)[] = [];
  const off = vi.fn();
  const start = vi.fn((report) => { callbacks.push(report); return off; });
  const analytics = { measure: vi.fn(() => true), timing: vi.fn(() => true), consent: c.consent };
  const stop = await startWebVitals(analytics, { source: { start }, path: () => '/app?token=hidden' });
  expect(start).not.toHaveBeenCalled();
  c.update(true);
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  callbacks[0]?.({ name: 'LCP', id: 'metric_001', value: 1010 });
  callbacks[0]?.({ name: 'LCP', id: 'metric_001', value: 1010 });
  expect(analytics.measure).toHaveBeenCalledOnce();
  expect(analytics.measure).toHaveBeenLastCalledWith('LCP', 1010, 'metric_001', '/app',
    { rating: undefined, navigationType: undefined });
  c.update(false); expect(off).toHaveBeenCalledOnce();
  callbacks[0]?.({ name: 'CLS', id: 'metric_002', value: 0.02 });
  expect(analytics.measure).toHaveBeenCalledOnce();
  c.update(true);
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  callbacks[1]?.({ name: 'INP', id: 'metric_003', value: 55 });
  expect(analytics.measure).toHaveBeenCalledTimes(2);
  stop(); expect(off).toHaveBeenCalledTimes(2);
  expect(c.listeners).toBe(0);
});
it('late collector initialization returns a disposer, but cannot activate after revocation', async () => {
  vi.stubGlobal('window', {});
  const c = gate(true);
  const off = vi.fn();
  let release!: (value: () => void) => void;
  const loading = new Promise<() => void>(resolve => { release = resolve; });
  const start = vi.fn(() => loading);
  const analytics = { measure: vi.fn(() => true), timing: vi.fn(() => true), consent: c.consent };
  const opening = startWebVitals(analytics, { source: { start } });
  c.update(false);
  release(off); const stop = await opening;
  expect(off).toHaveBeenCalledOnce();
  stop();
});
it('reports only explicit Performance.measure results when authorized', () => {
  const c = gate(true);
  vi.stubGlobal('performance', { getEntriesByName: () => [{ duration: 42 }] });
  const analytics = { consent: c.consent, timing: vi.fn(() => true) };
  expect(reportPerformanceMeasure(analytics, 'page_load')).toBe(true);
  c.update(false);
  expect(reportPerformanceMeasure(analytics, 'page_load')).toBe(false);
  expect(analytics.timing).toHaveBeenCalledOnce();
});
