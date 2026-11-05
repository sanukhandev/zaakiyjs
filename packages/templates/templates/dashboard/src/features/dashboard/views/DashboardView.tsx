import {For,Show} from "@zaakiyjs/core";
import type {DashboardViewModel} from "../viewmodels/createDashboardViewModel";
export function DashboardView({vm}:{readonly vm:DashboardViewModel}){
  return <div class="shell">
    <nav aria-label="Primary navigation" class="surface">
      <strong>__BRAND_NAME__</strong>
      <ul><li><a href="#overview">Overview</a></li><li><a href="#activity">Activity</a></li></ul>
    </nav>
    <main id="overview" class="stack">
      <header class="inline"><h1>Operations overview</h1><span>Demo data</span>
        <button type="button" onClick={()=>vm.refresh()}>Refresh report</button>
      </header>
      <p>All metrics below are illustrative; connect a real DashboardRepository to use production data.</p>
      <Show when={vm.report.pending.value}><p role="status">Loading dashboard…</p></Show>
      <Show when={vm.report.error.value!==null}><p role="alert">Report could not be loaded. Try again.</p></Show>
      <section class="cards" aria-label="Key metrics">
        <article class="surface"><h2>Open requests</h2><p>{vm.report.data.value?.metrics.openRequests ?? 0}</p></article>
        <article class="surface"><h2>Completed</h2><p>{vm.report.data.value?.metrics.completed ?? 0}</p></article>
        <article class="surface"><h2>Typical response (min)</h2><p>{vm.report.data.value?.metrics.responseMinutes ?? 0}</p></article>
      </section>
      <section id="activity" class="stack" aria-label="Recent activity">
        <h2>Recent activity</h2>
        <label class="field" htmlFor="activity-filter">Filter activity</label>
        <input id="activity-filter" type="search" value={vm.filter.value}
          onInput={event=>{vm.filter.value=(event.currentTarget as HTMLInputElement).value;}}/>
        <Show when={vm.activity.value.length===0}><p>No activity matches your filter.</p></Show>
        <ul><For each={vm.activity.value} by={item=>item.id}>{item=>
          <li class="surface"><strong>{item.title}</strong><span> — {item.when}</span></li>
        }</For></ul>
      </section>
    </main>
  </div>;
}
