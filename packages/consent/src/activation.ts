import { getOwner, runWithOwner, onCleanup } from '@zaakiyjs/core';
import type { OwnerScope } from '@zaakiyjs/core';
import type { ConsentGate } from './types.js';

export type ConsentCleanup = () => void | Promise<void>;
export type ConsentWithdrawalReason = 'denied' | 'revoked' | 'policy-changed' | 'owner-disposed';
export interface ConsentActivationOptions<P extends string> {
  readonly gate: ConsentGate<P>;
  readonly owner?: OwnerScope;
  readonly purposes: readonly P[];
  /** Called only after every required purpose is authorized. */
  readonly activate: (context: {readonly signal: AbortSignal}) => void | ConsentCleanup | Promise<void | ConsentCleanup>;
  /** Request provider-side withdrawal/deletion as configured by the application. */
  readonly onRevoke?: (reason: ConsentWithdrawalReason) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}
export interface ConsentActivation { readonly active: boolean; dispose(): void }

/** Fail-closed, serialized startup/teardown. Never injects scripts or executes vendor text. */
export function createConsentActivation<P extends string>(options: ConsentActivationOptions<P>): ConsentActivation {
  if (!options.purposes.length || new Set(options.purposes).size !== options.purposes.length) {
    throw new TypeError('Activation requires unique consent purposes');
  }
  const gate = options.gate;
  const controller = { disposed: false, active: false };
  const listeners: (() => void)[] = [];
  let epoch = 0;
  let currentAbort: AbortController | undefined;
  let currentCleanup: ConsentCleanup | undefined;
  let pendingStart: Promise<void> | undefined;
  let teardown: Promise<void> = Promise.resolve();
  let pendingTeardowns = 0;
  let starting = false;
  let authorized = false;
  let retryBlocked = false;
  const report = (error: unknown) => { try { options.onError?.(error); } catch { /* reporting must not break cleanup */ } };

  function allowed(): boolean { return !controller.disposed && options.purposes.every(id => gate.isAllowed(id)); }
  /** Teardown is serialized, including async provider withdrawal, before future startup. */
  function queueTeardown(operation: () => void | Promise<void>): Promise<void> {
    pendingTeardowns++;
    const next = teardown.then(() => operation()).catch(report).then(() => {
      pendingTeardowns--;
      if (!controller.disposed) reevaluate();
    });
    teardown = next;
    return next;
  }
  function stop(withdraw: boolean, reason: ConsentWithdrawalReason = 'revoked'): void {
    epoch++;
    currentAbort?.abort(new DOMException('Consent withdrawn', 'AbortError'));
    currentAbort = undefined;
    const cleanup = currentCleanup;
    currentCleanup = undefined;
    const hadAuthorization = authorized;
    authorized = false;
    starting = false;
    controller.active = false;
    if (cleanup) void queueTeardown(cleanup);
    if (withdraw && hadAuthorization && options.onRevoke) {
      void queueTeardown(() => options.onRevoke!(reason));
    }
  }
  function reevaluate(): void {
    if (controller.disposed) return;
    if (!allowed()) {
      retryBlocked = false;
      if (authorized || starting) stop(true);
      return;
    }
    // Never start a replacement SDK while an earlier start or teardown remains unresolved.
    if (authorized || starting || pendingStart || pendingTeardowns || retryBlocked) return;
    const currentEpoch = ++epoch;
    const abort = new AbortController();
    currentAbort = abort;
    authorized = true;
    starting = true;
    let result: ReturnType<typeof options.activate>;
    try {
      result = options.activate({signal: abort.signal});
    } catch (error) {
      retryBlocked = true;
      stop(true);
      report(error);
      return;
    }
    const settle = Promise.resolve(result).then(async cleanup => {
      if (controller.disposed || currentEpoch !== epoch || abort.signal.aborted || !allowed()) {
        if (typeof cleanup === 'function') await queueTeardown(cleanup);
        return;
      }
      currentCleanup = typeof cleanup === 'function' ? cleanup : undefined;
      starting = false;
      controller.active = true;
    }, error => {
      if (currentEpoch === epoch) {
        retryBlocked = true;
        stop(true);
      }
      report(error);
    });
    pendingStart = settle.then(() => {
      pendingStart = undefined;
      if (!controller.disposed) reevaluate();
    });
  }
  try {
    for (const id of options.purposes) listeners.push(gate.subscribe(id, reevaluate));
    reevaluate();
  } catch (error) {
    for (const off of listeners) off();
    stop(true);
    throw error;
  }
  const handle: ConsentActivation = {
    get active() { return controller.active; },
    dispose() {
      if (controller.disposed) return;
      controller.disposed = true;
      for (const off of listeners) off();
      stop(true, 'owner-disposed');
    }
  };
  const owner = options.owner ?? getOwner();
  if (owner) {
    try { runWithOwner(owner, () => onCleanup(() => handle.dispose())); }
    catch (error) { handle.dispose(); throw error; }
  }
  return handle;
}
