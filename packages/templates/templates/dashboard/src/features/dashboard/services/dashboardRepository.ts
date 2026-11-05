import type {DashboardRepository,DashboardSnapshot} from "../models/dashboard";
const fixture:DashboardSnapshot={
  metrics:{openRequests:24,completed:132,responseMinutes:18},
  activity:[
    {id:"demo-1",title:"Example onboarding completed",when:"09:30"},
    {id:"demo-2",title:"Example request reviewed",when:"Yesterday"},
    {id:"demo-3",title:"Example report generated",when:"Monday"}
  ]
};
/** No I/O or credentials. Factory creates isolated per-application demo data. */
export function createDemoDashboardRepository():DashboardRepository{
  return {async read(signal){
    if(signal.aborted) throw signal.reason;
    return {metrics:{...fixture.metrics},activity:fixture.activity.map(x=>({...x}))};
  }};
}
