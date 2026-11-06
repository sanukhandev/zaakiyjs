import { createOwner, runWithOwner, disposeOwner } from '@zaakiyjs/core';
import {describe,it,expect,vi} from 'vitest';
import {createConsentActivation,createConsentManager} from '../src/index.js';
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('multi-purpose revocable authorization',()=>{
  it('never activates early and requires all purposes', async()=>{
    const manager=createConsentManager({purposes:['analytics','advertising'] as const});
    const activate=vi.fn(()=>vi.fn());
    const handle=createConsentActivation({gate:manager,purposes:['analytics','advertising'],activate});
    manager.grant('analytics');await settle();expect(activate).not.toHaveBeenCalled();
    manager.grant('advertising');await settle();expect(activate).toHaveBeenCalledTimes(1);
    handle.dispose();manager.dispose();
  });
  it('aborts pending activation and tears down after withdrawal', async()=>{
    const manager=createConsentManager({purposes:['analytics'] as const});
    let resolve!: (value:()=>void)=>void;let captured!:AbortSignal;
    const cleanup=vi.fn();const withdrawal=vi.fn();
    const handle=createConsentActivation({gate:manager,purposes:['analytics'],activate:({signal})=>{captured=signal;return new Promise(r=>{resolve=r;});},onRevoke:withdrawal});
    manager.grant('analytics');expect(captured.aborted).toBe(false);
    manager.revoke('analytics');expect(captured.aborted).toBe(true);
    resolve(cleanup);await settle();expect(cleanup).toHaveBeenCalledTimes(1);
    expect(withdrawal).toHaveBeenCalledTimes(1);handle.dispose();manager.dispose();
  });
  it('automatically aborts and tears down an activation on owner disposal', async()=>{
    const owner=createOwner();
    const manager=createConsentManager({purposes:['analytics'] as const});
    const cleanup=vi.fn();const onRevoke=vi.fn();
    let signal!:AbortSignal;
    const handle=runWithOwner(owner,()=>createConsentActivation({gate:manager,purposes:['analytics'],
      activate:ctx=>{signal=ctx.signal;return cleanup;},onRevoke}));
    manager.grant('analytics');await settle();
    expect(handle.active).toBe(true);
    disposeOwner(owner);
    await settle();
    expect(handle.active).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledWith('owner-disposed');
    manager.dispose();
  });
  it('blocks reactivation until an asynchronous cleanup has completed', async()=>{
    const manager=createConsentManager({purposes:['analytics'] as const});
    let finishCleanup!:()=>void;
    const activate=vi.fn(()=>()=>new Promise<void>(resolve=>{finishCleanup=resolve;}));
    const handle=createConsentActivation({gate:manager,purposes:['analytics'],activate});
    manager.grant('analytics');await settle();
    manager.revoke('analytics');manager.grant('analytics');await settle();
    expect(activate).toHaveBeenCalledTimes(1);
    finishCleanup();await settle();await settle();
    expect(activate).toHaveBeenCalledTimes(2);
    handle.dispose();manager.dispose();
  });
  it('waits for obsolete asynchronous startup cleanup before replacement vendor loading', async()=>{
    const manager=createConsentManager({purposes:['analytics'] as const});
    let resolveFirst!: (cleanup:()=>Promise<void>)=>void;
    let finishOldCleanup!:()=>void;
    let startups=0;
    const activate=vi.fn(()=>{
      startups++;
      if(startups===1) return new Promise<()=>Promise<void>>(r=>{resolveFirst=r;});
      return Promise.resolve(()=>{});
    });
    const handle=createConsentActivation({gate:manager,purposes:['analytics'],activate});
    manager.grant('analytics');
    manager.revoke('analytics');manager.grant('analytics');
    await settle();expect(activate).toHaveBeenCalledTimes(1);
    resolveFirst(()=>new Promise<void>(r=>{finishOldCleanup=r;}));
    await settle();expect(activate).toHaveBeenCalledTimes(1);
    finishOldCleanup();await settle();await settle();
    expect(activate).toHaveBeenCalledTimes(2);
    handle.dispose();manager.dispose();
  });
  it('aborts a pending multi-purpose provider during a reentrant atomic grant', async()=>{
    const manager=createConsentManager({purposes:['analytics','advertising'] as const});
    let startupSignal!:AbortSignal;
    let finishStart!:()=>void;
    const activate=vi.fn(({signal}:{signal:AbortSignal})=>{
      startupSignal=signal;
      return new Promise<()=>void>(resolve=>{finishStart=()=>resolve(()=>{});});
    });
    const handle=createConsentActivation({gate:manager,purposes:['analytics','advertising'],activate});
    manager.subscribe('analytics',allowed=>{if(allowed) manager.revoke('advertising');});
    manager.grant(['analytics','advertising']);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(manager.isAllowed('advertising')).toBe(false);
    expect(startupSignal.aborted).toBe(true);
    finishStart();await settle();
    handle.dispose();manager.dispose();
  });
  it('tears down an essential-only activation when its manager is disposed', async()=>{
    const manager=createConsentManager({purposes:[{id:'essential',essential:true}] as const,policy:{version:'1',allowEssential:true}});
    const cleanup=vi.fn();
    let startupSignal!:AbortSignal;
    const handle=createConsentActivation({gate:manager,purposes:['essential'],
      activate:({signal})=>{startupSignal=signal;return cleanup;}});
    await settle();
    expect(handle.active).toBe(true);
    manager.dispose();
    expect(startupSignal.aborted).toBe(true);
    await settle();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(handle.active).toBe(false);
    handle.dispose();
  });
  it('is idempotently disposable and prevents future activation', async()=>{
    const manager=createConsentManager({purposes:['analytics'] as const});
    const cleanup=vi.fn();const activate=vi.fn(()=>cleanup);
    const handle=createConsentActivation({gate:manager,purposes:['analytics'],activate});
    manager.grant('analytics');await settle();handle.dispose();handle.dispose();await settle();
    expect(cleanup).toHaveBeenCalledTimes(1);
    manager.revoke('analytics');manager.grant('analytics');await settle();
    expect(activate).toHaveBeenCalledTimes(1);manager.dispose();
  });
});
