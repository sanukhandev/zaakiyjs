import {describe,expect,it} from "vitest";
import {createAnalytics} from "../src/index.js";
import type {AnalyticsRecordV1, ConsentCapabilityV1, ConsentPurposeV1, ConsentSnapshotV1} from "../src/index.js";

function grantedConsent(): ConsentCapabilityV1 {
  const purposes: ConsentPurposeV1[]=["essential","analytics","advertising","ad-personalization","functional-third-party"];
  const grants=Object.fromEntries(purposes.map(p=>[p,{
    purpose:p,decision:p==="analytics"?"granted":"denied"
  }])) as unknown as ConsentSnapshotV1["grants"];
  return {
    schema:"zaakiy.consent/1",
    snapshot:()=>({schema:"zaakiy.consent/1",policyId:"bench",policyVersion:"v1",revision:1,grants}),
    can:p=>p==="analytics",
    subscribe:()=>()=>{}
  };
}
describe("batch-size accounting preserves UTF-8 wire limit",()=>{
  it("sends all allowed records exactly once in ordered, properly bounded batches",async()=>{
    const bound=180;
    const received: AnalyticsRecordV1[]=[];
    const mutableBatches: AnalyticsRecordV1[][]=[];
    const provider={
      version:1 as const,
      start:async()=>{},
      send:async (records:readonly AnalyticsRecordV1[])=>{
        const bytes=new TextEncoder().encode(JSON.stringify({events:records})).length;
        expect(bytes).toBeLessThanOrEqual(bound);
        mutableBatches.push([...records]);
        received.push(...records);
      },
      flush:async()=>{},
      dispose:async()=>{}
    };
    const analytics=createAnalytics({
      schemas:{viewed:{
        fields:["productId"] as const,
        validate:(value:unknown):value is {productId:string}=>
          !!value&&typeof value==="object"&&"productId" in value&&typeof value.productId==="string"
      }},
      consent:grantedConsent(),
      providers:[{id:"memory",purpose:"analytics",load:()=>provider}],
      policy:{version:1 as const,sampleRate:1,maxBatchSize:64,maxQueueSize:100,
        maxPayloadBytes:bound,flushIntervalMs:60000,delivery:"fetch" as const,
        requiredPurposes:["analytics"] as const}
    });
    try {
      for(let i=0;i<32;i++) expect(analytics.track("viewed",{productId:"p"+i})).toBe(true);
      await analytics.flush();
      expect(received).toHaveLength(32);
      expect(received.map(r=>r.properties?.productId)).toEqual(Array.from({length:32},(_,i)=>"p"+i));
      expect(mutableBatches.length).toBeGreaterThan(1);
      expect(analytics.diagnostics().queueLength).toBe(0);
      expect(analytics.diagnostics().dropped).toBe(0);
    } finally {await analytics.dispose();}
  });
});
