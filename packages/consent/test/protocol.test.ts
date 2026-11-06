import {describe, it, expect, vi} from 'vitest';
import {
  createConsentManager, decodeConsentSnapshotV1,
  type ConsentCapabilityV1, type ConsentSnapshotV1
} from '../src/index.js';

const purposes = ['analytics', 'advertising', 'ad-personalization'] as const;
describe('frozen zaakiy.consent/1 interoperability', () => {
  it('exposes a structural capability with strictly typed purposes and fail-closed unknowns', () => {
    const manager = createConsentManager({purposes, policy:{id:'site-policy', version:'2026-11', region:'configured'}});
    const capability: ConsentCapabilityV1 = manager.capability;
    expect(capability.schema).toBe('zaakiy.consent/1');
    const initial=capability.snapshot();
    expect(initial.revision).toBe(0);
    expect(initial.policyId).toBe('site-policy');
    expect(initial.region).toBe('configured');
    expect(initial.grants['ad-personalization'].decision).toBe('unknown');
    expect(capability.can('analytics')).toBe(false);
    expect(capability.can('functional-third-party')).toBe(false);
    expect(Object.keys(initial.grants).sort()).toEqual(['essential','analytics','advertising','ad-personalization','functional-third-party'].sort());
    manager.dispose();
  });
  it('emits exactly one ordered capability snapshot for an atomic preference change', () => {
    const manager=createConsentManager({purposes});
    const capability: ConsentCapabilityV1=manager.capability;
    const calls: Array<[ConsentSnapshotV1,ConsentSnapshotV1]> = [];
    const unsubscribe=capability.subscribe((next,previous)=>calls.push([next,previous]));
    manager.updatePreferences({analytics:'granted',advertising:'denied'});
    const [next,previous] = calls[0]!;
    expect(calls.length).toBe(1);
    expect(next.revision).toBe(previous.revision+1);
    expect(next.grants.analytics.decision).toBe('granted');
    expect(next.grants.advertising.decision).toBe('denied');
    manager.updatePreferences({analytics:'granted',advertising:'denied'});
    expect(calls.length).toBe(1);
    unsubscribe();manager.revoke('analytics');
    expect(calls.length).toBe(1);
    manager.dispose();
  });
  it('notifies capability subscribers of revocation caused by owner disposal', () => {
    const manager=createConsentManager({purposes});
    manager.grant('analytics');
    const observer=vi.fn();manager.capability.subscribe(observer);
    manager.dispose();
    expect(manager.capability.can('analytics')).toBe(false);
    expect(observer).toHaveBeenCalledTimes(1);
    const next=observer.mock.calls[0]?.[0] as ConsentSnapshotV1;
    expect(next.grants.analytics.decision).toBe('denied');
  });
  it('rejects unknown schemas, missing grants, stale/malformed revisions and values', () => {
    const manager=createConsentManager({purposes});
    const good=manager.capability.snapshot();
    expect(decodeConsentSnapshotV1(good)).not.toBeNull();
    expect(decodeConsentSnapshotV1({...good,schema:'other'})).toBeNull();
    expect(decodeConsentSnapshotV1({...good,revision:-1})).toBeNull();
    expect(decodeConsentSnapshotV1({...good,grants:{...good.grants,analytics:{purpose:'analytics',decision:'granted',updatedAt:'yesterday'}}})).toBeNull();
    expect(decodeConsentSnapshotV1({...good,grants:{analytics:good.grants.analytics}})).toBeNull();
    expect(decodeConsentSnapshotV1({...good,grants:{...good.grants,analytics:{purpose:'analytics',decision:'allow'}}})).toBeNull();
    manager.dispose();
  });
  it('hydrates a trusted versioned snapshot after blocked cookie read without early grants',async()=>{
    const source=createConsentManager({purposes,policy:{id:'policy',version:'v2'}});
    source.grant('analytics');
    const snapshot=source.capability.snapshot();
    const manager=createConsentManager({purposes,policy:{id:'policy',version:'v2'},storage:{read:()=>{throw new Error('cookies blocked');},write:()=>{}}, initialSnapshot:{trusted:true,snapshot}});
    expect(manager.isAllowed('analytics')).toBe(false);
    await manager.ready;
    expect(manager.isAllowed('analytics')).toBe(true);
    expect(manager.capability.snapshot().revision > snapshot.revision).toBe(true);
    manager.dispose();source.dispose();
  });
  it('never treats a privacy override as a valid grant in capability snapshots',()=>{
    const manager=createConsentManager({purposes,policy:{version:'1',globalPrivacyControl:true,gpcPurposes:['advertising']}});
    manager.grant('advertising');
    const capability=manager.capability;
    expect(capability.can('advertising')).toBe(false);
    expect(capability.snapshot().grants.advertising.decision).not.toBe('granted');
    manager.dispose();
  });
});
