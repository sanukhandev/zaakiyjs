import {Show} from "@zaakiyjs/core";
import type {SettingsViewModel} from "../viewmodels/createSettingsViewModel";
export function SettingsView({vm}:{readonly vm:SettingsViewModel}){
  return <main class="stack mx-auto p-8">
    <header><h1>Settings</h1><p>Changes are saved through an injected version-aware repository.</p></header>
    <Show when={vm.loading.value}><p role="status">Loading settings…</p></Show>
    <Show when={vm.conflict.value}><p role="alert">Your settings may be out of date. Reload before resubmitting.</p></Show>
    <p role="alert">{vm.error.value}</p><p role="status" aria-live="polite">{vm.notice.value}</p>
    <section class="surface stack">
      <h2>Profile</h2>
      <div class="field"><label htmlFor="display-name">Display name</label><input id="display-name" type="text" required
        value={vm.fields.displayName.value.value}
        onInput={event=>vm.form.setValue("displayName",(event.currentTarget as HTMLInputElement).value)}/></div>
      <div class="field"><label htmlFor="locale">Language</label><select id="locale" value={vm.fields.locale.value.value}
        onChange={event=>vm.form.setValue("locale",(event.currentTarget as HTMLSelectElement).value)}>
        <option value="en">English</option><option value="ar">Arabic</option>
      </select></div>
    </section>
    <section class="surface stack"><h2>Appearance</h2>
      <label htmlFor="appearance">Color scheme</label>
      <select id="appearance" value={vm.fields.appearance.value.value}
        onChange={event=>vm.form.setValue("appearance",(event.currentTarget as HTMLSelectElement).value as "system"|"light"|"dark")}>
        <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
      <p>The hosting app applies appearance preferences to its brand scope after save.</p>
    </section>
    <section class="surface stack"><h2>Notifications</h2>
      <label><input type="checkbox" checked={vm.fields.emailNotifications.value.value}
        onChange={event=>vm.form.setValue("emailNotifications",(event.currentTarget as HTMLInputElement).checked)}/>
        Email notifications</label>
    </section>
    <section class="surface stack"><h2>Accessibility</h2>
      <label><input type="checkbox" checked={vm.fields.reducedMotion.value.value}
        onChange={event=>vm.form.setValue("reducedMotion",(event.currentTarget as HTMLInputElement).checked)}/>
        Prefer reduced motion</label>
    </section>
    <section class="surface"><h2>Security</h2>
      <p>Changing a password requires a configured server-side reauthentication flow; this template does not simulate it.</p>
    </section>
    <div class="inline"><button type="button" onClick={()=>{void vm.save();}}>Save settings</button>
      <button type="button" onClick={()=>vm.cancel()}>Discard changes</button>
      <button type="button" onClick={()=>{void vm.load();}}>Reload</button></div>
    <Show when={vm.form.dirty.value}><p role="status">You have unsaved changes.</p></Show>
  </main>;
}
