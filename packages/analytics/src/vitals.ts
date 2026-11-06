import type { Analytics, ConsentCapabilityV1, WebVitalNameV1, WebVitalRatingV1 } from './types.js';
import { safePath, safeName } from './privacy.js';

export interface WebVitalMetric {
  readonly name: WebVitalNameV1 | 'FCP' | 'TTFB';
  readonly value: number;
  readonly id: string;
  readonly rating?: WebVitalRatingV1;
  readonly navigationType?: 'navigate' | 'reload' | 'back-forward' | 'prerender';
}
/** A source MUST release its observers/listeners when the returned disposer is invoked. */
export interface DisposableWebVitalsSource {
  start(emit: (metric: WebVitalMetric) => void): (() => void) | Promise<() => void>;
}
export interface WebVitalsOptions {
  /** Required to guarantee observer teardown. No unverifiable observers are created by default. */
  readonly source: DisposableWebVitalsSource;
  readonly path?: () => string;
  readonly includeSupportingMetrics?: boolean;
  readonly includeNavigationTiming?: boolean;
  readonly registerCleanup?: (cleanup: () => void) => void;
}
function permitted(consent: ConsentCapabilityV1): boolean {
  try {
    const current = consent.snapshot();
    return consent.schema === 'zaakiy.consent/1' && current.schema === 'zaakiy.consent/1' &&
      current.grants?.analytics?.decision === 'granted' && consent.can('analytics') === true;
  } catch { return false; }
}
/**
 * Consent-safe Web Vitals forwarding. The app supplies a source with a real
 * teardown contract; no Google web-vitals observer is started implicitly.
 * The source may use a maintained measurement library or vetted observer layer.
 */
export async function startWebVitals(
  analytics: Pick<Analytics<Record<string, never>>, 'measure' | 'timing'> & { readonly consent: ConsentCapabilityV1 },
  options: WebVitalsOptions
): Promise<() => void> {
  if (!options?.source || typeof options.source.start !== 'function') throw new TypeError('Disposable source is required');
  let stopped = false;
  let generation = 0;
  let cleanup: (() => void) | undefined;
  let starting = false;
  const lastValue = new Map<string, number>();
  const report = (metric: WebVitalMetric, revision: number) => {
    if (stopped || revision !== generation || (!cleanup && !starting) || !permitted(analytics.consent)) return;
    if (!['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].includes(metric.name) ||
      !Number.isFinite(metric.value) || metric.value < 0) return;
    if ((metric.name === 'FCP' || metric.name === 'TTFB') && !options.includeSupportingMetrics) return;
    const key = `${metric.name}:${metric.id}`;
    if (lastValue.get(key) === metric.value) return;
    lastValue.set(key, metric.value);
    try {
      const pathname = options.path?.();
      analytics.measure(metric.name, metric.value, metric.id, pathname ? safePath(pathname) : undefined);
    } catch { /* Measurement failure cannot break user interaction. */ }
  };
  function deactivate(): void {
    generation++;
    const stop = cleanup;
    cleanup = undefined;
    lastValue.clear();
    try { stop?.(); } catch { /* host collector cleanup must not break consent UI */ }
  }
  async function activate(): Promise<void> {
    if (stopped || cleanup || starting || !permitted(analytics.consent) || typeof window === 'undefined') return;
    starting = true;
    const rev = generation;
    try {
      const dispose = await options.source.start(metric => report(metric, rev));
      if (typeof dispose !== 'function') throw new TypeError('Web Vitals source must return a disposer');
      if (stopped || rev !== generation || !permitted(analytics.consent)) {
        dispose();
        return;
      }
      cleanup = dispose;
      if (options.includeNavigationTiming && typeof performance !== 'undefined' &&
          typeof performance.getEntriesByType === 'function') {
        const entry = performance.getEntriesByType('navigation')[0];
        if (entry && Number.isFinite(entry.duration) && entry.duration >= 0) {
          const path = options.path?.();
          analytics.timing('navigation_duration', entry.duration, path ? safePath(path) : undefined);
        }
      }
    } finally {
      starting = false;
      if (!stopped && !cleanup && permitted(analytics.consent) && rev !== generation) {
        void activate().catch(() => {});
      }
    }
  }
  const unsubscribe = analytics.consent.subscribe((_next, _prev) => {
    if (stopped) return;
    if (!permitted(analytics.consent)) deactivate();
    else void activate().catch(() => {});
  });
  const stop = () => { if (stopped) return; stopped = true; deactivate(); unsubscribe(); };
  try {
    options.registerCleanup?.(stop);
    await activate();
  } catch (error) { stop(); throw error; }
  return stop;
}

/** Reports only explicit Performance.measure values, never raw URLs or marks. */
export function reportPerformanceMeasure(
  analytics: Pick<Analytics<Record<string, never>>, 'timing'> & { readonly consent: ConsentCapabilityV1 },
  name: string,
  options: { readonly path?: string } = {}
): boolean {
  safeName(name);
  if (!permitted(analytics.consent) || typeof performance === 'undefined' ||
      typeof performance.getEntriesByName !== 'function') return false;
  const entries = performance.getEntriesByName(name, 'measure');
  const latest = entries[entries.length - 1];
  return !!latest && analytics.timing(name, latest.duration, options.path ? safePath(options.path) : undefined);
}
