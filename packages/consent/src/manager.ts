import { batch, signal } from '@zaakiyjs/signals';
import { getOwner, onCleanup, runWithOwner } from '@zaakiyjs/core';
import { decodeConsentRecord } from './storage.js';
import { CONSENT_SCHEMA_V1, CONSENT_PURPOSES_V1, decodeConsentSnapshotV1 } from './protocol.js';
import type { ConsentSnapshotV1, ConsentGrantV1, ConsentSnapshotListenerV1, ConsentDecisionV1, ConsentPurposeV1, ConsentSourceV1 } from './protocol.js';
import type { ConsentChange, ConsentManager, ConsentManagerOptions, ConsentPolicy, ConsentReason, ConsentRecord, ConsentStatus, PurposeDecision } from './types.js';

const ID = /^[a-z][a-z0-9._-]{0,63}$/i;
const MAX_DELAY = 2_147_483_647;
const UNKNOWN: PurposeDecision = { status: 'unknown', updatedAt: 0, reason: 'restore' };
function asArray<P>(items: P | readonly P[]): readonly P[] { return Array.isArray(items) ? items : [items] as readonly P[]; }

export function createConsentManager<P extends ConsentPurposeV1>(options: ConsentManagerOptions<P>): ConsentManager<P> {
  if (!options.purposes.length) throw new TypeError('Consent purposes are required');
  const definitions = new Map<P, boolean>();
  const supportedPurposes = new Set<string>(CONSENT_PURPOSES_V1);
  for (const purpose of options.purposes) {
    const id = (typeof purpose === 'string' ? purpose : purpose.id) as P;
    if (!ID.test(id) || !supportedPurposes.has(id) || definitions.has(id)) throw new TypeError('Invalid or duplicate consent purpose');
    definitions.set(id, typeof purpose !== 'string' && purpose.essential === true);
  }
  if (options.defaultDecision !== undefined && options.defaultDecision !== 'deny') throw new TypeError('Only default-deny is supported');
  const now = options.now ?? Date.now;
  let policy: ConsentPolicy = validatePolicy(options.policy ?? {version: '1'}, definitions);
  let disposed = false;
  let initialized = false;
  let generation = 0;
  let expiresAt: number | undefined;
  let decidedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingWrite: Promise<void> = Promise.resolve();
  const decisions = new Map<P, PurposeDecision>();
  for (const id of definitions.keys()) decisions.set(id, UNKNOWN);
  const signals = signal<Readonly<Record<P, ConsentStatus>>>(getStatuses());
  const versionSignal = signal(policy.version);
  const changes = new Set<(change: ConsentChange) => void>();
  const protocolListeners = new Set<ConsentSnapshotListenerV1>();
  let revision = 0;
  let protocolSnapshot: ConsentSnapshotV1;
  const publishedAllowed = new Map<P, boolean>();
  const subscriptions = new Map<P, Set<(allowed: boolean) => void>>();

  function getStatuses(): Readonly<Record<P, ConsentStatus>> {
    const result = Object.create(null) as Record<P, ConsentStatus>;
    for (const id of definitions.keys()) result[id] = definitions.get(id) ? (policy.allowEssential === true ? 'granted' : 'unknown') : decisions.get(id)?.status ?? 'unknown';
    return Object.freeze(result);
  }
  function ensureActive(): void { if (disposed) throw new Error('Consent manager disposed'); }
  function protocolSource(reason: ConsentReason): ConsentSourceV1 {
    if (reason === 'cmp') return 'cmp';
    if (reason === 'restore' || reason === 'hydrate') return 'server';
    if (reason === 'privacy-signal' || reason === 'policy-change' || reason === 'expiry') return 'policy';
    return 'user';
  }
  function protocolView(): ConsentSnapshotV1 {
    const grants = Object.create(null) as Record<ConsentPurposeV1, ConsentGrantV1>;
    for (const purpose of CONSENT_PURPOSES_V1) {
      const id = purpose as P;
      const configured = definitions.has(id);
      const entry = configured ? decisions.get(id) : undefined;
      const allowed = configured && isAllowed(id);
      const state = configured ? status(id) : 'unknown';
      const decision: ConsentDecisionV1 = allowed ? 'granted' :
        state === 'granted' ? 'denied' : state === 'expired' ? 'unknown' : state;
      const reason = configured && blockedByPrivacySignal(id) ? 'privacy-signal' : entry?.reason;
      const at = entry?.updatedAt;
      grants[purpose] = Object.freeze({purpose, decision,
        ...(reason === undefined || (entry?.status === 'unknown' && !blockedByPrivacySignal(id)) ? {} : {source: protocolSource(reason)}),
        ...(at && Number.isFinite(at) && Math.abs(at) <= 8_640_000_000_000_000 ? {updatedAt: new Date(at).toISOString()} : {})});
    }
    return Object.freeze({schema: CONSENT_SCHEMA_V1, revision, policyId: policy.id ?? 'default',
      policyVersion: policy.version, ...(policy.region ? {region: policy.region} : {}), grants: Object.freeze(grants)});
  }
  function publishProtocol(): void {
    const previous = protocolSnapshot;
    revision++;
    const dispatchedRevision = revision;
    protocolSnapshot = protocolView();
    const next = protocolSnapshot;
    for (const listener of [...protocolListeners]) {
      if (disposed || revision !== dispatchedRevision) return;
      try { listener(next, previous); } catch (error) { reportError(error); }
    }
  }
  function blockedByPrivacySignal(id: P): boolean {
    return (policy.globalPrivacyControl === true && policy.gpcPurposes?.includes(id) === true) ||
      (policy.doNotTrack === true && policy.dntPurposes?.includes(id) === true);
  }
  function isAllowed(id: P): boolean {
    if (!definitions.has(id)) return false;
    if (definitions.get(id)) return !disposed && policy.allowEssential === true;
    if (!initialized || disposed || blockedByPrivacySignal(id)) return false;
    const decision = decisions.get(id);
    return decision?.status === 'granted' && (expiresAt === undefined || now() < expiresAt);
  }
  function status(id: P): ConsentStatus {
    if (!definitions.has(id)) throw new RangeError('Unknown consent purpose');
    return definitions.get(id) ? (policy.allowEssential === true ? 'granted' : 'unknown') : decisions.get(id)?.status ?? 'unknown';
  }
  function rearmExpiry(): void {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (disposed || expiresAt === undefined || !initialized) return;
    const delay = expiresAt - now();
    if (delay <= 0) { refresh(); return; }
    timer = setTimeout(() => { timer = undefined; refresh(); }, Math.min(delay, MAX_DELAY));
    (timer as {unref?: () => void}).unref?.();
  }
  function emit(before: ReadonlyMap<P, boolean>, reason: ConsentReason, beforeStatuses: ReadonlyMap<P, ConsentStatus>): void {
    // A subscriber can synchronously revoke permission or dispose the manager.
    // Never publish an authorization computed before that reentrant decision.
    const dispatchedGeneration = generation;
    // Stage every purpose's committed authorization before invoking user callbacks.
    // A listener may revoke a later purpose during this same atomic grant.
    // Nested changes must observe true -> false rather than an unpublished false -> false.
    for (const id of definitions.keys()) publishedAllowed.set(id, isAllowed(id));
    signals.value = getStatuses();
    publishProtocol();
    for (const id of definitions.keys()) {
      if (disposed || generation !== dispatchedGeneration) return;
      const previous = beforeStatuses.get(id) ?? 'unknown';
      const current = status(id);
      const allowed = isAllowed(id);
      const wasAllowed = before.get(id) ?? false;
      publishedAllowed.set(id, allowed);
      if (previous !== current || allowed !== wasAllowed) {
        const change: ConsentChange = { purpose: id, previous, current, allowed, reason, policyVersion: policy.version };
        for (const listener of [...changes]) {
          if (disposed || generation !== dispatchedGeneration || isAllowed(id) !== allowed) return;
          try { listener(change); } catch (error) { reportError(error); }
        }
        if (allowed !== wasAllowed) for (const listener of [...(subscriptions.get(id) ?? [])]) {
          if (disposed || generation !== dispatchedGeneration || isAllowed(id) !== allowed) return;
          try { listener(allowed); } catch (error) { reportError(error); }
        }
      }
    }
  }
  function capture(): {allowed: Map<P, boolean>; statuses: Map<P, ConsentStatus>} {
    return { allowed: new Map([...definitions.keys()].map(id => [id, publishedAllowed.get(id) ?? isAllowed(id)])),
      statuses: new Map([...definitions.keys()].map(id => [id, status(id)])) };
  }
  function snapshot(): ConsentRecord {
    const stored: Record<string, PurposeDecision> = Object.create(null) as Record<string, PurposeDecision>;
    for (const [id, decision] of decisions) if (!definitions.get(id) && decision.status !== 'unknown') stored[id] = {...decision};
    return { schemaVersion: 1, policyVersion: policy.version, policyId: policy.id ?? 'default',
      ...(policy.region ? {region: policy.region} : {}), decidedAt, ...(expiresAt === undefined ? {} : {expiresAt}), decisions: stored };
  }
  function persist(): void {
    if (!options.storage) return;
    const value = snapshot();
    pendingWrite = pendingWrite.catch(reportError).then(() => options.storage?.write(value)).then(() => undefined).catch(reportError);
  }
  function reportError(error: unknown): void { try { options.onError?.(error); } catch { /* reporting cannot authorize a vendor */ } }
  function modify(targets: readonly P[], next: ConsentStatus, reason: ConsentReason): void {
    ensureActive();
    const ids = new Set<P>();
    for (const id of targets) {
      if (!definitions.has(id)) throw new RangeError('Unknown consent purpose');
      if (definitions.get(id)) throw new RangeError('Essential purposes cannot be modified');
      ids.add(id);
    }
    if (!ids.size) return;
    refresh();
    const changed = [...ids].filter(id => status(id) !== next);
    if (!changed.length) return;
    const previous = capture();
    const instant = now();
    generation++;
    initialized = true;
    decidedAt = instant;
    expiresAt = policy.maxAgeMs === undefined ? undefined : instant + policy.maxAgeMs;
    for (const id of changed) decisions.set(id, {status: next, updatedAt: instant, reason});
    batch(() => emit(previous.allowed, reason, previous.statuses));
    rearmExpiry();
    persist();
  }
  function refresh(): void {
    if (disposed || expiresAt === undefined || now() < expiresAt) { if (!disposed) rearmIfNeeded(); return; }
    const previous = capture();
    const instant = now();
    expiresAt = undefined;
    generation++;
    for (const [id, decision] of decisions) if (!definitions.get(id) && decision.status === 'granted') {
      decisions.set(id, {status: 'expired', updatedAt: instant, reason: 'expiry'});
    }
    batch(() => emit(previous.allowed, 'expiry', previous.statuses));
    persist();
  }
  function rearmIfNeeded(): void { if (timer === undefined && expiresAt !== undefined) rearmExpiry(); }
  function restore(record: ConsentRecord | null, reason: ConsentReason): void {
    if (disposed || record === null) return;
    const safe = decodeConsentRecord(record);
    if (!safe || safe.policyVersion !== policy.version ||
      (safe.policyId ?? 'default') !== (policy.id ?? 'default') || safe.region !== policy.region) return;
    const previous = capture();
    decidedAt = safe.decidedAt;
    expiresAt = safe.expiresAt;
    for (const id of definitions.keys()) {
      if (definitions.get(id)) continue;
      const value = safe.decisions[id];
      if (value) decisions.set(id, value);
    }
    initialized = true;
    if (expiresAt !== undefined && expiresAt <= now()) {
      expiresAt = undefined;
      for (const [id, decision] of decisions) if (decision.status === 'granted') {
        decisions.set(id, {status: 'expired', updatedAt: now(), reason: 'expiry'});
      }
    }
    batch(() => emit(previous.allowed, reason, previous.statuses));
    rearmExpiry();
  }
  async function initialize(startedGeneration: number): Promise<void> {
    // A caller can decide synchronously before the initialization microtask starts.
    // Never restore stored or SSR state after any such local decision.
    if (disposed || startedGeneration !== generation) return;
    let stored: ConsentRecord | null | undefined;
    try { stored = await options.storage?.read(); }
    catch (error) { reportError(error); }
    if (disposed || startedGeneration !== generation) return;
    try {
      const external = options.initialSnapshot?.trusted === true && options.initialSnapshot.snapshot
        ? decodeConsentSnapshotV1(options.initialSnapshot.snapshot) : null;
      if (external && external.policyId === (policy.id ?? 'default') && external.policyVersion === policy.version &&
          external.region === policy.region) {
        const migrated: Record<string, PurposeDecision> = Object.create(null) as Record<string, PurposeDecision>;
        for (const [id, grant] of Object.entries(external.grants)) {
          if (!definitions.has(id as P) || definitions.get(id as P) || grant.decision === 'unknown') continue;
          const source = grant.source === 'cmp' ? 'cmp' : grant.source === 'policy' ? 'policy-change' : 'hydrate';
          migrated[id] = {status: grant.decision, updatedAt: grant.updatedAt ? Date.parse(grant.updatedAt) : now(), reason: source};
        }
        revision = external.revision;
        restore({schemaVersion: 1, policyVersion: external.policyVersion, policyId: external.policyId,
          ...(external.region ? {region: external.region} : {}), decidedAt: now(), decisions: migrated}, 'hydrate');
      } else if (options.initialSnapshot?.trusted === true && options.initialSnapshot.record) {
        restore(options.initialSnapshot.record, 'hydrate');
      } else if (stored) restore(stored, 'restore');
    } catch (error) { reportError(error); }
    if (disposed || startedGeneration !== generation) return;
    const previous = capture();
    initialized = true;
    batch(() => emit(previous.allowed, 'restore', previous.statuses));
    rearmExpiry();
  }
  function updatePolicy(next: ConsentPolicy): void {
    ensureActive();
    const validated = validatePolicy(next, definitions);
    const previous = capture();
    if (validated.version === policy.version &&
        JSON.stringify(validated) === JSON.stringify(policy)) return;
    const versionChanged = validated.version !== policy.version || validated.id !== policy.id || validated.region !== policy.region;
    policy = validated;
    generation++;
    if (versionChanged) {
      initialized = true;
      expiresAt = undefined;
      decidedAt = 0;
      for (const id of definitions.keys()) if (!definitions.get(id)) decisions.set(id, UNKNOWN);
    }
    versionSignal.value = policy.version;
    batch(() => emit(previous.allowed, versionChanged ? 'policy-change' : 'privacy-signal', previous.statuses));
    rearmExpiry();
    if (versionChanged) persist();
  }
  function dispose(): void {
    if (disposed) return;
    const previouslyAllowed = [...definitions.keys()].filter(id => publishedAllowed.get(id) === true);
    disposed = true;
    generation++;
    const previous = protocolSnapshot;
    revision++;
    protocolSnapshot = protocolView();
    for (const listener of [...protocolListeners]) {
      try { listener(protocolSnapshot, previous); } catch (error) { reportError(error); }
    }
    if (timer !== undefined) clearTimeout(timer);
    for (const id of previouslyAllowed) {
      for (const listener of [...(subscriptions.get(id) ?? [])]) { try { listener(false); } catch (error) { reportError(error); } }
    }
    changes.clear();
    subscriptions.clear();
    protocolListeners.clear();
  }
  for (const id of definitions.keys()) publishedAllowed.set(id, isAllowed(id));
  protocolSnapshot = protocolView();
  function applyExternalDecisions(values: Readonly<Partial<Record<P, 'granted' | 'denied' | 'revoked'>>>, reason: ConsentReason = 'cmp'): void {
    ensureActive();
    // Validate every key and value before any mutation or event is emitted.
    for (const [id, value] of Object.entries(values)) {
      if (!definitions.has(id as P) || definitions.get(id as P) ||
          (value !== 'granted' && value !== 'denied' && value !== 'revoked')) throw new RangeError('Invalid external consent decision');
    }
    refresh();
    const previous = capture();
    const changed = Object.entries(values).filter(([id, value]) => status(id as P) !== value);
    if (!changed.length) return;
    const instant = now();
    generation++;
    initialized = true;
    decidedAt = instant;
    expiresAt = policy.maxAgeMs === undefined ? undefined : instant + policy.maxAgeMs;
    for (const [id, value] of changed) decisions.set(id as P,
      {status: value as 'granted' | 'denied' | 'revoked', updatedAt: instant, reason});
    batch(() => emit(previous.allowed, reason, previous.statuses));
    rearmExpiry();
    persist();
  }
  // Capture before deferring initialize(): synchronous user decisions must win over storage.
  const initialGeneration = generation;
  const manager: ConsentManager<P> = {
    capability: Object.freeze({schema: CONSENT_SCHEMA_V1, snapshot: () => protocolSnapshot,
      can: (purpose: ConsentPurposeV1) => isAllowed(purpose as P),
      subscribe(listener: ConsentSnapshotListenerV1): () => void {
        ensureActive(); protocolListeners.add(listener); return () => { protocolListeners.delete(listener); };
      }}),
    ready: Promise.resolve().then(() => initialize(initialGeneration)),
    states: signals, policyVersion: versionSignal,
    get disposed() { return disposed; }, isAllowed, status,
    grant: (ids, reason = 'user-grant') => modify(asArray(ids), 'granted', reason),
    deny: (ids, reason = 'user-deny') => modify(asArray(ids), 'denied', reason),
    revoke: ids => modify(asArray(ids), 'revoked', 'user-revoke'),
    rejectAll: () => modify([...definitions].filter(([, essential]) => !essential).map(([id]) => id), 'denied', 'reject-all'),
    updatePreferences(values) {
      ensureActive();
      for (const [id, value] of Object.entries(values)) {
        if (!definitions.has(id as P) || definitions.get(id as P) || (value !== 'granted' && value !== 'denied')) throw new RangeError('Invalid preference');
      }
      // Apply each preference atomically, emitting after the entire batch.
      refresh();
      const previous = capture();
      const changed = Object.entries(values).filter(([id, value]) => status(id as P) !== value);
      if (!changed.length) return;
      const instant = now();
      generation++;
      initialized = true;
      decidedAt = instant;
      expiresAt = policy.maxAgeMs === undefined ? undefined : instant + policy.maxAgeMs;
      for (const [id, value] of changed) decisions.set(id as P, {status: value as 'granted' | 'denied', updatedAt: instant, reason: 'preferences'});
      batch(() => emit(previous.allowed, 'preferences', previous.statuses));
      rearmExpiry();
      persist();
    },
    applyExternalDecisions, updatePolicy, refresh, snapshot,
    subscribe(id, listener) {
      ensureActive();
      if (!definitions.has(id)) throw new RangeError('Unknown consent purpose');
      const set = subscriptions.get(id) ?? new Set<(allowed: boolean) => void>();
      set.add(listener);
      subscriptions.set(id, set);
      return () => { set.delete(listener); if (!set.size) subscriptions.delete(id); };
    },
    onChange(listener) { ensureActive(); changes.add(listener); return () => { changes.delete(listener); }; },
    flushStorage: () => pendingWrite,
    dispose
  };
  const owner = options.owner ?? getOwner();
  if (owner) runWithOwner(owner, () => onCleanup(dispose));
  return manager;
}

function validatePolicy<P extends string>(policy: ConsentPolicy, purposes: ReadonlyMap<P, boolean>): ConsentPolicy {
  if (!policy.version || policy.version.length > 128 || (policy.id !== undefined && (!policy.id || policy.id.length > 128)) ||
      (policy.region !== undefined && (typeof policy.region !== 'string' || policy.region.length > 128)) ||
      (policy.allowEssential !== undefined && typeof policy.allowEssential !== 'boolean')) throw new TypeError('Invalid consent policy id/version');
  if (policy.maxAgeMs !== undefined && (!Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs <= 0)) throw new TypeError('Invalid consent duration');
  for (const id of [...(policy.gpcPurposes ?? []), ...(policy.dntPurposes ?? [])]) {
    if (!purposes.has(id as P) || purposes.get(id as P)) throw new TypeError('Privacy signals may only govern optional purposes');
  }
  return { ...policy, gpcPurposes: policy.gpcPurposes ? [...policy.gpcPurposes] : undefined,
    dntPurposes: policy.dntPurposes ? [...policy.dntPurposes] : undefined };
}
