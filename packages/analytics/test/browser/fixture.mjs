/* global PerformanceObserver, performance, document, window */
import { createAnalytics, createMemoryProvider } from '../../dist/index.js';
import { startWebVitals } from '../../dist/vitals.js';

const purposes = ['essential', 'analytics', 'advertising', 'ad-personalization', 'functional-third-party'];
let active = false;
let revision = 0;
const listeners = new Set();
const snapshot = () => ({
  schema: 'zaakiy.consent/1', revision, policyId: 'fixture', policyVersion: '1',
  grants: Object.fromEntries(purposes.map(p => [p, { purpose: p,
    decision: p === 'analytics' && active ? 'granted' : 'denied' }]))
});
const consent = {
  schema: 'zaakiy.consent/1', snapshot,
  can: purpose => purpose === 'analytics' && active,
  subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); }
};
const providers = [];
const analytics = createAnalytics({
  schemas: { interacted: { fields: ['count'], validate: x => typeof x?.count === 'number' } },
  consent, providers: [{ id: 'memory', purpose: 'analytics', load: () => {
    const p = createMemoryProvider(); providers.push(p); return p;
  } }], flushIntervalMs: 60000
});
const counts = { start: 0, disconnect: 0 };
const callbacks = [];
const source = {
  start(callback) {
    counts.start++;
    callbacks.push(callback);
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.name !== 'fixture_measure') continue;
        // A synthetic metric validates delivery wiring; NOT a real LCP formula.
        callback({ name: 'LCP', id: `metric_${String(counts.start).padStart(4, '0')}`,
          value: Math.max(1, entry.duration) });
      }
    });
    observer.observe({ type: 'measure' });
    return () => { counts.disconnect++; observer.disconnect(); };
  }
};
let done = false;
let cleanup = () => {};
const ready = startWebVitals(analytics, { source, path: () => '/fixture?token=never-store' }).then(stop => {
  cleanup = stop; done = true;
});
function update(value) {
  const previous = snapshot(); active = value; revision++;
  const next = snapshot(); for (const listener of listeners) listener(next, previous);
}
function sample() {
  performance.mark('fixture_start');
  performance.mark('fixture_end');
  performance.measure('fixture_measure', 'fixture_start', 'fixture_end');
}
document.getElementById('interact').addEventListener('click', () => {
  analytics.track('interacted', { count: 1 });
  sample();
});
window.__analyticsFixture = {
  ready, isReady: () => done, grant: () => update(true), revoke: () => update(false),
  sample, flush: () => analytics.flush(),
  counters: () => ({ ...counts, subscribers: listeners.size, providers: providers.length }),
  events: () => providers.flatMap(p => p.events),
  stale: () => callbacks[0]?.({ name: 'INP', value: 32, id: 'metric_stale' }),
  dispose: async () => { cleanup(); await analytics.dispose(); },
  disposed: () => listeners.size === 0
};
