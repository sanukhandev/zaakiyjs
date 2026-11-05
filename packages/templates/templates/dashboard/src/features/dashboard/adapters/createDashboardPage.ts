import {onMount} from "@zaakiyjs/core";
import type {DashboardRepository} from "../models/dashboard";
import {createDashboardViewModel} from "../viewmodels/createDashboardViewModel";
export function createDashboardPage(repository:DashboardRepository){
  const vm=createDashboardViewModel(repository);
  onMount(()=>vm.refresh());
  return vm;
}
