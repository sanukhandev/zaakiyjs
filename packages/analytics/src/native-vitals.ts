/** Disposable browser PerformanceObserver source for Core Web Vitals.
 *
 * Uses the standardized Performance Timeline APIs. Only entries recorded after
 * the caller authorized collection are considered, even when the browser
 * delivers earlier entries via `buffered`. This intentionally means late
 * consent can yield missing LCP/FCP/TTFB rather than replay pre-consent data.
 *
 * INP uses the native interactionCount and the published 98th-percentile
 * estimator (longest interaction per 50). CLS uses session windows separated
 * by >1s or lasting >5s. No synthetic fallback values are manufactured.
 */
import type { DisposableWebVitalsSource, WebVitalMetric } from './vitals.js';

type ObservedEvent = PerformanceEntry & { readonly interactionId?: number; readonly duration: number };
type LayoutShift = PerformanceEntry & { readonly value?: number; readonly hadRecentInput?: boolean };
const thresholds = {
  LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25],
  FCP: [1800, 3000], TTFB: [800, 1800]
} as const;
type Name = keyof typeof thresholds;

function ratingFor(name: Name, value: number): WebVitalMetric['rating'] {
  const [good, poor] = thresholds[name];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

/** Pure helpers also serve as regression fixtures for standardized metrics. */
export function largestShiftWindow(entries: readonly { startTime: number; value: number; hadRecentInput: boolean }[]): number {
  let largest = 0;
  let start = -1;
  let previous = -1;
  let total = 0;
  for (const entry of entries) {
    if (entry.hadRecentInput || !Number.isFinite(entry.value) || entry.value < 0) continue;
    if (start < 0 || entry.startTime - previous > 1000 || entry.startTime - start > 5000) {
      start = entry.startTime; total = 0;
    }
    total += entry.value;
    previous = entry.startTime;
    largest = Math.max(largest, total);
  }
  return largest;
}

export function p98InteractionLatency(latenciesDescending: readonly number[], interactionCount: number): number | undefined {
  if (!latenciesDescending.length || !Number.isSafeInteger(interactionCount) || interactionCount <= 0) return undefined;
  return latenciesDescending[Math.min(latenciesDescending.length - 1, Math.floor(interactionCount / 50))];
}

/** An optional source; import @zaakiyjs/analytics/vitals only when opted in. */
export function createNativeWebVitalsSource(): DisposableWebVitalsSource {
  return {
    start(emit, signal): () => void {
      if (typeof window === 'undefined' || typeof document === 'undefined' ||
          typeof PerformanceObserver === 'undefined' || signal.aborted) return () => {};

      const observers: PerformanceObserver[] = [];
      const supported = PerformanceObserver.supportedEntryTypes ?? [];
      const collectionStart = performance.now();
      const nav = performance.getEntriesByType('navigation')[0] as
        (PerformanceNavigationTiming & { readonly activationStart?: number }) | undefined;
      const activation = nav?.activationStart ?? 0;
      const activeNavigation = activation > 0 ? 'prerender' :
        nav?.type === 'reload' ? 'reload' : nav?.type === 'back_forward' ? 'back-forward' : 'navigate';
      let closed = false;
      let initialHidden = document.visibilityState === 'hidden';
      let lcpFinished = false;
      let lcp: number | undefined;
      let fcp: number | undefined;
      let cls = 0;
      let sessionStart = -1;
      let previousShift = -1;
      let sessionValue = 0;
      let cycle = 0;
      let inpEligible = supported.includes('event');
      let interactionBaseline = (performance as Performance & { readonly interactionCount?: number }).interactionCount;
      let seenInteractionIds = new Set<number>();
      let interactionCountOverflow = false;
      const topInteractions = new Map<number, number>();
      const observedMetrics = new Map<Name, number>();

      function publish(name: Name, value: number | undefined): void {
        if (closed || signal.aborted || value === undefined || !Number.isFinite(value) || value < 0) return;
        if (observedMetrics.get(name) === value) return;
        observedMetrics.set(name, value);
        emit({ name, value, rating: ratingFor(name, value),
          id: `metric_${name}_${cycle}`, navigationType: activeNavigation });
      }
      function addObserver(type: string, consume: (entries: PerformanceEntry[]) => void,
        other: PerformanceObserverInit = {}): void {
        if (!supported.includes(type)) return;
        const observer = new PerformanceObserver(list => {
          if (closed || signal.aborted) return;
          consume(list.getEntries());
        });
        try {
          observer.observe({ type, buffered: true, ...other });
          observers.push(observer);
        } catch { observer.disconnect(); }
      }
      function recordLcp(entries: PerformanceEntry[]): void {
        if (lcpFinished || initialHidden) return;
        for (const entry of entries) {
          if (entry.startTime < collectionStart) continue;
          lcp = Math.max(0, entry.startTime - activation);
        }
      }
      function recordFcp(entries: PerformanceEntry[]): void {
        if (initialHidden) return;
        for (const entry of entries) {
          if (entry.name === 'first-contentful-paint' && entry.startTime >= collectionStart) {
            fcp = Math.max(0, entry.startTime - activation);
            publish('FCP', fcp);
            break;
          }
        }
      }
      function recordCls(entries: PerformanceEntry[]): void {
        if (initialHidden) return;
        for (const base of entries) {
          const entry = base as LayoutShift;
          if (entry.startTime < collectionStart || entry.hadRecentInput ||
              !Number.isFinite(entry.value) || (entry.value ?? -1) < 0) continue;
          if (sessionStart < 0 || entry.startTime - previousShift > 1000 ||
              entry.startTime - sessionStart > 5000) {
            sessionStart = entry.startTime;
            sessionValue = 0;
          }
          sessionValue += entry.value!;
          previousShift = entry.startTime;
          cls = Math.max(cls, sessionValue);
        }
      }
      function recordInp(entries: PerformanceEntry[]): void {
        if (!inpEligible || initialHidden) return;
        for (const base of entries) {
          const entry = base as ObservedEvent;
          const id = entry.interactionId;
          if (entry.startTime < collectionStart || !Number.isSafeInteger(id) || id === undefined || id <= 0 ||
              !Number.isFinite(entry.duration) || entry.duration < 0) continue;
          if (interactionBaseline === undefined) {
            if (seenInteractionIds.size >= 500 && !seenInteractionIds.has(id)) {
              interactionCountOverflow = true;
            } else seenInteractionIds.add(id);
          }
          if (topInteractions.has(id)) {
            topInteractions.set(id, Math.max(entry.duration, topInteractions.get(id)!));
          } else if (topInteractions.size < 10) {
            topInteractions.set(id, entry.duration);
          } else {
            let minId: number | undefined;
            let minValue = Infinity;
            for (const [key, value] of topInteractions) {
              if (value < minValue) { minValue = value; minId = key; }
            }
            if (minId !== undefined && entry.duration > minValue) {
              topInteractions.delete(minId);
              topInteractions.set(id, entry.duration);
            }
          }
        }
      }
      function publishInp(): void {
        if (!inpEligible || interactionCountOverflow || topInteractions.size === 0) return;
        const current = (performance as Performance & { readonly interactionCount?: number }).interactionCount;
        const count = current !== undefined && interactionBaseline !== undefined ?
          Math.max(0, current - interactionBaseline) : seenInteractionIds.size;
        publish('INP', p98InteractionLatency([...topInteractions.values()].sort((a, b) => b - a), Math.max(count, topInteractions.size)));
      }
      function finalizeLcp(): void {
        if (lcpFinished) return;
        for (const observer of observers) {
          const records = observer.takeRecords().filter(entry => entry.entryType === 'largest-contentful-paint');
          if (records.length) recordLcp(records);
        }
        lcpFinished = true;
        publish('LCP', lcp);
      }
      function flush(): void {
        if (closed || signal.aborted) return;
        for (const observer of observers) {
          const entries = observer.takeRecords();
          if (!entries.length) continue;
          switch (entries[0]?.entryType) {
            case 'largest-contentful-paint': recordLcp(entries); break;
            case 'layout-shift': recordCls(entries); break;
            case 'event': recordInp(entries); break;
            case 'paint': recordFcp(entries); break;
          }
        }
        finalizeLcp();
        if (supported.includes('layout-shift') && !initialHidden) publish('CLS', cls);
        publishInp();
      }
      function onInput(event: Event): void {
        if (event.isTrusted) finalizeLcp();
      }
      function onVisibility(): void {
        if (document.visibilityState === 'hidden') flush();
      }
      function onPageHide(): void { flush(); }
      function onPageShow(event: PageTransitionEvent): void {
        if (!event.persisted) return;
        // BFCache restore begins a new user-visible visit; never mix metrics.
        cycle++;
        observedMetrics.clear();
        lcp = undefined; fcp = undefined; lcpFinished = true;
        cls = 0; sessionStart = -1; previousShift = -1; sessionValue = 0;
        topInteractions.clear(); seenInteractionIds.clear(); interactionCountOverflow = false;
        interactionBaseline = (performance as Performance & { readonly interactionCount?: number }).interactionCount;
        initialHidden = document.visibilityState === 'hidden';
      }
      function stop(): void {
        if (closed) return;
        closed = true;
        for (const observer of observers) observer.disconnect();
        observers.length = 0;
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('pageshow', onPageShow);
        window.removeEventListener('pointerdown', onInput, true);
        window.removeEventListener('keydown', onInput, true);
        signal.removeEventListener('abort', stop);
        topInteractions.clear(); seenInteractionIds.clear(); observedMetrics.clear();
      }
      addObserver('largest-contentful-paint', recordLcp);
      addObserver('layout-shift', recordCls);
      addObserver('event', recordInp, { durationThreshold: 40 } as PerformanceObserverInit);
      addObserver('paint', recordFcp);
      // TTFB is only reported if its response occurred after consent started.
      if (nav && nav.responseStart >= collectionStart && Number.isFinite(nav.responseStart)) {
        publish('TTFB', Math.max(0, nav.responseStart - activation));
      }
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onPageShow);
      window.addEventListener('pointerdown', onInput, true);
      window.addEventListener('keydown', onInput, true);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      return stop;
    }
  };
}
