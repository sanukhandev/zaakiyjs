import {onMount} from "@zaakiyjs/core";
import type {SettingsRepository} from "../models/settings";
import {createSettingsViewModel} from "../viewmodels/createSettingsViewModel";
export function createSettingsPage(repository:SettingsRepository){
  const vm=createSettingsViewModel(repository);
  onMount(()=>{void vm.load();});
  return vm;
}
