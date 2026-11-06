import {describe,it,expect,vi} from 'vitest';
import {connectCMP,createConsentManager,mapCMPDecisions,parseVerifiedCMPMessage} from '../src/index.js';
const mapping={vendorToPurpose:{metrics:'analytics',ads:'advertising'} as const};
describe('untrusted CMP boundary',()=>{
  it('maps allowlisted purposes only',()=>expect(mapCMPDecisions({metrics:'granted',extra:'granted'},mapping)).toEqual({analytics:'granted'}));
  it('rejects malformed decisions and conflicts',()=>{
    expect(()=>mapCMPDecisions({metrics:true},mapping)).toThrow();
    expect(()=>mapCMPDecisions(null,mapping)).toThrow();
  });
  it('rejects wrong origin, source and event types',()=>{
    const source={postMessage:vi.fn()} as unknown as MessageEventSource;
    const options={origin:'https://cmp.test',source,eventType:'consent'};
    const event={origin:'https://evil.test',source,data:{type:'consent',decisions:{metrics:'granted'}}} as MessageEvent;
    expect(parseVerifiedCMPMessage(event,options)).toBeNull();
    expect(parseVerifiedCMPMessage({...event,origin:'https://cmp.test',source:null} as MessageEvent,options)).toBeNull();
    expect(parseVerifiedCMPMessage({...event,origin:'https://cmp.test',source} as MessageEvent,options)).toEqual({metrics:'granted'});
  });

  it('does not let delayed CMP read overwrite a newer local consent decision', async () => {
    const manager = createConsentManager({purposes:['analytics','advertising'] as const});
    let resolve!: (payload: unknown) => void;
    const adapter = {
      read: () => new Promise<unknown>(r => { resolve = r; }),
      subscribe: () => () => {}
    };
    const connection = connectCMP(manager, adapter, mapping);
    await Promise.resolve();
    manager.deny('analytics');
    resolve({metrics: 'granted'});
    await Promise.resolve(); await Promise.resolve();
    expect(manager.status('analytics')).toBe('denied');
    connection.dispose(); manager.dispose();
  });
  it('does not let delayed CMP read override a live decision',async()=>{
    const manager=createConsentManager({purposes:['analytics','advertising'] as const});
    let event!: (payload:unknown)=>void;let resolve!: (payload:unknown)=>void;const off=vi.fn();
    const adapter={read:()=>new Promise(r=>{resolve=r;}),subscribe:(fn:(payload:unknown)=>void)=>{event=fn;return off;}};
    const connection=connectCMP(manager,adapter,mapping);
    await Promise.resolve();event({metrics:'denied'});resolve({metrics:'granted'});
    await Promise.resolve();await Promise.resolve();
    expect(manager.isAllowed('analytics')).toBe(false);connection.dispose();expect(off).toHaveBeenCalledTimes(1);manager.dispose();
  });
});
