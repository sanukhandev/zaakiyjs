import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeWebVitalsSource, largestShiftWindow, p98InteractionLatency } from '../src/vitals.js';

class FakeObserver {
  static readonly supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'event', 'paint'];
  static instances: FakeObserver[] = [];
  readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void;
  readonly kinds: string[] = [];
  records: PerformanceEntry[] = [];
  disconnect = vi.fn();
  constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(options: PerformanceObserverInit): void { if (options.type) this.kinds.push(options.type); }
  takeRecords(): PerformanceEntry[] { return this.records.splice(0); }
  deliver(entries: readonly Record<string, unknown>[]): void {
    this.callback({ getEntries: () => entries as unknown as PerformanceEntry[] });
  }
}
function fixture() {
  const w = new EventTarget();
  const doc = new EventTarget() as EventTarget & { visibilityState?: string };
  doc.visibilityState = 'visible';
  const clock = { now: () => 100, interactionCount: 0,
    getEntriesByType: () => [] as PerformanceEntry[] };
  vi.stubGlobal('window', w);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('performance', clock);
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  FakeObserver.instances.length = 0;
  return { w, doc, clock, observer: (type: string) => FakeObserver.instances.find(x => x.kinds.includes(type))! };
}
afterEach(() => { vi.unstubAllGlobals(); FakeObserver.instances.length = 0; });
describe('native disposable Core Web Vitals collection', () => {
  it('implements the standard CLS largest-session-window boundaries', () => {
    expect(largestShiftWindow([
      { startTime: 100, value: 0.10, hadRecentInput: false },
      { startTime: 1099, value: 0.08, hadRecentInput: false },
      { startTime: 1100, value: 0.4, hadRecentInput: true },
      { startTime: 6200, value: 0.05, hadRecentInput: false }
    ])).toBeCloseTo(0.18);
    expect(largestShiftWindow([{ startTime: 100, value: 0.2, hadRecentInput: true }])).toBe(0);
  });
  it('uses the published INP p98 estimator with one discarded outlier per 50 interactions', () => {
    expect(p98InteractionLatency([400, 280, 180], 49)).toBe(400);
    expect(p98InteractionLatency([400, 280, 180], 50)).toBe(280);
    expect(p98InteractionLatency([400, 280, 180], 100)).toBe(180);
    expect(p98InteractionLatency([], 0)).toBeUndefined();
  });
  it('never replays buffered entries before the consent activation time', () => {
    const { observer, doc } = fixture();
    const emit = vi.fn();
    const stop = createNativeWebVitalsSource().start(emit, new AbortController().signal) as () => void;
    observer('largest-contentful-paint').deliver([
      { entryType: 'largest-contentful-paint', startTime: 50 },
      { entryType: 'largest-contentful-paint', startTime: 180 }
    ]);
    observer('layout-shift').deliver([
      { entryType: 'layout-shift', startTime: 75, value: 0.9, hadRecentInput: false },
      { entryType: 'layout-shift', startTime: 200, value: 0.15, hadRecentInput: false }
    ]);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'LCP', value: 180 }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'CLS', value: 0.15 }));
    expect(emit.mock.calls.some(x => x[0]?.value === 0.9)).toBe(false);
    stop(); stop();
    expect(FakeObserver.instances.every(x => x.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it('finalizes LCP without consuming queued CLS, INP or paint entries', () => {
    const { w, doc, observer } = fixture();
    const add = vi.spyOn(w, 'addEventListener');
    const emit = vi.fn();
    const stop = createNativeWebVitalsSource().start(emit, new AbortController().signal) as () => void;
    observer('largest-contentful-paint').records.push(
      { entryType: 'largest-contentful-paint', startTime: 200 } as PerformanceEntry);
    observer('layout-shift').records.push(
      { entryType: 'layout-shift', startTime: 210, value: 0.3, hadRecentInput: false } as unknown as PerformanceEntry);
    observer('event').records.push(
      { entryType: 'event', startTime: 220, duration: 350, interactionId: 4 } as unknown as PerformanceEntry);
    observer('paint').records.push(
      { entryType: 'paint', name: 'first-contentful-paint', startTime: 230 } as PerformanceEntry);
    const input = add.mock.calls.find(([type]) => type === 'pointerdown')?.[1];
    expect(typeof input).toBe('function');
    if (typeof input !== 'function') throw new Error('Missing pointerdown listener');
    input({ isTrusted: true } as Event);
    expect(observer('layout-shift').records).toHaveLength(1);
    expect(observer('event').records).toHaveLength(1);
    expect(observer('paint').records).toHaveLength(1);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'LCP', value: 200 }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'CLS', value: 0.3 }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'INP', value: 350 }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'FCP', value: 230 }));
    stop();
  });
  it('measures only actual interaction ids and disposes fully on abort', () => {
    const { observer, doc, clock } = fixture();
    const emit = vi.fn();
    const controller = new AbortController();
    const stop = createNativeWebVitalsSource().start(emit, controller.signal) as () => void;
    observer('event').deliver([
      { entryType: 'event', startTime: 200, duration: 350, interactionId: 18 },
      { entryType: 'event', startTime: 210, duration: 200, interactionId: 18 },
      { entryType: 'event', startTime: 225, duration: 90, interactionId: 19 }
    ]);
    clock.interactionCount = 2;
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'INP', value: 350 }));
    controller.abort();
    expect(FakeObserver.instances.every(x => x.disconnect.mock.calls.length === 1)).toBe(true);
    const count = emit.mock.calls.length;
    observer('event').deliver([{ entryType: 'event', startTime: 230, duration: 650, interactionId: 20 }]);
    expect(emit.mock.calls.length).toBe(count);
    stop();
  });
});
