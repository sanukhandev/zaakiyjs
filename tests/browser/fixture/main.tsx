import { createOwner, disposeOwner, mountOwner } from "@zaakiyjs/core";
import { mount } from "@zaakiyjs/dom";
import { bindExitAwareConditionalRegion, createRegion } from "@zaakiyjs/dom/compiler";
import { flushSync, signal } from "@zaakiyjs/signals";
import { App, fixture } from "./App";
import "virtual:zaakiy-styles.css";
import "./base.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target");
const handle = mount(() => <App />, target);


interface ExitFixture {
  hide(): void;
  show(): void;
  finish(): void;
  aborts(): boolean[];
  dispose(): boolean[];
}
let activeExit: ExitFixture | null = null;
function exitFixture(): ExitFixture {
  if (!activeExit) throw new Error("No active exit fixture");
  return activeExit;
}
function startExitFixture(): void {
  if (activeExit) throw new Error("Exit fixture already running");
  const host = document.createElement("section");
  host.id = "exit-demo";
  document.body.append(host);
  const owner = createOwner();
  const visible = signal(true);
  const signals: AbortSignal[] = [];
  const completions: Array<() => void> = [];
  bindExitAwareConditionalRegion(owner, createRegion(host), () => visible.value, () => {
    const button = document.createElement("button");
    button.id = "exit-demo-button";
    button.textContent = "Exit demo";
    return button;
  }, (_element, abortSignal) => {
    signals.push(abortSignal);
    return new Promise<void>(resolve => { completions.push(resolve); });
  }, { maxExitMs: 5000 });
  mountOwner(owner);
  activeExit = {
    hide() { visible.value = false; flushSync(); },
    show() { visible.value = true; flushSync(); },
    finish() { completions.shift()?.(); },
    aborts() { return signals.map(item => item.aborted); },
    dispose() {
      try { disposeOwner(owner); }
      finally { host.remove(); activeExit = null; }
      return signals.map(item => item.aborted);
    }
  };
}

// Test-only diagnostics, never part of any published ZaakiyJS runtime API.
const testWindow = window as unknown as {
  __zaakiyAcceptance?: {
    dispose: () => void;
    isDisposed: () => boolean;
    lifecycle: typeof fixture.lifecycle;
    getSelected: () => string;
    getCounter: () => number;
    exitStart: () => void;
    exitHide: () => void;
    exitShow: () => void;
    exitFinish: () => void;
    exitAborts: () => boolean[];
    exitDispose: () => boolean[];
    getRefEvents: () => { root: string[]; conditional: string[] };
    mutateDisposedSignals: () => void;
    cycleMount: (iterations: number) => void;
  };
};
testWindow.__zaakiyAcceptance = {
  dispose: () => handle.dispose(),
  isDisposed: () => handle.owner.disposed,
  lifecycle: fixture.lifecycle,
  getSelected: () => fixture.selected.value,
  getCounter: () => fixture.counter.value,
  exitStart: startExitFixture,
  exitHide: () => exitFixture().hide(),
  exitShow: () => exitFixture().show(),
  exitFinish: () => exitFixture().finish(),
  exitAborts: () => exitFixture().aborts(),
  exitDispose: () => exitFixture().dispose(),
  getRefEvents: () => ({ root: [...fixture.refEvents.root], conditional: [...fixture.refEvents.conditional] }),
  cycleMount: (iterations: number) => {
    if (!Number.isInteger(iterations) || iterations < 0 || iterations > 2000) {
      throw new RangeError("Invalid bounded stress iteration count");
    }
    for (let i = 0; i < iterations; i++) {
      const host = document.createElement("div");
      document.body.append(host);
      try {
        const nested = mount(() => <App />, host);
        try {
          fixture.counter.value += 1;
          fixture.groups.value = [...fixture.groups.value];
          flushSync();
        } finally {
          nested.dispose();
        }
      } finally {
        host.remove();
      }
    }
  },
  mutateDisposedSignals: () => {
    fixture.counter.value++;
    fixture.visible.value = !fixture.visible.value;
    fixture.rows.value = [];
  }
};
