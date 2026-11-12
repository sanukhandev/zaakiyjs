import {Component,signal,afterNextRender,inject} from "@angular/core";
import {ActivatedRoute,RouterOutlet,provideRouter,Routes} from "@angular/router";
import {provideZonelessChangeDetection} from "@angular/core";
import {provideClientHydration} from "@angular/platform-browser";

export const sizes=[100,1000,10000] as const;

@Component({
  standalone:true,
  selector:"h4-bench-page",
  template:`
    <main>
      <input data-draft="yes" value="server" />
      <button data-counter="yes" type="button" (click)="increment()">Count: {{ count() }}</button>
      @if (visible()) { <p data-condition="yes">Visible</p> }
      <ul data-list="yes">
        @for (row of rows(); track row.id) {
          <li [attr.data-key]="row.id">{{row.label}}</li>
        }
      </ul>
    </main>
  `
})
export class BenchPageComponent {
  private readonly route=inject(ActivatedRoute);
  readonly size=Number(this.route.snapshot.paramMap.get("size"));
  readonly rows=signal(Array.from({length:this.size},(_,i)=>({
    id:"row_"+i,label:"Row "+i
  })));
  readonly count=signal(0);
  readonly visible=signal(true);
  constructor(){
    if(!sizes.includes(this.size as 100|1000|10000))
      throw new Error("Unsupported H4 row scale");
    afterNextRender(()=>{
      const windowState=(window as typeof window & {
        __h4Pre?:{
          started:number;before:HTMLElement[];
          draft:HTMLInputElement;observer:MutationObserver;
        };
        __h4?:unknown;
        __h4App?:Promise<{destroy:()=>void}>;
      });
      const before=windowState.__h4Pre;
      if(!before) throw new Error("Pre-hydration browser snapshot missing");
      const host=document.querySelector("h4-root")!;
      const buttons=host.querySelectorAll("[data-counter]");
      const clickButton=buttons[0] as HTMLButtonElement;
      const mutations=before.observer.takeRecords().length;
      before.observer.disconnect();
      const adopted=before.before.every((node,i)=>
        host.querySelectorAll("[data-key]")[i]===node);
      windowState.__h4={
        ready:true,
        hydrationMs:performance.now()-before.started,
        adopted,mutations,
        preservedDraft:before.draft.value==="visitor draft",
        preservedFocus:document.activeElement===before.draft,
        get liveRows(){return host.querySelectorAll("[data-key]").length;},
        update:async()=>{
          this.increment();
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        },
        reverse:async()=>{
          this.rows.update((rows:{id:string;label:string}[])=>[...rows].reverse());
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        },
        verify:()=>{
          const all=host.querySelectorAll("[data-key]");
          return host.querySelector("[data-counter]")?.textContent?.trim()==="Count: 1" &&
            all.length===this.size &&
            all[0]===before.before[this.size-1] &&
            all[this.size-1]===before.before[0] &&
            before.draft.value==="visitor draft";
        },
        dispose:async()=>{
          (await windowState.__h4App)?.destroy();
        },
        verifyDisposed:()=>{
          const text=clickButton.textContent;
          clickButton.click();
          return clickButton.textContent===text;
        }
      };
    });
  }
  increment(){this.count.update(v=>v+1);}
}

@Component({
  standalone:true,
  selector:"h4-root",
  imports:[RouterOutlet],
  template:`<router-outlet />`
})
export class RootComponent {}

export const routes:Routes=[{path:":size",component:BenchPageComponent}];
export const clientProviders=[
  provideZonelessChangeDetection(),
  provideRouter(routes),
  provideClientHydration()
];
