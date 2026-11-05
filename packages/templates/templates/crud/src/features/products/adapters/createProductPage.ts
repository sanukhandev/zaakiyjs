import {onMount} from "@zaakiyjs/core";
import type {ProductRepository} from "../models/product";
import {createProductViewModel} from "../viewmodels/createProductViewModel";
export function createProductPage(repository:ProductRepository){
  const vm=createProductViewModel(repository);
  onMount(()=>vm.refresh());
  return vm;
}
