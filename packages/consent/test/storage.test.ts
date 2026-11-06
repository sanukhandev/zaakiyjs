import {describe,it,expect} from 'vitest';
import { createCookieConsentStorage, createMemoryConsentStorage, decodeConsentRecord, serializeConsentRecord, type ConsentRecord } from '../src/index.js';
const record: ConsentRecord={schemaVersion:1,policyVersion:'v1',decidedAt:10,decisions:{analytics:{status:'denied',updatedAt:10,reason:'user-deny'}}};
describe('safe storage', () => {
  it('round-trips canonical versioned records without identifiers', () => {
    expect(decodeConsentRecord(JSON.parse(serializeConsentRecord(record)))).toEqual(record);
    const memory=createMemoryConsentStorage(record);
    expect(memory.read()).toEqual(record);
    memory.clear?.();expect(memory.read()).toBeNull();
  });
  it('rejects malformed payloads and prototype keys',()=>{
    expect(decodeConsentRecord({schemaVersion:1,policyVersion:'x',decidedAt:0,decisions:{analytics:{status:'yes',updatedAt:0,reason:'user-grant'}}})).toBeNull();
    expect(decodeConsentRecord(JSON.parse('{"schemaVersion":1,"policyVersion":"x","decidedAt":1,"decisions":{"__proto__":{"status":"granted","updatedAt":1,"reason":"cmp"}}}'))).toBeNull();
  });
  it('rejects fabricated provenance and out-of-range timestamps',()=>{
    expect(decodeConsentRecord({...record, decidedAt:-1})).toBeNull();
    expect(decodeConsentRecord({...record,decisions:{analytics:{status:'granted',updatedAt:10,reason:'unverified-vendor'}}})).toBeNull();
    expect(decodeConsentRecord({...record,decisions:{analytics:{status:'granted',updatedAt:-1,reason:'cmp'}}})).toBeNull();
  });
  it('rejects unsafe cookie settings',()=>{
    const jar={cookie:''};
    expect(()=>createCookieConsentStorage({jar,sameSite:'None'})).toThrow();
    expect(()=>createCookieConsentStorage({jar,name:'bad;name'})).toThrow();
  });
  it('reads and writes host-only cookies with safe attributes',()=>{
    const jar={cookie:''};const store=createCookieConsentStorage({jar,name:'consent',secure:true,sameSite:'Strict'});
    store.write(record);
    expect(jar.cookie).toContain('; SameSite=Strict; Secure');
    expect(store.read()).toEqual(record);
    store.clear?.(); expect(jar.cookie).toContain('Max-Age=0');
  });
  it('gracefully ignores blocked and malformed cookies',()=>{
    const jar={get cookie(){return '%bad';},set cookie(_next:string){throw Error('blocked');}};
    const store=createCookieConsentStorage({jar});
    expect(store.read()).toBeNull();expect(()=>store.write(record)).not.toThrow();
  });
});
