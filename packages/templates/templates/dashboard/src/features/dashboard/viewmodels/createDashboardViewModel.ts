import {createResource} from "@zaakiyjs/async";
import {computed,signal} from "@zaakiyjs/signals";
import type {DashboardRepository,DashboardSnapshot} from "../models/dashboard";
export function createDashboardViewModel(repository:DashboardRepository){
  const report=createResource<DashboardSnapshot>({load:({signal})=>repository.read(signal),eager:false});
  const filter=signal("");
  const activity=computed(()=>report.data.value?.activity.filter(x=>x.title.toLowerCase().includes(filter.value.toLowerCase())) ?? []);
  return {report,filter,activity,refresh(){void report.refresh().catch(()=>{/* reported by resource.error */});}};
}
export type DashboardViewModel=ReturnType<typeof createDashboardViewModel>;
