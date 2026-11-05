import type {SettingsRepository} from "../models/settings";
const missing=():never=>{throw new Error("Settings backend is not configured.");};
export function createUnconfiguredSettingsRepository():SettingsRepository{
  return {async load(){return missing();},async save(){return missing();},
    async changePassword(){return missing();}};
}
