import {createSettingsPage} from "./features/settings/adapters/createSettingsPage";
import {createUnconfiguredSettingsRepository} from "./features/settings/services/settingsRepository";
import {SettingsView} from "./features/settings/views/SettingsView";
export function App(){
  const vm=createSettingsPage(createUnconfiguredSettingsRepository());
  return <SettingsView vm={vm}/>;
}
