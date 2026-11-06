import { createAnalytics, createMemoryProvider } from '../../dist/index.js';
import { startWebVitals } from '../../dist/vitals.js';
const purposes = ['essential', 'analytics', 'advertising', 'ad-personalization', 'functional-third-party'];
let granted = false;
let rev = 0;
const listeners = new Set();
const snapshot = () => ({ schema: 'zaakiy.consent/1', revision: rev,
  policyId: 'native-fixture', policyVersion: '1',
  grants: Object.fromEntries(purposes.map(p => [p, { purpose: p,
    decision: p === 'analytics' && granted ? 'granted' : 'denied' }])) });
const consent = { schema: 'zaakiy.consent/1', snapshot,
  can: p => p === 'analytics' && granted,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
const providers = [];
const analytics = createAnalytics({ schemas: {}, consent,
  providers: [{ id: 'memory', purpose: 'analytics', load() {
    const provider = createMemoryProvider(); providers.push(provider); return provider;
  } }], flushIntervalMs: 60000 });
const native = globalThis.PerformanceObserver;
const counts = { start: 0, disconnect: 0 };
class CountedObserver extends native {
  constructor(callback) { super(callback); counts.start++; }
  disconnect() { counts.disconnect++; super.disconnect(); }
}
// Test instrumentation only: preserve browser-native PerformanceObserver behavior.
Object.defineProperty(CountedObserver, 'supportedEntryTypes', { get: () => native.supportedEntryTypes });
globalThis.PerformanceObserver = CountedObserver;
const stopReady = startWebVitals(analytics, { path: () => '/performance?token=private' });
let stop = () => {};
const ready = stopReady.then(dispose => { stop = dispose; });
function consentTo(value) {
  const old = snapshot(); granted = value; rev++;
  const next = snapshot(); for (const fn of listeners) fn(next, old);
}
async function induceLayoutAndLcp() {
  // Only browser-created entries (not synthetic callback metric values) are used.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const visual = document.querySelector('#visual');
  visual.style.height = '350px';
  const h = document.createElement('h2');
  h.style.fontSize = '72px'; h.textContent = 'Large content generated after consent';
  document.querySelector('main').appendChild(h);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
document.querySelector('#interact').addEventListener('click', () => {
  const end = performance.now() + 110;
  while (performance.now() < end) { /* a real slow interaction for the Event Timing API */ }
});
window.__nativeVitals = {
  ready,
  supported: native.supportedEntryTypes,
  grant: () => consentTo(true), revoke: () => consentTo(false),
  induceLayoutAndLcp,
  flush: async () => { window.dispatchEvent(new Event('pagehide')); await analytics.flush(); },
  events: () => providers.flatMap(p => p.events),
  counts: () => ({ ...counts, subscribers: listeners.size }),
  dispose: async () => { stop(); await analytics.dispose(); }
};
