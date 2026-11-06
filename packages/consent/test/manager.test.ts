import { describe, expect, it, vi } from 'vitest';
import { createConsentManager, type ConsentRecord } from '../src/index.js';

const purposes = ['analytics', 'advertising', 'ad-personalization'] as const;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('consent policy state machine', () => {
  it('starts unknown and blocks every optional purpose, even before asynchronous hydration', () => {
    let resolve!: (record: ConsentRecord | null) => void;
    const manager = createConsentManager({purposes, storage: {read: () => new Promise(r => { resolve = r; }), write: () => {}}});
    expect(manager.status('analytics')).toBe('unknown');
    expect(manager.isAllowed('advertising')).toBe(false);
    expect(manager.isAllowed('analytics')).toBe(false);
    void manager.ready.then(() => manager.dispose());
    void settle().then(() => resolve(null));
  });
  it('grants, rejects and revokes independently without treating unknown as granted', () => {
    const manager = createConsentManager({purposes});
    manager.grant('analytics');
    expect(manager.isAllowed('analytics')).toBe(true);
    expect(manager.isAllowed('advertising')).toBe(false);
    manager.deny('advertising');
    expect(manager.status('advertising')).toBe('denied');
    manager.revoke('analytics');
    expect(manager.status('analytics')).toBe('revoked');
    expect(manager.isAllowed('analytics')).toBe(false);
    manager.dispose();
  });
  it('keeps essential services independent and prohibits altering them', () => {
    const manager = createConsentManager({purposes: [{id: 'essential', essential: true}, 'advertising'],policy:{version:'1',allowEssential:true}});
    expect(manager.isAllowed('essential')).toBe(true);
    expect(manager.isAllowed('advertising')).toBe(false);
    expect(() => manager.deny('essential')).toThrow();
    manager.rejectAll();
    expect(manager.status('advertising')).toBe('denied');
    manager.dispose();
  });
  it('idempotent repeated decisions do not publish duplicate events or writes', async () => {
    const write = vi.fn();
    const manager = createConsentManager({purposes, storage:{read: () => null, write}});
    await manager.ready;
    const listener = vi.fn(); manager.onChange(listener);
    manager.grant('analytics'); manager.grant('analytics');
    await manager.flushStorage();
    expect(write).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    manager.dispose();
  });
  it('rejects all optional purposes, never essential', () => {
    const manager = createConsentManager({purposes: [{id:'essential',essential:true}, ...purposes],policy:{version:'1',allowEssential:true}});
    manager.grant(['analytics','advertising']); manager.rejectAll();
    expect(manager.isAllowed('essential')).toBe(true);
    expect(manager.isAllowed('analytics')).toBe(false);
    expect(manager.isAllowed('advertising')).toBe(false);
    manager.dispose();
  });
  it('policy version invalidates old grants and notifies gates', () => {
    const manager = createConsentManager({purposes, policy:{version:'v1'}});
    manager.grant('analytics');
    const listener = vi.fn(); manager.subscribe('analytics',listener);
    manager.updatePolicy({version:'v2'});
    expect(manager.status('analytics')).toBe('unknown');
    expect(manager.isAllowed('analytics')).toBe(false);
    expect(listener).toHaveBeenCalledWith(false);
    expect(manager.snapshot().policyVersion).toBe('v2'); manager.dispose();
  });
  it('expires grants using deterministic time', () => {
    let clock = 100;
    const manager = createConsentManager({purposes,now:()=>clock,policy:{version:'1',maxAgeMs:10000}});
    const callback=vi.fn(); manager.subscribe('analytics',callback);
    manager.grant('analytics'); clock=10100; manager.refresh();
    expect(manager.status('analytics')).toBe('expired');
    expect(manager.isAllowed('analytics')).toBe(false);
    expect(callback).toHaveBeenLastCalledWith(false); manager.dispose();
  });
  it('supports an atomic preference update', () => {
    const manager = createConsentManager({purposes});
    const view=vi.fn(); manager.onChange(view);
    manager.updatePreferences({analytics:'granted', advertising:'denied'});
    expect(manager.isAllowed('analytics')).toBe(true);
    expect(manager.isAllowed('advertising')).toBe(false);
    expect(view).toHaveBeenCalledTimes(2); manager.dispose();
  });
  it('exposes reactive readonly signal snapshots', () => {
    const manager = createConsentManager({purposes});
    const first=manager.states.peek(); manager.grant('analytics');
    expect(first.analytics).toBe('unknown');
    expect(manager.states.value.analytics).toBe('granted'); manager.dispose();
  });
  it('hydrates only a trusted matching version and otherwise blocks optional grants', async () => {
    const snapshot: ConsentRecord = {schemaVersion:1,policyVersion:'old',decidedAt:1,decisions:{analytics:{status:'granted',updatedAt:1,reason:'user-grant'}}};
    const manager = createConsentManager({purposes,policy:{version:'new'},initialSnapshot:{trusted:true,record:snapshot}});
    await manager.ready;
    expect(manager.isAllowed('analytics')).toBe(false); manager.dispose();
  });
  it('prevents stale asynchronous storage read from overriding a newer user denial', async () => {
    let resolve!: (value: ConsentRecord | null) => void;
    const manager=createConsentManager({purposes,storage:{read:()=>new Promise(r=>{resolve=r;}),write:()=>{}}});
    await settle(); manager.deny('analytics');
    resolve({schemaVersion:1,policyVersion:'1',decidedAt:2,decisions:{analytics:{status:'granted',updatedAt:2,reason:'user-grant'}}});
    await manager.ready;
    expect(manager.isAllowed('analytics')).toBe(false); manager.dispose();
  });
  it('preserves a synchronous pre-ready denial over an older storage grant', async () => {
    const record: ConsentRecord = {
      schemaVersion: 1, policyVersion: '1', decidedAt: 10,
      decisions: { analytics: { status: 'granted', reason: 'user-grant', updatedAt: 10 } }
    };
    const manager = createConsentManager({
      purposes, storage: { read: () => record, write: () => {} }
    });
    manager.deny('analytics');
    expect(manager.status('analytics')).toBe('denied');
    await manager.ready;
    expect(manager.status('analytics')).toBe('denied');
    expect(manager.isAllowed('analytics')).toBe(false);
    manager.dispose();
  });
  it('notifies the later purpose revoked during an atomic grant', () => {
    const manager = createConsentManager({ purposes });
    const advertised: boolean[] = [];
    manager.subscribe('analytics', allowed => {
      if (allowed) manager.revoke('advertising');
    });
    manager.subscribe('advertising', allowed => advertised.push(allowed));
    manager.grant(['analytics', 'advertising']);
    expect(manager.status('advertising')).toBe('revoked');
    expect(advertised).toContain(false);
    manager.dispose();
  });
  it('keeps instances isolated across simulated SSR requests', async () => {
    const a=createConsentManager({purposes}); const b=createConsentManager({purposes});
    a.grant('analytics'); await b.ready;
    expect(a.isAllowed('analytics')).toBe(true);
    expect(b.isAllowed('analytics')).toBe(false); a.dispose();b.dispose();
  });
  it('handles unavailable storage without accidentally granting access', async () => {
    const onError=vi.fn();
    const manager=createConsentManager({purposes,storage:{read:()=>{throw Error('blocked');},write:()=>{throw Error('blocked');}},onError});
    await manager.ready;expect(manager.isAllowed('analytics')).toBe(false);
    manager.deny('analytics');await manager.flushStorage();
    expect(onError).toHaveBeenCalled(); manager.dispose();
  });
  it('applies GPC/DNT only to explicitly configured optional purposes', () => {
    const manager=createConsentManager({purposes,policy:{version:'1',globalPrivacyControl:true,gpcPurposes:['advertising'],doNotTrack:true,dntPurposes:['ad-personalization']}});
    manager.grant(purposes);
    expect(manager.isAllowed('analytics')).toBe(true);
    expect(manager.isAllowed('advertising')).toBe(false);
    expect(manager.isAllowed('ad-personalization')).toBe(false);manager.dispose();
  });
  it('reports subscribers in stable registration order and disposes subscriptions', () => {
    const manager=createConsentManager({purposes});const calls:string[]=[];
    manager.subscribe('analytics',()=>calls.push('a'));
    const off=manager.subscribe('analytics',()=>calls.push('b'));
    manager.grant('analytics');off();manager.revoke('analytics');
    expect(calls).toEqual(['a','b','a']);manager.dispose();
  });

  it('does not publish a stale grant if an earlier listener immediately revokes', () => {
    const manager = createConsentManager({purposes});
    const observed: boolean[] = [];
    manager.onChange(change => {
      if (change.purpose === 'analytics' && change.allowed) manager.revoke('analytics');
    });
    manager.subscribe('analytics', allowed => observed.push(allowed));
    manager.grant('analytics');
    expect(manager.isAllowed('analytics')).toBe(false);
    expect(observed).not.toContain(true);
    manager.dispose();
  });
  it('invalidates authorization after a policy ID or region change, even with the same version', () => {
    const manager = createConsentManager({purposes,policy:{id:'global',version:'v1',region:'global'}});
    manager.grant('analytics');
    manager.updatePolicy({id:'local',version:'v1',region:'local'});
    expect(manager.isAllowed('analytics')).toBe(false);
    expect(manager.status('analytics')).toBe('unknown');
    manager.dispose();
  });
  it('does not restore consent from another policy ID or region', async () => {
    const stored: ConsentRecord={schemaVersion:1,policyId:'old',policyVersion:'v1',region:'old',decidedAt:10,
      decisions:{analytics:{status:'granted',reason:'user-grant',updatedAt:10}}};
    const manager=createConsentManager({purposes,policy:{id:'new',version:'v1',region:'new'},storage:{read:()=>stored,write:()=>{}}});
    await manager.ready;
    expect(manager.isAllowed('analytics')).toBe(false);
    manager.dispose();
  });
  it('requires explicit deployment authorization before treating essential services as allowed', () => {
    const manager=createConsentManager({purposes:[{id:'essential',essential:true},'analytics']});
    expect(manager.isAllowed('essential')).toBe(false);
    manager.updatePolicy({version:'1',allowEssential:true});
    expect(manager.isAllowed('essential')).toBe(true);
    manager.dispose();
  });
  it('fails closed on unknown purposes and invalid policies', () => {
    expect(() => createConsentManager({purposes:['__proto__']})).toThrow();
    expect(() => createConsentManager({purposes,policy:{version:'1',gpcPurposes:['unknown']}})).toThrow();
  });
});
